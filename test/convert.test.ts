import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isCurtConversation, parseCurt, serializeCurt } from "curt-format";
import { curtToVcon, vconToCurt, VCON_SYNTAX_VERSION } from "../src/index.js";

const fixtures = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures");
const sampleCurtRaw = readFileSync(join(fixtures, "sample.curt"), "utf8");
const mixedVcon = JSON.parse(readFileSync(join(fixtures, "mixed.vcon.json"), "utf8"));

describe("curtToVcon", () => {
  const curt = parseCurt(sampleCurtRaw)!;

  it("parses the fixture as a valid .curt conversation", () => {
    expect(curt).not.toBeNull();
    expect(isCurtConversation(curt)).toBe(true);
  });

  it("emits the required core top-level fields", () => {
    const v = curtToVcon(curt);
    expect(v.vcon).toBe(VCON_SYNTAX_VERSION);
    expect(typeof v.uuid).toBe("string");
    expect(v.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.created_at).toBe("2025-10-31T10:40:00.000Z");
    expect(v.updated_at).toBe("2025-10-31T10:45:00.000Z");
    expect(v.subject).toBe("Refactor the parser");
  });

  it("derives a deterministic uuid from the curt id", () => {
    const a = curtToVcon(curt).uuid;
    const b = curtToVcon(parseCurt(sampleCurtRaw)!).uuid;
    expect(a).toBe(b);
  });

  it("creates one party per distinct role, ordered by first appearance, typed per draft 4.4.11", () => {
    const v = curtToVcon(curt);
    expect(v.parties).toEqual([
      { name: "user", type: "person" },
      { name: "assistant", type: "bot" },
      { name: "system", type: "bot" },
      { name: "tool", type: "bot" },
    ]);
  });

  it("maps each message to a text dialog with draft-05 field names", () => {
    const v = curtToVcon(curt);
    expect(v.dialog).toHaveLength(5);
    const d0 = v.dialog![0];
    expect(d0.type).toBe("text");
    expect(d0.start).toBe("2025-10-31T10:40:00.000Z");
    expect(d0.parties).toEqual([0]);
    expect(d0.mediatype).toBe("text/plain");
    expect(d0.body).toBe("Can you write a JSON parser?");
    expect(d0.encoding).toBe("none");
    expect(d0.message_id).toBe("m1");
    // role index follows party order (system appears later in party list)
    expect(v.dialog![2].parties).toEqual([2]); // system
    expect(v.dialog![3].parties).toEqual([3]); // tool
  });

  it("preserves millisecond timestamp precision", () => {
    const v = curtToVcon(curt);
    expect(v.dialog![1].start).toBe("2025-10-31T10:40:05.000Z");
  });
});

describe("vconToCurt", () => {
  it("converts only inline text dialogs, skipping recording/incomplete/external", () => {
    const curt = vconToCurt(mixedVcon)!;
    expect(curt).not.toBeNull();
    expect(curt.messages).toHaveLength(3);
    expect(curt.messages.map((m) => m.content)).toEqual([
      "Hello, I need help with my order.",
      "Sure, could you give me the order number?",
      "{\"order\":42,\"status\":\"shipped\"}",
    ]);
  });

  it("maps party names back to curt roles, defaulting unknown names to user", () => {
    const curt = vconToCurt(mixedVcon)!;
    expect(curt.messages[0].role).toBe("user"); // party 0 is "Alice" -> default user
    expect(curt.messages[1].role).toBe("assistant"); // message_id round-trips
    expect(curt.messages[1].id).toBe("assistant-msg-7");
    expect(curt.messages[2].role).toBe("user"); // party 1 named "user"
  });

  it("ignores party type for role recovery (it cannot distinguish system/tool)", () => {
    const curt = vconToCurt({
      uuid: "test-uuid",
      created_at: "2026-01-01T00:00:00.000Z",
      parties: [
        { name: "Alice", type: "person" },
        { name: "Support Bot", type: "bot" },
      ],
      dialog: [
        {
          type: "text",
          start: "2026-01-01T00:01:00.000Z",
          parties: [1],
          body: "hi",
          encoding: "none",
        },
      ],
    })!;
    expect(curt.messages[0].role).toBe("user"); // typed bot, but no curt role name
  });

  it("maps top-level vCon metadata into the conversation", () => {
    const curt = vconToCurt(mixedVcon)!;
    expect(curt.id).toBe("018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b");
    expect(curt.title).toBe("Support call with transcript");
    expect(curt.createdAt).toBe(Date.parse("2026-10-31T10:00:00.000Z"));
    expect(curt.updatedAt).toBe(Date.parse("2026-10-31T10:05:00.000Z"));
  });

  it("decodes base64url bodies", () => {
    const body = Buffer.from("héllo base64", "utf8").toString("base64url");
    const curt = vconToCurt({
      uuid: "test-uuid",
      created_at: "2026-01-01T00:00:00.000Z",
      parties: [{ name: "user" }],
      dialog: [
        {
          type: "text",
          start: "2026-01-01T00:01:00.000Z",
          parties: [0],
          mediatype: "text/plain",
          body,
          encoding: "base64url",
        },
      ],
    })!;
    expect(curt.messages).toHaveLength(1);
    expect(curt.messages[0].content).toBe("héllo base64");
  });

  it("skips dialogs with unknown encodings", () => {
    const curt = vconToCurt({
      uuid: "test-uuid",
      created_at: "2026-01-01T00:00:00.000Z",
      dialog: [
        { type: "text", body: "x", encoding: "rot13" },
        { type: "text", body: "plain", encoding: "none" },
      ],
    })!;
    expect(curt.messages.map((m) => m.content)).toEqual(["plain"]);
  });

  it("falls back to created_at (then epoch 0) for missing dialog starts", () => {
    const curt = vconToCurt({
      uuid: "test-uuid",
      created_at: "2026-01-01T00:00:00.000Z",
      dialog: [
        { type: "text", body: "a", encoding: "none" },
        { type: "text", start: "not-a-date", body: "b", encoding: "none" },
      ],
    })!;
    expect(curt.messages[0].timestamp).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(curt.messages[1].timestamp).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("returns null for non-vCon input", () => {
    expect(vconToCurt(null)).toBeNull();
    expect(vconToCurt("nope")).toBeNull();
    expect(vconToCurt({})).toBeNull();
    expect(vconToCurt({ created_at: "2026-01-01T00:00:00Z" })).toBeNull(); // no uuid
  });
});

describe("round trip curt -> vcon -> curt", () => {
  const original = parseCurt(sampleCurtRaw)!;
  const core = (msgs: ReturnType<typeof parseCurt> extends null ? never : NonNullable<ReturnType<typeof parseCurt>>["messages"]) =>
    msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp }));

  it("preserves every message (id, role, content, timestamp)", () => {
    const roundTripped = vconToCurt(curtToVcon(original))!;
    expect(isCurtConversation(roundTripped)).toBe(true);
    expect(core(roundTripped.messages)).toEqual(core(original.messages));
  });

  it("drops message-level extras (documented loss: model)", () => {
    const roundTripped = vconToCurt(curtToVcon(original))!;
    expect(original.messages.some((m) => m.model)).toBe(true);
    expect(roundTripped.messages.every((m) => m.model === undefined)).toBe(true);
  });

  it("preserves title and epoch timestamps; conversation id is one-way (documented loss)", () => {
    const roundTripped = vconToCurt(curtToVcon(original))!;
    // The curt id is hashed into a deterministic uuidv5; there is no core
    // vCon field to carry the original id back, so it does not round-trip.
    expect(roundTripped.id).toBe(curtToVcon(original).uuid);
    expect(roundTripped.id).not.toBe(original.id);
    expect(roundTripped.title).toBe(original.title);
    expect(roundTripped.createdAt).toBe(original.createdAt);
    expect(roundTripped.updatedAt).toBe(original.updatedAt);
  });

  it("drops conversation-level extras (documented loss: provider, model)", () => {
    const roundTripped = vconToCurt(curtToVcon(original))!;
    expect(roundTripped.provider).toBeUndefined();
    expect(roundTripped.model).toBeUndefined();
  });

  it("file-level round trip stays a valid .curt body", () => {
    const v = curtToVcon(original);
    const body = serializeCurt(vconToCurt(v)!, "curt-vcon test");
    const reparsed = parseCurt(body)!;
    expect(core(reparsed.messages)).toEqual(core(original.messages));
  });
});

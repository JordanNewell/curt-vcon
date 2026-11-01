# curt-vcon

A bridge converter between two conversation containers:

- **.curt** — the open single-file **AI-conversation** format (frozen v1 core;
  JSON envelope starting with the magic string `curtis-conversation`). This
  package depends on the reference implementation,
  [`curt-format`](https://www.npmjs.com/package/curt-format) — it does not
  reimplement parsing or serialization.
- **vCon** — the IETF **Virtualized Conversation** container for real-time
  human conversations (calls, messages, voice), as specified in
  [draft-ietf-vcon-vcon-core-05](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core).

```bash
npm install curt-vcon
# or, for the CLI:
npm install -g curt-vcon
```

## Positioning: a bridge, not a unification

vCon and .curt model **different domains**. vCon targets real-time
conversations between people — call recordings, transcriptions, call-center
sessions, signaling metadata. .curt targets **AI conversations** — user /
assistant / system / tool turns with model provenance.

Neither format subsumes the other, and this converter does not claim to make
one expressible as the other. It maps the **overlapping text subset** (timestamped
text turns attributable to an originator) and is lossy everywhere else. The
fidelity matrix below states exactly what is preserved, degraded, or dropped.

This project makes **no normative claims** about either format. For the .curt
format, the reference implementation and SPEC in `curt-format` are authoritative.
For vCon, the IETF draft (a work in progress — the vCon WG charter was updated
March 2026 and the draft is not yet an RFC) is authoritative. Field names in this
converter were verified against draft-ietf-vcon-vcon-core-05; if the draft
changes, this converter may need to follow.

## CLI

```bash
curt-vcon to-vcon in.curt > out.vcon.json
curt-vcon to-curt in.vcon.json > out.curt
```

Exit code 1 with a stderr message on invalid input; exit 2 on usage errors.
Output goes to stdout only.

## API

```ts
import { parseCurt, serializeCurt } from "curt-format";
import { curtToVcon, vconToCurt, type Vcon } from "curt-vcon";

const curt = parseCurt(curtFileText)!;
const vcon: Vcon = curtToVcon(curt);

const back = vconToCurt(vcon); // CurtConversation | null
```

`vconToCurt` performs a structural check (object with a string `uuid`), not full
draft validation. It returns `null` for input it cannot interpret; per-section
problems (non-text dialogs, undecodable bodies) are **skipped**, not fatal.

## Field mapping (curt -> vCon)

All vCon field names below are per draft-ietf-vcon-vcon-core-05.

| .curt | vCon | Notes |
|---|---|---|
| `conversation.id` | `uuid` | Deterministic UUIDv5 of `curt:<id>` in a fixed namespace — same input always yields the same uuid, but the mapping is one-way |
| `conversation.createdAt` | `created_at` | Epoch ms -> RFC 3339 (JMAP Date) |
| `conversation.updatedAt` | `updated_at` | Omitted if absent/invalid |
| `conversation.title` | `subject` | Omitted if empty |
| message `role` (first appearance) | `parties[]` entry | One party per distinct role. Party `name` = the role string (`name` is free-form per draft §4.4.5). Party `type` = `"person"` for the user role, `"bot"` for assistant/system/tool (draft §4.4.11) |
| each message | `dialog[]` entry | `type: "text"` |
| message `timestamp` | `dialog[].start` | RFC 3339, millisecond precision |
| message `role` | `dialog[].parties` | `[index of that role's party]` |
| (constant) | `dialog[].mediatype` | `"text/plain"` |
| message `content` | `dialog[].body` + `encoding: "none"` | Content is always a valid JSON string |
| message `id` | `dialog[].message_id` | Core optional field — carries the .curt message id through |
| (constant) | `vcon` | `"0.5.0"` — the value required for the syntax defined in draft -05 (the parameter itself is deprecated by the draft but still interoperable) |

## Field mapping (vCon -> curt)

| vCon | .curt | Notes |
|---|---|---|
| `uuid` | `conversation.id` | |
| `created_at` | `conversation.createdAt` | Epoch 0 if missing/unparseable |
| `updated_at` | `conversation.updatedAt` | Falls back to `created_at` |
| `subject` | `conversation.title` | `"Untitled"` if missing |
| `dialog[]` of `type: "text"` | one message each | All other types skipped |
| `dialog[].parties[0]` -> `parties[i].name` | message `role` | Only `user`/`assistant`/`system`/`tool` recognized; anything else (or a real person name) becomes `user`. Party `type` (§4.4.11) is **not** used for role recovery — it distinguishes person/bot but cannot separate system from tool turns |
| `dialog[].start` | message `timestamp` | Falls back to `created_at`, then epoch 0 |
| `dialog[].body` + `encoding` | message `content` | `none` used as-is; `base64url` decoded; `json` stringified if not already a string |
| `dialog[].message_id` | message `id` | Falls back to `dialog-<index>` |

## Fidelity matrix

Legend: **maps cleanly** — preserved exactly; **lossy** — survives with
degradation; **dropped** — not carried.

### curt -> vCon -> curt (round trip)

| Data | Status | Notes |
|---|---|---|
| message `content` | maps cleanly | |
| message `timestamp` | maps cleanly | RFC 3339 round trip at ms precision |
| message `role` | maps cleanly | Via party `name` (the role string); `type` is emitted per draft §4.4.11 but not needed for recovery. Roles outside the four are not possible in valid .curt |
| message `id` | maps cleanly | Via `dialog[].message_id` |
| `conversation.title` | maps cleanly | Via `subject` |
| `conversation.createdAt` / `updatedAt` | maps cleanly | |
| `conversation.id` | **lossy (one-way)** | Becomes a deterministic UUIDv5; the original string id cannot be recovered — vCon core has no free-form top-level metadata field to carry it |
| message extras (`model`, …) | **dropped** | No core vCon home on a text dialog; the draft's extension mechanism exists but defining a curt extension is out of scope for now (see open questions) |
| `conversation.provider` / `model` | **dropped** | Same |
| `generator`, `extensions` envelope fields | **dropped** | `parseCurt` does not preserve envelope-top-level extras; preservation is best-effort, never normative |

### vCon -> curt (one direction; inherently lossy)

| Data | Status |
|---|---|
| text dialogs, inline, `encoding` none/json/base64url | maps cleanly |
| `recording` dialogs (audio/video, inline or external) | **dropped** — .curt v1 has no media-message concept |
| `incomplete` dialogs | **dropped** — no .curt equivalent |
| externally referenced dialogs (`url` + `content_hash`) | **dropped** — no network fetch |
| dialogs with unrecognized `encoding` | **dropped** (undecodable per draft §2.5) |
| `parties[]` identity data (`tel`, `mailto`, `name` of real people…) | **dropped** except as role inference |
| `analysis[]`, `attachments[]` | **dropped** |
| `sessions[]`, `events[]`, `redacted_from`/`amended_from`, `redacted_strings` | **dropped** |
| multi-party `dialog[].parties` | **lossy** — only the first party index is used for the role |
| non-`text/plain` mediatypes on text dialogs | **lossy** — mediatype itself is dropped; body still converted |

## Known spec-level mismatches (documented, not solved here)

- **system/tool turns as "parties"**: vCon dialog text is "a single message
  from one of the parties" — a human-conversation concept. Mapping .curt
  `system` and `tool` roles to parties keeps the data but stretches vCon's
  party semantics. The converter types parties per draft §4.4.11 —
  `type: "person"` for the user role, `type: "bot"` for
  assistant/system/tool — which is the draft's machine/agent-appropriate
  participant type. `name` still carries the exact .curt role string
  (free-form per §4.4.5) so the round trip is lossless; dropping system/tool
  turns instead would lose data. The chosen mapping is deliberate.
- **`vcon: "0.5.0"`**: deprecated in draft -05, but this draft is pre-RFC and
  the value is required for the syntax it defines, so the converter emits it
  for interoperability with current vCon tooling.
- **originator**: earlier vCon drafts had a dialog-level `originator`;
  draft -05 models origination in Session objects. This converter emits plain
  dialogs without Sessions and does not attempt originator representation.

## Open questions

1. Should the original .curt conversation id ride into the vCon somehow? The
   draft's extension registry mechanism could support a registered parameter,
   but that makes the output an *extended* vCon rather than a core one.
2. Should message `model` metadata become a vCon `analysis` entry (e.g.
   `type: "curt-provenance"`) instead of being dropped?
3. Party-name-based role recovery is a convention, not a draft concept.
   `party.type` (§4.4.11) is now emitted — `person`/`bot` — but it cannot
   express the four-way .curt role distinction (system vs tool). Would the
   vCon WG prefer a registered party parameter for the role, or is the
   free-form `name` convention acceptable?
4. The vCon core draft is still evolving (WG active). Which draft revision
   should be the tracking target for a 1.0 of this converter?

## Development

```bash
npm install
npm test        # builds, then runs vitest (19 tests incl. round-trip fixtures)
```

Fixtures: `fixtures/sample.curt` (generated by `curt-format`'s own
serialization) and `fixtures/mixed.vcon.json` (text + recording + incomplete +
external + json-encoded dialogs).

## License

MIT — see [LICENSE](LICENSE).

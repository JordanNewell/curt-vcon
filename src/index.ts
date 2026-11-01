/**
 * curt-vcon — bridge converter between the .curt single-file AI-conversation
 * format (https://github.com/JordanNewell/dot_curt) and the IETF vCon
 * "Virtualized Conversation" container (draft-ietf-vcon-vcon-core-05).
 *
 * Positioning: vCon targets real-time human conversations (calls, messages,
 * voice) while .curt targets AI conversations. Neither format subsumes the
 * other; this converter is a lossy bridge and maps only the common subset.
 */

import { createHash } from "node:crypto";
import {
  parseCurt,
  serializeCurt,
  type CurtConversation,
  type CurtMessage,
} from "curt-format";

// ---------------------------------------------------------------------------
// vCon types (per draft-ietf-vcon-vcon-core-05). Only the fields this
// converter reads or writes are modeled; everything else rides as unknown.
// ---------------------------------------------------------------------------

/** RFC 3339 date string (JMAP Date type, draft section 2.2). */
export type VconDate = string;

/** draft-ietf-vcon-vcon-core-05, section 2.3.2. */
export type VconEncoding = "base64url" | "json" | "none";

/** draft-ietf-vcon-vcon-core-05, section 4.5.1. */
export type VconDialogType = "recording" | "text" | "incomplete";

/** draft-ietf-vcon-vcon-core-05, section 4.4. Only `name` is modeled. */
export interface VconParty {
  name?: string;
  [key: string]: unknown;
}

/** draft-ietf-vcon-vcon-core-05, section 4.5. */
export interface VconDialog {
  type?: VconDialogType;
  start?: VconDate;
  /** Seconds. */
  duration?: number;
  /** Indices into the top-level parties array (possibly nested/null). */
  parties?: number | (number | number[] | null)[] | null;
  mediatype?: string;
  filename?: string;
  body?: unknown;
  encoding?: VconEncoding;
  url?: string;
  content_hash?: unknown;
  disposition?: string;
  session_id?: string;
  application?: string;
  message_id?: string;
  [key: string]: unknown;
}

/** Top-level vCon object, draft-ietf-vcon-vcon-core-05, section 4.1. */
export interface Vcon {
  /** Deprecated as of -05, but MUST be "0.5.0" for this syntax when present. */
  vcon?: string;
  uuid: string;
  extensions?: string[];
  critical?: string[];
  created_at: VconDate;
  updated_at?: VconDate;
  subject?: string;
  parties?: VconParty[];
  dialog?: VconDialog[];
  analysis?: unknown[];
  attachments?: unknown[];
  [key: string]: unknown;
}

export const VCON_SYNTAX_VERSION = "0.5.0";

/**
 * Fixed UUIDv5 namespace used to derive a stable vCon `uuid` from a .curt
 * conversation id. Randomly generated once for this project so that the same
 * .curt id always converts to the same vCon uuid.
 */
const CURT_VCON_UUID_NAMESPACE = "3d1a2f6e-8c47-4b9d-9a55-0f2e6d7c1b40";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuidv5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(nsBytes)
    .update(Buffer.from(name, "utf8"))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = hash.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Epoch ms -> RFC 3339 (JMAP Date). Falls back to the epoch for bad input. */
function epochMsToVconDate(ms: number): VconDate {
  const d = new Date(typeof ms === "number" && Number.isFinite(ms) ? ms : 0);
  return d.toISOString();
}

/** RFC 3339 -> epoch ms, or undefined when unparseable. */
function vconDateToEpochMs(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

// ---------------------------------------------------------------------------
// curt -> vCon
// ---------------------------------------------------------------------------

const CURT_ROLES = ["user", "assistant", "system", "tool"] as const;
type CurtRole = (typeof CURT_ROLES)[number];

function asCurtRole(v: unknown): CurtRole {
  return CURT_ROLES.includes(v as CurtRole) ? (v as CurtRole) : "user";
}

/**
 * Convert a parsed .curt conversation to a vCon object.
 *
 * Mapping (all field names verified against draft-ietf-vcon-vcon-core-05):
 * - `conversation.id` -> `uuid` (UUIDv5, deterministic, see CURT_VCON_UUID_NAMESPACE)
 * - `conversation.createdAt` -> `created_at` (RFC 3339; epoch 0 fallback)
 * - `conversation.updatedAt` -> `updated_at`
 * - `conversation.title` -> `subject`
 * - one Party per distinct message role, `name` = the role string, ordered by
 *   first appearance
 * - each message -> one `dialog` entry of type "text":
 *   `start` = message timestamp (RFC 3339), `parties` = [party index of the
 *   role], `mediatype` = "text/plain", `body` = content, `encoding` = "none",
 *   `message_id` = message id (round-trips the .curt message id)
 *
 * Message-level extra fields (e.g. `model`) have no core vCon home and are
 * dropped. See README.md for the full fidelity matrix.
 */
export function curtToVcon(curt: CurtConversation): Vcon {
  const messages: CurtMessage[] = Array.isArray(curt.messages)
    ? curt.messages
    : [];

  // Parties: one per distinct role, in order of first appearance.
  const roleOrder: CurtRole[] = [];
  for (const m of messages) {
    const role = asCurtRole(m.role);
    if (!roleOrder.includes(role)) roleOrder.push(role);
  }
  // Keep every role representable even with zero messages is unnecessary;
  // an empty parties array is fine for an empty conversation.
  const parties: VconParty[] = roleOrder.map((role) => ({ name: role }));

  const dialog: VconDialog[] = messages.map((m) => ({
    type: "text" as const,
    start: epochMsToVconDate(m.timestamp),
    parties: [roleOrder.indexOf(asCurtRole(m.role))],
    mediatype: "text/plain",
    body: m.content,
    encoding: "none" as const,
    message_id: typeof m.id === "string" ? m.id : undefined,
  }));

  const vcon: Vcon = {
    vcon: VCON_SYNTAX_VERSION,
    uuid: uuidv5(`curt:${curt.id}`, CURT_VCON_UUID_NAMESPACE),
    created_at: epochMsToVconDate(curt.createdAt),
    parties,
    dialog,
  };
  if (typeof curt.updatedAt === "number" && Number.isFinite(curt.updatedAt)) {
    vcon.updated_at = epochMsToVconDate(curt.updatedAt);
  }
  if (typeof curt.title === "string" && curt.title.length > 0) {
    vcon.subject = curt.title;
  }
  return vcon;
}

// ---------------------------------------------------------------------------
// vCon -> curt
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function decodeDialogBody(d: VconDialog): string | undefined {
  if (!("body" in d) || d.body === undefined || d.body === null) return undefined;
  switch (d.encoding) {
    case "none":
      return typeof d.body === "string" ? d.body : undefined;
    case "json":
      // Content must be a string for .curt; JSON values are serialized.
      return typeof d.body === "string" ? d.body : JSON.stringify(d.body);
    case "base64url": {
      if (typeof d.body !== "string") return undefined;
      const b64 = d.body.replace(/-/g, "+").replace(/_/g, "/");
      return Buffer.from(b64, "base64").toString("utf8");
    }
    default:
      // Unrecognized encoding cannot be decoded (draft section 2.5).
      return undefined;
  }
}

/**
 * Convert a vCon object to a .curt conversation.
 *
 * Only text dialogs with inline content are converted; `recording`,
 * `incomplete`, externally referenced (`url`) dialogs, and dialogs with
 * unrecognized encodings are skipped. Party `name` is mapped back to a
 * .curt role when it is one of user/assistant/system/tool, otherwise
 * "user". Timestamps come from `dialog[].start`, falling back to the vCon
 * `created_at`, then epoch 0.
 *
 * Returns null when the input is not vCon-shaped (no object, or no string
 * `uuid`). Note this is a structural check, not full draft validation.
 */
export function vconToCurt(vcon: unknown): CurtConversation | null {
  if (!isRecord(vcon)) return null;
  if (typeof vcon.uuid !== "string" || vcon.uuid.length === 0) return null;

  const parties: VconParty[] = Array.isArray(vcon.parties) ? vcon.parties : [];
  const dialogs: VconDialog[] = Array.isArray(vcon.dialog) ? vcon.dialog : [];

  const createdAtMs = vconDateToEpochMs(vcon.created_at) ?? 0;
  const updatedAtMs = vconDateToEpochMs(vcon.updated_at) ?? createdAtMs;

  const messages: CurtMessage[] = [];
  for (let i = 0; i < dialogs.length; i++) {
    const d = dialogs[i];
    if (!isRecord(d)) continue;
    if (d.type !== "text") continue; // recordings, incomplete, unknown: skipped
    const content = decodeDialogBody(d);
    if (content === undefined) continue;

    // Role recovery: first party index -> party name -> role.
    let partyIndex: number | undefined;
    const p = d.parties;
    if (typeof p === "number") partyIndex = p;
    else if (Array.isArray(p)) {
      const first = p[0];
      if (typeof first === "number") partyIndex = first;
    }
    const partyName = isRecord(parties[partyIndex as number])
      ? (parties as VconParty[])[partyIndex as number].name
      : undefined;
    const role = asCurtRole(partyName);

    const timestamp =
      vconDateToEpochMs(d.start) ?? createdAtMs;
    const id =
      typeof d.message_id === "string" && d.message_id.length > 0
        ? d.message_id
        : `dialog-${i}`;

    messages.push({ id, role, content, timestamp });
  }

  const curt: CurtConversation = {
    id: vcon.uuid,
    title: typeof vcon.subject === "string" ? vcon.subject : "Untitled",
    createdAt: createdAtMs,
    updatedAt: updatedAtMs,
    messages,
  };
  return curt;
}

// ---------------------------------------------------------------------------
// File-level convenience wrappers
// ---------------------------------------------------------------------------

/** Parse a .curt file body and convert it to a vCon. Null on parse failure. */
export function curtFileToVcon(raw: string): Vcon | null {
  const curt = parseCurt(raw);
  return curt === null ? null : curtToVcon(curt);
}

const GENERATOR = `curt-vcon@0.1.0`;

/**
 * Convert a vCon object to a .curt file body (serialized envelope).
 * Null when the vCon is not convertible.
 */
export function vconToCurtFile(vcon: unknown): string | null {
  const curt = vconToCurt(vcon);
  return curt === null ? null : serializeCurt(curt, GENERATOR);
}

// The IPC contract, mirroring the Rust structs in `src-tauri/src/models.rs`.
//
// These are hand-written, which means they CAN drift from Rust. That is the one
// real weakness of this setup, and the fix is codegen (`ts-rs` derives .d.ts
// from the structs during `cargo test`) — tracked in TODO.md. Until then: change
// a Rust struct, change this file in the same commit.
//
// Every field that is `Option<T>` in Rust is `| null` here, never `?`. Serde
// sends an explicit null, and pretending the key might be absent would make
// every read need two checks instead of one.

export interface MemberRow {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  joinedOn: string;
  /** Last day currently paid for. */
  paidThrough: string | null;
  /** Expiry of the newest health certificate on file. */
  certThrough: string | null;
  lastCheckin: string | null;
}

export interface Member {
  id: number;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  notes: string | null;
  joinedOn: string;
}

/** What the create/edit form sends. Blank strings become NULL in Rust. */
export interface MemberInput {
  firstName: string;
  lastName: string;
  nationalId: string;
  birthDate: string;
  phone: string;
  email: string;
  emergencyContact: string;
  emergencyPhone: string;
  notes: string;
}

export interface Membership {
  id: number;
  memberId: number;
  startsOn: string;
  endsOn: string;
  priceCents: number;
  paidCents: number;
  paymentMethod: PaymentMethod | null;
  note: string | null;
  createdAt: string;
  voidedAt: string | null;
}

export type PaymentMethod = "cash" | "card" | "transfer";

export const DOCUMENT_KINDS = [
  "health_cert",
  "id_card",
  "waiver",
  "contract",
  "photo",
  "receipt",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface Doc {
  id: number;
  memberId: number | null;
  kind: DocumentKind;
  title: string | null;
  sha256: string;
  relPath: string;
  mime: string | null;
  bytes: number | null;
  originalName: string | null;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  addedAt: string;
}

export interface DocumentInput {
  memberId: number;
  kind: DocumentKind;
  sourcePath: string;
  title: string;
  issuer: string | null;
  issuedOn: string;
  expiresOn: string;
}

export interface MemberDetail {
  member: Member;
  memberships: Membership[];
  documents: Doc[];
  paidThrough: string | null;
  certThrough: string | null;
}

export interface Checkin {
  id: number;
  memberId: number;
  at: string;
  membershipId: number | null;
  overrideReason: string | null;
}

export interface CheckinRow {
  id: number;
  memberId: number;
  firstName: string;
  lastName: string;
  at: string;
  overrideReason: string | null;
}

export type Filter =
  | "all"
  | "active"
  | "expiring"
  | "expired"
  | "certExpired"
  | "certMissing";

export interface RenewalPreview {
  startsOn: string;
  endsOn: string;
  priceCents: number;
  /** True when the member is still covered and this period stacks. */
  stacks: boolean;
}

export type EntryStatus = "ok" | "warn" | "block";

export interface EntryCheck {
  memberId: number;
  firstName: string;
  lastName: string;
  paidThrough: string | null;
  certThrough: string | null;
  status: EntryStatus;
  reasons: Coded[];
  membershipId: number | null;
}

/** A `{ code, params }` pair the frontend turns into a sentence. */
export interface Coded {
  code: string;
  params: Record<string, string>;
}

/** The serialised shape of Rust's `AppError`. */
export interface ErrorPayload extends Coded {
  /** English developer fallback, shown only for an unmapped code. */
  message: string;
}

export interface ExpiringDocument {
  id: number;
  memberId: number;
  firstName: string;
  lastName: string;
  kind: DocumentKind;
  expiresOn: string;
}

export interface Expiry {
  memberId: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  kind: "membership" | "certificate" | "certificate_missing";
  date: string;
  /** Negative once the date has passed. */
  daysLeft: number;
}

export interface Dashboard {
  gymName: string;
  currency: string;
  today: string;
  activeMembers: number;
  expiringSoon: number;
  expired: number;
  certExpired: number;
  certMissing: number;
  checkinsToday: number;
}

/** The `setting` table, as strings. Everything in SQLite is text here. */
export type Settings = Record<string, string>;

/** Parsed once at the shell, so the status rule is not re-parsing on every badge. */
export interface StatusSettings {
  graceDays: number;
  warnDays: number;
  certWarnDays: number;
}

export type Tone = "ok" | "warn" | "bad" | "plain";

export interface BadgeSpec {
  tone: Tone;
  text: string;
}

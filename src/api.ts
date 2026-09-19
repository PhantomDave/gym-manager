// The only module that talks to Rust.
//
// Every command goes through `call`, so a failure can never pass silently and
// backend error codes are translated in exactly one place. The return types
// here are the contract with `src-tauri/src/models.rs` — see types.ts.

import { translateCode } from "./i18n.js";
import type {
  Checkin,
  CheckinRow,
  Dashboard,
  Doc,
  DocumentInput,
  EntryCheck,
  ErrorPayload,
  Expiry,
  ExpiringDocument,
  Filter,
  MemberDetail,
  MemberInput,
  MemberRow,
  Membership,
  PaymentMethod,
  RenewalPreview,
  Settings,
} from "./types.js";

const { invoke } = window.__TAURI__.core;
const { open: openFileDialog } = window.__TAURI__.dialog;

/** Carries a message already in the operator's language. */
export class ApiError extends Error {
  readonly code: string;
  readonly params: Record<string, string>;

  constructor(payload: ErrorPayload) {
    super(translateCode(payload, "err."));
    this.name = "ApiError";
    this.code = payload.code;
    this.params = payload.params ?? {};
  }
}

type ErrorHandler = (error: ApiError) => void;
let onError: ErrorHandler = () => {};

/** Installed once, at boot, by the app shell. */
export const setErrorHandler = (fn: ErrorHandler): void => {
  onError = fn;
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    // Tauri serialises AppError as { code, message, params }. Anything else is
    // a bug in the bridge rather than a business failure, so it is wrapped with
    // a code that no catalogue maps and falls through to the raw message.
    const payload: ErrorPayload =
      raw !== null && typeof raw === "object" && "code" in raw
        ? (raw as ErrorPayload)
        : { code: "unknown", message: String(raw), params: {} };

    const error = new ApiError(payload);
    onError(error);
    throw error;
  }
}

export const api = {
  dashboard: () => call<Dashboard>("dashboard"),
  settingsAll: () => call<Settings>("settings_all"),
  settingsSet: (key: string, value: string) => call<null>("settings_set", { key, value }),
  backupNow: () => call<string>("backup_now"),

  membersList: (args: { filter?: Filter; query?: string; limit?: number }) =>
    call<MemberRow[]>("members_list", args),
  memberGet: (id: number) => call<MemberDetail>("member_get", { id }),
  memberCreate: (input: MemberInput) => call<number>("member_create", { input }),
  memberUpdate: (id: number, input: MemberInput) => call<null>("member_update", { id, input }),
  memberArchive: (id: number) => call<null>("member_archive", { id }),

  membershipPreview: (memberId: number) =>
    call<RenewalPreview>("membership_preview", { memberId }),
  membershipRenew: (args: {
    memberId: number;
    priceCents: number;
    paidCents: number;
    paymentMethod: PaymentMethod;
    note: string;
  }) => call<Membership>("membership_renew", args),
  membershipVoid: (id: number, reason: string) => call<null>("membership_void", { id, reason }),

  documentAdd: (input: DocumentInput) => call<Doc>("document_add", { input }),
  documentOpen: (id: number) => call<null>("document_open", { id }),
  documentDelete: (id: number) => call<null>("document_delete", { id }),
  documentsExpiring: (kind: string, days: number) =>
    call<ExpiringDocument[]>("documents_expiring", { kind, days }),

  expiriesList: (days: number, overdueDays: number) =>
    call<Expiry[]>("expiries_list", { days, overdueDays }),
  certificatesMissing: () => call<Expiry[]>("certificates_missing"),

  entryCheck: (memberId: number) => call<EntryCheck>("entry_check", { memberId }),
  checkinCreate: (memberId: number, overrideReason: string | null) =>
    call<Checkin>("checkin_create", { memberId, overrideReason }),
  checkinsToday: () => call<CheckinRow[]>("checkins_today"),
};

/** Native file picker, restricted to what the document store accepts. */
export async function pickDocument(): Promise<string | null> {
  const chosen = await openFileDialog({
    multiple: false,
    filters: [
      { name: "Documenti", extensions: ["pdf", "jpg", "jpeg", "png", "webp", "tif", "tiff"] },
    ],
  });
  // `multiple: false` means a single path, but the signature allows an array.
  return Array.isArray(chosen) ? (chosen[0] ?? null) : chosen;
}

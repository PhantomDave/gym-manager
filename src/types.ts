// The IPC contract. Everything below is re-exported from `bindings.ts`, which
// `ts-rs` derives from the Rust structs in `src-tauri/src` during `cargo
// test` — see that file's header. It can no longer drift, so it is no longer
// hand-written here.
//
// The four types below have no Rust struct to derive from (they are computed
// in the frontend, not sent over IPC) and stay hand-written by necessity.

export * from "./bindings.js";

/** The `setting` table, as strings. Everything in SQLite is text here. */
export type Settings = Record<string, string>;

/** Parsed once at the shell, so the status rule is not re-parsing on every badge. */
export interface StatusSettings {
  graceDays: number;
  warnDays: number;
  certWarnDays: number;
}

export type Tone = "ok" | "warn" | "blocked" | "plain";

export interface BadgeSpec {
  tone: Tone;
  text: string;
}

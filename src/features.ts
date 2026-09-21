// Optional parts of the app, switched on and off in one place.
//
// This gym does not take attendance and does not want to record how each
// person paid, so both are off. They are switched rather than deleted because
// the code and the database behind them are intact and a different desk may
// want them: flip a flag here, rebuild, and the screens come back.
//
// These are BUILD-TIME constants, not settings rows, and that is deliberate.
// The setting screen is operated by a receptionist between customers; a toggle
// that removes half the main screen does not belong next to "gym name". Turning
// one of these on is a decision the owner makes once, and it ships in the .deb.
//
// What a flag does NOT do is touch the database. The `checkin` table, the
// `payment_method` column and the Rust commands behind both stay exactly as
// they are — rows already recorded are still there, still backed up, and
// visible again the moment a flag goes back to `true`. Nothing here deletes
// money or people; see AGENTS.md.

export const FEATURES = {
  /**
   * Record who trained and when, and check membership and certificate at the
   * door before admitting them.
   *
   * Off: the Today screen keeps the search box — it is still the fastest way to
   * reach a member card — but it opens the card instead of admitting, there is
   * no entry banner or override, no "checked in today" list, and no visits
   * tile. `checkin_create` / `checkins_today` / `entry_check` are simply never
   * called; they remain registered in lib.rs.
   */
  checkins: false,

  /**
   * Ask how a renewal was paid (cash, card, transfer) and show it in the
   * member's payment history.
   *
   * Off: the renewal dialog asks for the amount only and sends no method, so
   * new rows have `payment_method = NULL` — which the column already allows.
   * Methods recorded before the flag was turned off stay in the database; they
   * are hidden, not lost.
   */
  paymentMethod: false,
} as const;

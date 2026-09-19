//! Membership period arithmetic.
//!
//! Three rules govern every membership period in this app:
//!
//! 1. A period is one calendar month, clamped to the end of the target month.
//!    Jan 15 -> Feb 14. Jan 31 -> Feb 27, because `Jan 31 + 1 month` clamps to
//!    Feb 28 and the end date is inclusive.
//! 2. Renewing early stacks: the new period begins the day after the current
//!    one ends, so paying ahead never costs the member days.
//! 3. Renewing after a lapse starts today: lapsing never grants backdated time.
//!
//! Grace periods are deliberately NOT modelled here. Grace is a display
//! concept (see `settings.grace_days`); baking it into `ends_on` would let it
//! compound on every renewal.

use chrono::{Months, NaiveDate};

/// Same day next month, clamped to the last day of that month.
pub fn add_month(start: NaiveDate) -> NaiveDate {
    start
        .checked_add_months(Months::new(1))
        .expect("date out of representable range")
}

/// Inclusive end date of a one-month period beginning on `start`.
pub fn period_end(start: NaiveDate) -> NaiveDate {
    add_month(start)
        .pred_opt()
        .expect("date out of representable range")
}

/// The day a new period should begin.
///
/// `paid_through` is the member's current latest coverage, if any.
pub fn next_start(today: NaiveDate, paid_through: Option<NaiveDate>) -> NaiveDate {
    match paid_through {
        // Still covered: stack on top of the existing period.
        Some(end) if end >= today => end.succ_opt().expect("date out of representable range"),
        // Lapsed, or brand new: start today.
        _ => today,
    }
}

/// Convenience: the (start, end) pair for the next period.
pub fn next_period(today: NaiveDate, paid_through: Option<NaiveDate>) -> (NaiveDate, NaiveDate) {
    let start = next_start(today, paid_through);
    (start, period_end(start))
}

/// Whether `a` and `b` (both inclusive ranges) overlap at all.
pub fn overlaps(a: (NaiveDate, NaiveDate), b: (NaiveDate, NaiveDate)) -> bool {
    a.0 <= b.1 && b.0 <= a.1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn ordinary_month() {
        assert_eq!(period_end(d("2026-01-15")), d("2026-02-14"));
        assert_eq!(period_end(d("2026-06-01")), d("2026-06-30"));
    }

    #[test]
    fn end_of_month_clamps_short() {
        // Jan 31 + 1 month = Feb 28 (clamped), minus one day for inclusivity.
        assert_eq!(period_end(d("2026-01-31")), d("2026-02-27"));
        assert_eq!(period_end(d("2026-03-31")), d("2026-04-29"));
    }

    #[test]
    fn leap_year() {
        assert_eq!(period_end(d("2024-01-31")), d("2024-02-28"));
        assert_eq!(period_end(d("2024-02-29")), d("2024-03-28"));
    }

    #[test]
    fn year_rollover() {
        assert_eq!(period_end(d("2026-12-15")), d("2027-01-14"));
    }

    #[test]
    fn early_renewal_stacks() {
        let today = d("2026-03-20");
        let paid_through = Some(d("2026-03-28"));
        assert_eq!(next_start(today, paid_through), d("2026-03-29"));
    }

    #[test]
    fn renewal_on_the_last_covered_day_still_stacks() {
        let today = d("2026-03-28");
        assert_eq!(next_start(today, Some(d("2026-03-28"))), d("2026-03-29"));
    }

    #[test]
    fn lapsed_member_starts_today() {
        let today = d("2026-03-20");
        assert_eq!(next_start(today, Some(d("2026-02-28"))), today);
    }

    #[test]
    fn new_member_starts_today() {
        let today = d("2026-03-20");
        assert_eq!(next_start(today, None), today);
    }

    #[test]
    fn stacked_periods_never_overlap() {
        let today = d("2026-01-15");
        let (s1, e1) = next_period(today, None);
        let (s2, e2) = next_period(today, Some(e1));
        assert!(!overlaps((s1, e1), (s2, e2)));
        assert_eq!(s2, e1.succ_opt().unwrap());
    }

    #[test]
    fn overlap_detection() {
        assert!(overlaps(
            (d("2026-01-01"), d("2026-01-31")),
            (d("2026-01-31"), d("2026-02-28"))
        ));
        assert!(!overlaps(
            (d("2026-01-01"), d("2026-01-30")),
            (d("2026-01-31"), d("2026-02-28"))
        ));
    }
}

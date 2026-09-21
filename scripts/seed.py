#!/usr/bin/env python3
"""Fill a database with demo members, so the interface can be judged without
hand-entering rows.

Fifty people across every combination of membership state and certificate
state, plus the awkward cases that only show up in real use: partial payments,
a voided membership, archived members, overridden check-ins, a name with an
apostrophe in it.

    python3 scripts/seed.py --db /tmp/demo.db     # a throwaway database
    python3 scripts/seed.py --reset               # the real one, wiped first

Defaults to the app's own database. It refuses to touch one that already has
members unless `--reset` is given, and `--reset` deletes *everything* — it is
for a demo machine, never for the gym's.

Written against sqlite3 from the standard library rather than as a Rust test
fixture, because the point is to hand a populated database to a person who then
opens the app and looks at it. Schema comes from the shipped migrations, so
this file never repeats the table definitions.

The generated data is obviously fake by construction: addresses are at
`.invalid` (reserved by RFC 2606, so it can never reach anyone), the national
IDs are codice-fiscale *shaped* but their checksum is not computed, and the gym
is named "Palestra Demo".
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import random
import sqlite3
import sys
from datetime import date, datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "src-tauri" / "src" / "migrations"
DEFAULT_DB = (
    pathlib.Path.home() / ".local/share/dev.phantomdave.gymmanager/gym.db"
)

# --- the buckets -----------------------------------------------------------
#
# Each bucket is an offset in days from today, applied to the date the UI reads
# (`paid_through`, `cert_through`). The offsets are chosen to land either side
# of the warning thresholds in `setting`: expiry_warning_days is 7 and
# cert_warning_days is 30 by default.
#
# The names below are the *situation*, not the colour. Deciding which colour a
# date becomes belongs to `statusOf()` in src/lib/status.ts and to `evaluate()`
# in commands/checkins.rs, and is deliberately not repeated here — if this
# script also encoded the rule, the two could disagree and the seeder would be
# the one lying.
#
# `grace` reads as "in grace" only when grace_days > 0; with the default of 0
# the app shows it as expired-by-one-day. That is the point of having it.

MEMBERSHIP_BUCKETS: dict[str, int | None] = {
    "none": None,      # never had a membership
    "expired": -45,    # lapsed a month and a half ago
    "grace": -1,       # ended yesterday
    "today": 0,        # last paid day is today
    "soon": 3,         # inside expiry_warning_days
    "ok": 20,          # comfortably paid up
}

CERT_BUCKETS: dict[str, int | None] = {
    "missing": None,   # no certificate on file
    "expired": -20,
    "soon": 10,        # inside cert_warning_days
    "ok": 200,
}

FIRST_NAMES = [
    "Giulia", "Marco", "Francesca", "Alessandro", "Chiara", "Matteo",
    "Sara", "Lorenzo", "Martina", "Andrea", "Elena", "Davide",
    "Federica", "Simone", "Alice", "Niccolò", "Valentina", "Riccardo",
    "Ilaria", "Tommaso", "Beatrice", "Gabriele", "Camilla", "Stefano",
    "Arianna", "Luca", "Silvia", "Emanuele", "Noemi", "Pietro",
]

LAST_NAMES = [
    "Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano",
    "Colombo", "Ricci", "Marino", "Greco", "Bruno", "Gallo",
    "Conti", "De Luca", "Mancini", "Costa", "Giordano", "Rizzo",
    "Lombardi", "Moretti", "Barbieri", "Fontana", "Santoro", "Mariani",
    "Rinaldi", "Caruso", "Ferrara", "Galli", "Martini", "D'Angelo",
]

PAYMENT_METHODS = ["cash", "card", "transfer"]


# --- dates -----------------------------------------------------------------
#
# Mirrors dates.rs: a period is one calendar month clamped to the end of the
# target month, and the end date is inclusive. Only enough of it to walk a
# member's history backwards from the date they are paid through.

def _clamp_month(year: int, month: int, day: int) -> date:
    while True:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1


def add_month(d: date) -> date:
    year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return _clamp_month(year, month, d.day)


def sub_month(d: date) -> date:
    year, month = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
    return _clamp_month(year, month, d.day)


def period_start_for_end(end: date) -> date:
    """The start date of the one-month period that ends (inclusive) on `end`."""
    return sub_month(end + timedelta(days=1))


# --- the placeholder documents ---------------------------------------------

def tiny_pdf(lines: list[str]) -> bytes:
    """A one-page PDF that a real viewer will actually open.

    `document_open` hands the file to `xdg-open`, so a demo whose certificates
    are broken files teaches the wrong thing about the app. This is the
    smallest structurally valid PDF with a line of text on it — objects, an
    xref table with real byte offsets, a trailer.
    """
    text = "\n".join(
        f"BT /F1 13 Tf 72 {780 - i * 22} Td ({escape_pdf(line)}) Tj ET"
        for i, line in enumerate(lines)
    ).encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text) + 1, text),
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref_at,
    )
    return bytes(out)


def escape_pdf(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def store(data_dir: pathlib.Path, content: bytes) -> tuple[str, str, int]:
    """Write `content` into the content-addressed store, as storage.rs lays it
    out: docs/<first two hex chars>/<sha256>.pdf. Identical content lands on
    the same path and is written once, which is the dedup the app relies on."""
    digest = hashlib.sha256(content).hexdigest()
    rel = f"docs/{digest[:2]}/{digest}.pdf"
    dest = data_dir / rel
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    return digest, rel, len(content)


# --- schema ----------------------------------------------------------------

def migrate(conn: sqlite3.Connection) -> None:
    """Apply the shipped migrations, tracked by user_version — the same loop as
    db.rs, so a fresh file can be seeded without booting the app first."""
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        sys.exit(f"no migrations found in {MIGRATIONS}")
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for index, path in enumerate(files, start=1):
        if current >= index:
            continue
        conn.executescript(path.read_text())
        conn.execute(f"PRAGMA user_version = {index}")
        conn.commit()


# --- generation ------------------------------------------------------------

class Seeder:
    def __init__(self, conn: sqlite3.Connection, data_dir: pathlib.Path,
                 today: date, rng: random.Random):
        self.conn = conn
        self.data_dir = data_dir
        self.today = today
        self.rng = rng
        self.used_names: set[tuple[str, str]] = set()
        self.used_ids: set[str] = set()
        self.plan: list[tuple[int, str, str]] = []  # member id, buckets

    def run(self, count: int) -> None:
        pairs = [(m, c) for m in MEMBERSHIP_BUCKETS for c in CERT_BUCKETS]

        # Every combination once, so nothing in the matrix is untested...
        for membership, cert in pairs:
            self.member(membership, cert)

        # ...then the cases that are awkward to enter by hand...
        self.awkward_cases()

        # ...then fill up to `count` with the shape of a real gym: mostly paid
        # up, mostly with a valid certificate, a tail of people who lapsed.
        # Archived members are extra: they are deliberately outside every list
        # the app shows, so counting them towards `count` would make the
        # visible population smaller than asked for.
        weighted = self.rng.choices(
            pairs,
            weights=[self.weight(m, c) for m, c in pairs],
            k=max(0, count - len(self.plan)),
        )
        for membership, cert in weighted:
            self.member(membership, cert)

        self.conn.commit()

    @staticmethod
    def weight(membership: str, cert: str) -> int:
        m = {"ok": 10, "soon": 4, "today": 2, "grace": 2, "expired": 3, "none": 1}
        c = {"ok": 10, "soon": 4, "expired": 2, "missing": 2}
        return m[membership] * c[cert]

    def name(self) -> tuple[str, str]:
        for _ in range(500):
            pair = (self.rng.choice(FIRST_NAMES), self.rng.choice(LAST_NAMES))
            if pair not in self.used_names:
                self.used_names.add(pair)
                return pair
        # Exhausted the combinations; number the duplicates rather than loop.
        first, last = self.rng.choice(FIRST_NAMES), self.rng.choice(LAST_NAMES)
        return first, f"{last} {len(self.used_names)}"

    def national_id(self, first: str, last: str) -> str:
        """Codice-fiscale *shaped*, deliberately not valid: the check character
        is random, so this can never collide with a real person's.

        `member.national_id` has a unique index, so the loop matters — two
        people out of two hundred drawing the same digits would otherwise end
        the run with an IntegrityError halfway through."""
        letters = "ABCDEFGHILMNPRSTVZ"
        stem = (last.upper() + "XXX").replace(" ", "").replace("'", "")[:3]
        stem += (first.upper() + "XXX").replace(" ", "")[:3]
        stem = "".join(c if c.isascii() and c.isalpha() else "X" for c in stem)
        while True:
            candidate = (
                f"{stem}{self.rng.randint(40, 99)}"
                f"{self.rng.choice(letters)}{self.rng.randint(10, 28):02d}"
                f"{self.rng.choice(letters)}{self.rng.randint(100, 999)}"
                f"{self.rng.choice(letters)}"
            )
            if candidate not in self.used_ids:
                self.used_ids.add(candidate)
                return candidate

    def member(self, membership: str, cert: str, *, archived: bool = False,
               partial: bool = False, voided: bool = False,
               name: tuple[str, str] | None = None) -> int:
        first, last = name or self.name()
        self.used_names.add((first, last))
        joined = self.today - timedelta(days=self.rng.randint(20, 900))

        # Nobody can hold a membership that started before they joined, and the
        # history walk below stops at `joined`. Someone who joined three weeks
        # ago but is meant to have lapsed two months ago would otherwise come
        # out with no membership at all and land in the wrong bucket — which is
        # what `verify()` catches. Move the joining date instead.
        offset = MEMBERSHIP_BUCKETS[membership]
        if offset is not None:
            first_start = period_start_for_end(self.today + timedelta(days=offset))
            joined = min(joined, first_start)

        # A third of a gym's members never hand over a phone number or an
        # email, and the UI has to look right when the column is empty.
        has_phone = self.rng.random() > 0.15
        has_email = self.rng.random() > 0.35
        slug = f"{first}.{last}".lower().replace(" ", "").replace("'", "")

        cur = self.conn.execute(
            """INSERT INTO member (first_name, last_name, national_id, birth_date,
                                   phone, email, emergency_contact, emergency_phone,
                                   notes, joined_on, created_at, archived_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                first,
                last,
                self.national_id(first, last) if self.rng.random() > 0.2 else None,
                self.birth_date().isoformat(),
                f"+39 3{self.rng.randint(10, 99)} {self.rng.randint(100, 999)} "
                f"{self.rng.randint(1000, 9999)}" if has_phone else None,
                # .invalid is reserved and cannot resolve, so demo data can
                # never accidentally email a real person.
                f"{slug}@example.invalid" if has_email else None,
                self.rng.choice(FIRST_NAMES) + " " + last if self.rng.random() > 0.6 else None,
                f"+39 3{self.rng.randint(10, 99)} {self.rng.randint(100, 999)} "
                f"{self.rng.randint(1000, 9999)}" if self.rng.random() > 0.7 else None,
                self.rng.choice(NOTES) if self.rng.random() > 0.75 else None,
                joined.isoformat(),
                f"{joined.isoformat()} 09:00:00",
                f"{(self.today - timedelta(days=5)).isoformat()} 17:30:00"
                if archived else None,
            ),
        )
        member_id = cur.lastrowid

        self.memberships(member_id, membership, joined, partial=partial, voided=voided)
        self.certificate(member_id, cert, first, last)
        self.extra_documents(member_id, first, last)
        self.checkins(member_id, membership, cert)

        if not archived:
            self.plan.append((member_id, membership, cert))
        return member_id

    def birth_date(self) -> date:
        year = self.today.year - self.rng.randint(18, 68)
        return _clamp_month(year, self.rng.randint(1, 12), self.rng.randint(1, 28))

    def memberships(self, member_id: int, bucket: str, joined: date, *,
                    partial: bool, voided: bool) -> None:
        """Walk consecutive one-month periods backwards from the date the member
        is paid through, so the drawer shows a history rather than one row."""
        offset = MEMBERSHIP_BUCKETS[bucket]
        if offset is None:
            return

        # The newest period is the one that sets paid_through and is always
        # written; `joined` only decides how far back the history runs.
        end = self.today + timedelta(days=offset)
        price = int(self.conn.execute(
            "SELECT value FROM setting WHERE key = 'default_price_cents'"
        ).fetchone()[0])

        for index in range(self.rng.randint(1, 4)):
            start = period_start_for_end(end)
            if index > 0 and start < joined:
                break
            paid = price
            if partial and index == 0:
                paid = price - self.rng.choice([500, 1000, 1500])
            self.conn.execute(
                """INSERT INTO membership (member_id, starts_on, ends_on, price_cents,
                                           paid_cents, payment_method, note, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    member_id,
                    start.isoformat(),
                    end.isoformat(),
                    price,
                    paid,
                    self.rng.choice(PAYMENT_METHODS),
                    "saldo da incassare" if paid < price else None,
                    f"{start.isoformat()} {self.rng.randint(9, 19):02d}:15:00",
                ),
            )
            end = start - timedelta(days=1)

        if voided:
            # A period entered by mistake and reversed: it must not count
            # towards paid_through, which is what the view is asked below.
            wrong_start = self.today + timedelta(days=40)
            self.conn.execute(
                """INSERT INTO membership (member_id, starts_on, ends_on, price_cents,
                                           paid_cents, payment_method, created_at,
                                           voided_at, void_reason)
                   VALUES (?, ?, ?, ?, ?, 'cash', ?, ?, ?)""",
                (
                    member_id,
                    wrong_start.isoformat(),
                    period_end_of(wrong_start).isoformat(),
                    price,
                    price,
                    f"{self.today.isoformat()} 10:00:00",
                    f"{self.today.isoformat()} 10:04:00",
                    "inserita sulla persona sbagliata",
                ),
            )

    def certificate(self, member_id: int, bucket: str, first: str, last: str) -> None:
        offset = CERT_BUCKETS[bucket]
        if offset is None:
            return
        expires = self.today + timedelta(days=offset)
        issued = sub_month(sub_month(expires))
        issuer = self.rng.choice(ISSUERS)
        sha, rel, size = store(self.data_dir, tiny_pdf([
            "CERTIFICATO MEDICO - DATI DIMOSTRATIVI",
            f"{first} {last}",
            f"Rilasciato da: {issuer}",
            f"Emesso il {issued.isoformat()} - scade il {expires.isoformat()}",
            "Questo file e' generato da scripts/seed.py. Non e' un documento reale.",
        ]))
        self.conn.execute(
            """INSERT INTO document (member_id, kind, title, sha256, rel_path, mime,
                                     bytes, original_name, issuer, issued_on,
                                     expires_on, added_at)
               VALUES (?, 'health_cert', ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)""",
            (
                member_id,
                "Certificato medico",
                sha,
                rel,
                size,
                f"certificato-{last.lower().replace(' ', '')}.pdf",
                issuer,
                issued.isoformat(),
                expires.isoformat(),
                f"{issued.isoformat()} 11:00:00",
            ),
        )

    def extra_documents(self, member_id: int, first: str, last: str) -> None:
        """A minority of members have more than a certificate on file, so the
        document list is not a single row everywhere you look."""
        for kind, title in [("id_card", "Documento d'identita'"),
                            ("waiver", "Liberatoria firmata")]:
            if self.rng.random() > 0.25:
                continue
            sha, rel, size = store(self.data_dir, tiny_pdf([
                f"{title.upper()} - DATI DIMOSTRATIVI",
                f"{first} {last}",
                "Generato da scripts/seed.py.",
            ]))
            self.conn.execute(
                """INSERT INTO document (member_id, kind, title, sha256, rel_path,
                                         mime, bytes, original_name, added_at)
                   VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?)""",
                (
                    member_id, kind, title, sha, rel, size,
                    f"{kind}-{last.lower().replace(' ', '')}.pdf",
                    f"{(self.today - timedelta(days=self.rng.randint(1, 400))).isoformat()}"
                    " 12:00:00",
                ),
            )

    def checkins(self, member_id: int, membership: str, cert: str) -> None:
        """Visits over the last month, denser for people in good standing.

        `membership_id` records which period authorised the entry, as
        checkin_create does; where nothing covered that day it stays NULL and
        the row carries an override reason instead."""
        blocked = membership in ("none", "expired") or cert in ("missing", "expired")

        # Someone who cannot train mostly does not turn up, and when they do
        # the desk lets them in once and tells them to sort it out — not a
        # month of overrides. Anything else makes the override list, which is
        # meant to be read, useless.
        visits = self.rng.randint(0, 2) if blocked else self.rng.randint(0, 12)

        for _ in range(visits):
            when = self.today - timedelta(days=self.rng.randint(0, 30))
            at = f"{when.isoformat()} {self.rng.randint(8, 21):02d}:{self.rng.choice(['05', '20', '35', '50'])}:00"
            covering = self.conn.execute(
                """SELECT id FROM membership
                    WHERE member_id = ? AND voided_at IS NULL
                      AND starts_on <= ? AND ends_on >= ?
                    ORDER BY ends_on DESC LIMIT 1""",
                (member_id, when.isoformat(), when.isoformat()),
            ).fetchone()
            self.conn.execute(
                "INSERT INTO checkin (member_id, at, membership_id, override_reason) "
                "VALUES (?, ?, ?, ?)",
                (
                    member_id,
                    at,
                    covering[0] if covering else None,
                    self.rng.choice(OVERRIDES) if blocked and covering is None else None,
                ),
            )

    def awkward_cases(self) -> None:
        """The rows that are easy to forget and awkward to enter by hand."""
        # Someone who paid part of the month and owes the rest.
        for _ in range(3):
            self.member("ok", "ok", partial=True)
        self.member("soon", "soon", partial=True)

        # A membership entered against the wrong person and reversed.
        self.member("ok", "ok", voided=True)

        # Archived members: invisible in every list today, which is exactly the
        # gap the "Archived filter + restore" item in TODO.md is about.
        for _ in range(2):
            self.member("expired", "expired", archived=True)

        # Two people who share a surname, so searching by it returns more than
        # one row and the desk has to pick.
        self.member("ok", "ok", name=("Giulia", "Rossi"))
        self.member("soon", "ok", name=("Marco", "Rossi"))


def period_end_of(start: date) -> date:
    return add_month(start) - timedelta(days=1)


NOTES = [
    "Preferisce allenarsi la mattina presto.",
    "Ginocchio destro — evitare salti.",
    "Ha chiesto informazioni sul corso di pilates.",
    "Paga sempre in contanti.",
    "Tesserino consegnato il primo giorno.",
]

ISSUERS = [
    "Dott. Bianchi — Centro Medico Aurora",
    "Poliambulatorio San Marco",
    "Dott.ssa Conti — Medicina dello Sport",
    "Centro Medico Valverde",
]

OVERRIDES = [
    "certificato in arrivo domani",
    "rinnovo gia' concordato, paga sabato",
    "prova gratuita autorizzata dal titolare",
]


# --- verification ----------------------------------------------------------

def verify(conn: sqlite3.Connection, plan: list[tuple[int, str, str]],
           today: date) -> list[str]:
    """Read the seeded state back out of `member_status` — the same view the UI
    reads — and confirm it says what the plan intended.

    This is the check, not the print: it compares the dates the view reports
    against the offsets each member was generated for, and fails if any
    combination in the matrix ended up with nobody in it. Break a bucket offset
    on purpose and this goes red."""
    problems: list[str] = []
    seen: set[tuple[str, str]] = set()

    for member_id, membership, cert in plan:
        row = conn.execute(
            "SELECT paid_through, cert_through FROM member_status WHERE id = ?",
            (member_id,),
        ).fetchone()
        if row is None:
            problems.append(f"member {member_id} is missing from member_status")
            continue
        paid, cert_through = row
        seen.add((membership, cert))

        for label, actual, offset in (
            ("paid_through", paid, MEMBERSHIP_BUCKETS[membership]),
            ("cert_through", cert_through, CERT_BUCKETS[cert]),
        ):
            expected = (
                None if offset is None
                else (today + timedelta(days=offset)).isoformat()
            )
            if actual != expected:
                problems.append(
                    f"member {member_id} ({membership}/{cert}): {label} is "
                    f"{actual!r}, expected {expected!r}"
                )

    for membership in MEMBERSHIP_BUCKETS:
        for cert in CERT_BUCKETS:
            if (membership, cert) not in seen:
                problems.append(f"no member covers {membership}/{cert}")
    return problems


def report(conn: sqlite3.Connection, plan: list[tuple[int, str, str]]) -> None:
    counts: dict[tuple[str, str], int] = {}
    for _, membership, cert in plan:
        counts[(membership, cert)] = counts.get((membership, cert), 0) + 1

    width = max(len(m) for m in MEMBERSHIP_BUCKETS) + 2
    header = "".rjust(width) + "".join(c.rjust(9) for c in CERT_BUCKETS)
    print("\nmembers by membership state (rows) and certificate state (columns)")
    print(header)
    for membership in MEMBERSHIP_BUCKETS:
        line = membership.rjust(width)
        for cert in CERT_BUCKETS:
            line += str(counts.get((membership, cert), 0)).rjust(9)
        print(line)

    totals = [
        ("members in the view", "SELECT count(*) FROM member_status"),
        ("archived members",
         "SELECT count(*) FROM member WHERE archived_at IS NOT NULL"),
        ("memberships", "SELECT count(*) FROM membership WHERE voided_at IS NULL"),
        ("voided memberships",
         "SELECT count(*) FROM membership WHERE voided_at IS NOT NULL"),
        ("unpaid balances",
         "SELECT count(*) FROM membership WHERE paid_cents < price_cents"),
        ("documents", "SELECT count(*) FROM document"),
        ("check-ins", "SELECT count(*) FROM checkin"),
        ("check-ins today",
         "SELECT count(*) FROM checkin WHERE date(at) = date('now','localtime')"),
        ("overridden entries",
         "SELECT count(*) FROM checkin WHERE override_reason IS NOT NULL"),
    ]
    print()
    for label, sql in totals:
        print(f"{label.rjust(22)}: {conn.execute(sql).fetchone()[0]}")


# --- entry point -----------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--db", type=pathlib.Path, default=DEFAULT_DB,
                        help=f"database file (default: {DEFAULT_DB})")
    parser.add_argument("--members", type=int, default=50,
                        help="how many to generate (default: 50, minimum 24 — "
                             "one per combination)")
    parser.add_argument("--reset", action="store_true",
                        help="DELETE every member, membership, document row and "
                             "check-in first. Never run this on the gym's database.")
    parser.add_argument("--seed", type=int, default=20260921,
                        help="RNG seed; the same seed gives the same people")
    args = parser.parse_args()

    combinations = len(MEMBERSHIP_BUCKETS) * len(CERT_BUCKETS)
    if args.members < combinations:
        return fail(f"--members must be at least {combinations}, one per "
                    f"combination of membership and certificate state")

    data_dir = args.db.parent
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")
    migrate(conn)

    existing = conn.execute("SELECT count(*) FROM member").fetchone()[0]
    if existing and not args.reset:
        return fail(
            f"{args.db} already has {existing} members.\n"
            "Seed a throwaway file instead (--db /tmp/demo.db), or pass --reset "
            "to wipe this one."
        )
    if existing:
        print(f"--reset: deleting {existing} members and everything attached "
              f"to them from {args.db}")
        for table in ("checkin", "document", "membership", "member"):
            conn.execute(f"DELETE FROM {table}")
        conn.commit()

    # Names the gym: whoever opens this can see at a glance it is not real data.
    conn.execute(
        "INSERT INTO setting (key, value) VALUES ('gym_name', 'Palestra Demo') "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )

    today = datetime.now().date()
    seeder = Seeder(conn, data_dir, today, random.Random(args.seed))
    seeder.run(args.members)

    problems = verify(conn, seeder.plan, today)
    report(conn, seeder.plan)
    print(f"\ndatabase: {args.db}\ndocuments: {data_dir / 'docs'}")

    if problems:
        print("\nthe seeded data is not what was asked for:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print(f"\nseeded {len(seeder.plan)} members, every combination covered.")
    return 0


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

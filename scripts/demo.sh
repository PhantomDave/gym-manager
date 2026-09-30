#!/usr/bin/env bash
# Fill this machine's app database with demo members and open the app on it,
# so a change can be judged against a roster the size of a real gym's.
#
#     scripts/demo.sh                # 200 members, then `cargo tauri dev`
#     scripts/demo.sh --members 80   # a different size
#     scripts/demo.sh --no-run       # seed only
#
# It WIPES the app's database (seed.py --reset), after copying it to
# demo-backups/ next to it. That is fine on a development machine and never
# acceptable on the gym's: nothing here can tell the two apart, so never run
# it on the desk.
#
# The data directory follows the identifier in tauri.conf.json, which is what
# `app_data_dir()` resolves to on Linux.

set -euo pipefail

members=200
run=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --members) members="$2"; shift 2 ;;
    --no-run) run=0; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "$0")/.." && pwd)"
identifier="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["identifier"])' \
  "$root/src-tauri/tauri.conf.json")"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/$identifier"
db="$data_dir/gym.db"

# Seeding under a running app would race its open connection.
if pgrep -x gym-manager >/dev/null; then
  echo "gym-manager is running; close it first." >&2
  exit 1
fi

if [[ -f "$db" ]]; then
  mkdir -p "$data_dir/demo-backups"
  backup="$data_dir/demo-backups/gym-$(date +%Y%m%d-%H%M%S).db"
  # The backup API, not cp: the database runs in WAL mode and a copy of the
  # main file alone can miss committed pages still in gym.db-wal.
  python3 -c 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close()' \
    "$db" "$backup"
  echo "previous database saved to $backup"
fi

python3 "$root/scripts/seed.py" --db "$db" --reset --members "$members"

if [[ $run -eq 1 ]]; then
  cd "$root/src-tauri"
  exec cargo tauri dev
fi

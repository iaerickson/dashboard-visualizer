#!/usr/bin/env python3
"""
mark_report_viewed.py — Reports Tray v2 (2026-08-08). Updates one source's
entry in config/reports_viewed.json when Ian clicks open a hex in the
Reports Tray. Called by the widget itself via Übersicht's `run()` shell-out
(same mechanism claudespace-status/index.jsx's own copyPrompt already uses
for copy-to-clipboard - this isn't a new interaction pattern for this
codebase, just a new use of one that already works).

Two modes, matching the two watermark shapes reports_viewed.json holds:
  --id <date>   for archive sources (usage-scheduler)
  --mtime       for running-log sources (skill-auditor, automation-scout) -
                stamps the CURRENT wall-clock time as the new watermark,
                since running-log sources are tracked by "has the file
                changed since I last looked," not by a specific instance id

Both modes are monotonic - never regress a source's watermark backward,
even if called with an older id/an earlier mtime than what's already
stored (defensive; in practice the widget only ever calls this with the
instance actually being opened, but a stray double-click or race between
two quick clicks should never make the tray un-read something).
"""
import argparse
import sys
import time
from pathlib import Path

from report_summary import load_reports_viewed, save_reports_viewed


def main() -> int:
    parser = argparse.ArgumentParser(description="Mark a Reports Tray source as viewed.")
    parser.add_argument("--config", required=True, type=Path, help="Path to config/reports_viewed.json")
    parser.add_argument("--source", required=True, help="Source key, e.g. usage_scheduler")
    parser.add_argument("--id", help="Archive-source instance id (date), e.g. 2026-08-06")
    parser.add_argument("--mtime", action="store_true", help="Running-log source - stamp current time")
    args = parser.parse_args()

    if bool(args.id) == bool(args.mtime):
        print("exactly one of --id or --mtime is required", file=sys.stderr)
        return 1

    data = load_reports_viewed(args.config)
    entry = data.get(args.source, {})

    if args.id:
        current = entry.get("last_viewed_id")
        if current is None or args.id > current:
            entry["last_viewed_id"] = args.id
    else:
        current = entry.get("last_viewed_mtime")
        now = time.time()
        if current is None or now > current:
            entry["last_viewed_mtime"] = now

    data[args.source] = entry
    save_reports_viewed(args.config, data)
    return 0


if __name__ == "__main__":
    sys.exit(main())

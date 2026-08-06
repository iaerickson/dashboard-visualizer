#!/usr/bin/env python3
"""
report_summary.py — Reads ianlogger's latest daily log entry and
usage-scheduler's latest report, and emits a JSON summary for the
report-viewer widget to render.

Built 2026-08-04, per Ian: "I want to work on and run the viewer for our
logs and usage summary reports so I can be presented with those and have
those be more visible without having to hunt those down." Same read-only
posture as status_summary.py (see that file's own docstring) - this reads
ianlogger/logs/ and usage-scheduler/latest-report.md, never writes to
either. Meant to be called by report-viewer's own Übersicht `command`:

    python3 /Users/ianerickson/Desktop/Projects/dashboard-visualizer/scripts/report_summary.py

Output shape:

{
  "generated_at": "...",
  "log": {"date": "2026-08-04", "text": "...", "hours_ago": 3.2} | null,
  "report": {
    "title": "🌙 Morning Report — for 2026-08-04",
    "sections": {"Completed tonight": ["...", "..."], "Still needs you": [...], ...},
    "hours_ago": 3.2
  } | null
}

Either field can be null if that source doesn't exist yet (e.g. a fresh
ClaudeSpace checkout, or before either automation has run once) - the
widget is expected to handle that the same way status_summary.py's own
optional fields already are handled (see claudespace-status/index.jsx).
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
H1_RE = re.compile(r"^#\s+(.+)$")
H2_RE = re.compile(r"^##\s+(.+)$")


def find_latest_dated_file(root: Path) -> Path | None:
    """Finds the most recent YYYY-MM-DD.md file across a dated-file archive
    folder - root/*.md for the current month, root/YYYY-MM/*.md for
    archived months, root/YYYY/YYYY-MM/*.md for archived years (the same
    convention log-rollup already establishes and maintains - see
    ClaudeSpace/log-rollup). Sorted lexicographically by FILENAME, not
    mtime - a file's real "date" is what it's named, not when it happened
    to last be touched (a rollup move can bump mtime without changing what
    day the entry is actually about)."""
    candidates = list(root.glob("*.md")) + list(root.glob("*/*.md")) + list(root.glob("*/*/*.md"))
    dated = [p for p in candidates if DATE_RE.match(p.stem)]
    if not dated:
        return None
    return max(dated, key=lambda p: p.stem)


def load_latest_log(claude_space: Path) -> dict | None:
    """ianlogger's daily entries are a single narrative write per day (see
    ianlogger/README.md for its voice/format) - no internal structure to
    parse, just strip the leading "# YYYY-MM-DD" heading and hand back the
    body text as-is. The widget itself decides how much of it to show."""
    logs_dir = claude_space / "ianlogger" / "logs"
    if not logs_dir.exists():
        return None
    latest = find_latest_dated_file(logs_dir)
    if latest is None:
        return None
    text = latest.read_text(errors="ignore").strip()
    body_lines = [line for line in text.splitlines() if not H1_RE.match(line.strip())]
    body = "\n\n".join(part.strip() for part in "\n".join(body_lines).split("\n\n") if part.strip())
    date = latest.stem
    hours_ago = None
    try:
        entry_date = datetime.strptime(date, "%Y-%m-%d")
        hours_ago = (datetime.now() - entry_date).total_seconds() / 3600
    except ValueError:
        pass
    return {
        "date": date,
        "text": body,
        "hours_ago": round(hours_ago, 1) if hours_ago is not None else None,
    }


def parse_report_sections(text: str) -> dict:
    """Splits a usage-scheduler report into {heading: [bullet lines]}.
    These reports (see overnight-auto-execute's Step 4) mix real bullet
    points with occasional plain prose lines and sub-bullets - this only
    keeps top-level "- " bullets, since those are what's actually scannable
    at a glance; the widget isn't a full markdown renderer, just a digest.
    Bold markers stripped since plain text is all the widget renders."""
    sections: dict = {}
    current = None
    for line in text.splitlines():
        stripped = line.strip()
        h2 = H2_RE.match(stripped)
        if h2:
            current = h2.group(1).strip()
            sections[current] = []
            continue
        if current is not None and stripped.startswith("- "):
            bullet = stripped[2:].strip().replace("**", "")
            if bullet:
                sections[current].append(bullet)
    return sections


def load_latest_usage_report(claude_space: Path) -> dict | None:
    """Reads usage-scheduler/latest-report.md specifically (not the dated
    reports/ archive) - it's always overwritten with the most recent run
    (see that file's own header note), so it's the one source that's always
    current without this script having to do its own dated-file lookup a
    second time."""
    report_path = claude_space / "usage-scheduler" / "latest-report.md"
    if not report_path.exists():
        return None
    text = report_path.read_text(errors="ignore")
    title = None
    for line in text.splitlines():
        h1 = H1_RE.match(line.strip())
        if h1:
            title = h1.group(1).strip()
            break
    sections = parse_report_sections(text)
    mtime = report_path.stat().st_mtime
    hours_ago = (datetime.now().timestamp() - mtime) / 3600
    return {
        "title": title,
        "sections": sections,
        "hours_ago": round(hours_ago, 1),
    }


# NUGGET_PERSONAS (2026-08-04), per Ian: report-viewer should "know to pull
# context or info from nuggets" the "___man"-family skills have collected in
# the past, not just ianlogger/usage-scheduler. Checked each one's own
# README directly before building anything here (2026-08-04) - real,
# current state: NONE of these four persist any content to a file yet.
# historyman/cultureman/learnerman's shared storage format is still an
# explicit open decision in protoman/README.md ("a proposal, not a
# decision" - "not yet built"); tutor/README.md separately lists "decide if
# sessions should be saved somewhere... or ephemeral" as still unresolved.
# So load_persona_nuggets below has nothing real to surface today - this is
# forward-compatible plumbing, not filler content. It looks for
# "<persona>/log.md" (protoman's own proposed shape: one running file per
# persona, flat dated entries, newest at the bottom) and silently skips any
# persona that doesn't have one yet - the moment Ian signs off on a format
# and any of these starts writing real entries, report-viewer picks it up
# automatically, no widget changes needed.
NUGGET_PERSONAS = ["historyman", "cultureman", "learnerman", "tutor"]
NUGGET_MAX_ENTRIES = 2


def load_persona_nuggets(claude_space: Path) -> list:
    results = []
    for persona in NUGGET_PERSONAS:
        log_path = claude_space / persona / "log.md"
        if not log_path.exists():
            continue
        text = log_path.read_text(errors="ignore").strip()
        if not text:
            continue
        # Format-agnostic on purpose - the entry SHAPE (date + tags, per
        # protoman's draft) isn't a decided contract yet, so this doesn't
        # try to parse that structure, just takes the last few blank-line-
        # separated paragraphs as "recent entries" (newest-last, per the
        # "newest at the bottom" convention above) so the widget can still
        # show something reasonable however entries actually end up being
        # written once a format is chosen.
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        recent = paragraphs[-NUGGET_MAX_ENTRIES:]
        recent.reverse()
        results.append({"persona": persona, "entries": recent})
    return results


def build_summary(claude_space: Path) -> dict:
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "log": load_latest_log(claude_space),
        "report": load_latest_usage_report(claude_space),
        "nuggets": load_persona_nuggets(claude_space),
    }


def main() -> int:
    claude_space = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop" / "ClaudeSpace"
    if not claude_space.exists():
        print(json.dumps({"error": f"ClaudeSpace folder not found at {claude_space}"}))
        return 1
    print(json.dumps(build_summary(claude_space)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

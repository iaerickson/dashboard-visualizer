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


def load_reports_viewed(config_path: Path) -> dict:
    """Reports Tray v2 (2026-08-08) - reads config/reports_viewed.json, the
    per-source read/unread watermark. Missing file or malformed JSON both
    fail open to {} (everything currently unread) - same posture every
    other config anchor in this codebase already uses, not a special case
    for this one."""
    if not config_path.exists():
        return {}
    try:
        data = json.loads(config_path.read_text(errors="ignore"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def save_reports_viewed(config_path: Path, data: dict) -> None:
    """Writes config/reports_viewed.json - same plain write_text(json.dumps(...))
    convention load_session_reset/load_personal_health already use in
    status_summary.py, no atomic-write dance. Ensures config_path's parent
    directory exists first (2026-08-08 fix) so a fresh checkout without a
    pre-existing config/ directory doesn't crash on first write."""
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(data, indent=2))


def is_unread(viewed_entry: dict, instance_id: str | None = None, mtime: float | None = None) -> bool:
    """True if the given instance (by dated id for archive sources, by
    mtime for running-log sources) is newer than the source's last-viewed
    watermark - or if there's no watermark at all yet (never viewed, so
    everything is unread). Pass exactly one of instance_id/mtime; which
    one a source uses is a property of that source's own shape (archive
    vs running-log), not a per-call choice."""
    if instance_id is not None and mtime is not None:
        raise ValueError("is_unread requires exactly one of instance_id or mtime, not both")
    if instance_id is not None:
        last_viewed_id = viewed_entry.get("last_viewed_id")
        return last_viewed_id is None or instance_id > last_viewed_id
    if mtime is not None:
        last_viewed_mtime = viewed_entry.get("last_viewed_mtime")
        return last_viewed_mtime is None or mtime > last_viewed_mtime
    raise ValueError("is_unread requires exactly one of instance_id or mtime")


def list_dated_files(root: Path) -> list:
    """Every YYYY-MM-DD.md file across a dated-file archive folder -
    root/*.md for the current month, root/YYYY-MM/*.md for archived
    months, root/YYYY/YYYY-MM/*.md for archived years (the same
    convention log-rollup already establishes and maintains - see
    ClaudeSpace/log-rollup). Sorted OLDEST TO NEWEST, lexicographically by
    FILENAME, not mtime - a file's real "date" is what it's named, not
    when it happened to last be touched (a rollup move can bump mtime
    without changing what day the entry is actually about).

    Generalized (2026-08-08) from what used to be find_latest_dated_file's
    single-file lookup - Reports Tray v2's unread-backlog stacking needs
    every dated instance, not just the newest one, to know what's unread.
    find_latest_dated_file below is now a thin wrapper over this."""
    candidates = list(root.glob("*.md")) + list(root.glob("*/*.md")) + list(root.glob("*/*/*.md"))
    dated = [p for p in candidates if DATE_RE.match(p.stem)]
    return sorted(dated, key=lambda p: p.stem)


def find_latest_dated_file(root: Path) -> Path | None:
    """The single most recent dated file - see list_dated_files above for
    the real logic. Kept as its own function since "just the latest" is
    still exactly what load_latest_log/load_latest_usage_report want for
    their own "what's current right now" job, unrelated to Reports Tray
    v2's separate "what's unread" job."""
    files = list_dated_files(root)
    return files[-1] if files else None


def load_log_entry(path: Path) -> dict:
    """Parses ONE ianlogger dated entry file, given its path directly (not
    a directory to search) - extracted (2026-08-08) from load_latest_log
    so Reports Tray v2's archive-instance enumeration can load any past
    entry, not just the latest. Strip the leading "# YYYY-MM-DD" heading,
    hand back the body text as-is - ianlogger writes narrative prose, no
    internal structure to parse."""
    text = path.read_text(errors="ignore").strip()
    body_lines = [line for line in text.splitlines() if not H1_RE.match(line.strip())]
    body = "\n\n".join(part.strip() for part in "\n".join(body_lines).split("\n\n") if part.strip())
    date = path.stem
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


def load_latest_log(claude_space: Path) -> dict | None:
    """ianlogger's single most recent entry - see load_log_entry above for
    the real parsing. Unchanged behavior/signature from before 2026-08-08;
    now just a thin wrapper so existing callers (status_summary.py's
    "current log" display) don't need to change."""
    logs_dir = claude_space / "ianlogger" / "logs"
    if not logs_dir.exists():
        return None
    latest = find_latest_dated_file(logs_dir)
    return load_log_entry(latest) if latest is not None else None


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


def load_usage_report_entry(path: Path) -> dict:
    """Parses ONE usage-scheduler report file, given its path directly -
    extracted (2026-08-08) from load_latest_usage_report so Reports Tray
    v2's archive-instance enumeration can load any past dated report from
    usage-scheduler/reports/, not just the always-current latest-report.md
    pointer."""
    text = path.read_text(errors="ignore")
    title = None
    for line in text.splitlines():
        h1 = H1_RE.match(line.strip())
        if h1:
            title = h1.group(1).strip()
            break
    sections = parse_report_sections(text)
    mtime = path.stat().st_mtime
    hours_ago = (datetime.now().timestamp() - mtime) / 3600
    return {
        "title": title,
        "sections": sections,
        "hours_ago": round(hours_ago, 1),
    }


def load_latest_usage_report(claude_space: Path) -> dict | None:
    """Reads usage-scheduler/latest-report.md specifically (not the dated
    reports/ archive) - it's always overwritten with the most recent run
    (see that file's own header note), so it's the one source that's always
    current without a dated-file lookup. Unchanged behavior/signature from
    before 2026-08-08 - see load_usage_report_entry above for the real
    parsing, now shared with Reports Tray v2's archive enumeration."""
    report_path = claude_space / "usage-scheduler" / "latest-report.md"
    if not report_path.exists():
        return None
    return load_usage_report_entry(report_path)


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


def load_dependency_audit_entry(path: Path) -> dict:
    """Parses ONE dependency-audit report file for Reports Tray v2
    (2026-08-08) - just the title and the file's own path, no excerpt
    parsing. dependency-audit's reports are long prose/table documents
    with no "- " bullet convention parse_report_sections could reuse (its
    "## The short version" section is paragraphs, not bullets) - rather
    than build a second, different prose-excerpt parser for one source,
    v1 keeps this deliberately minimal: enough to identify which report
    this is and when, not a preview of its findings. Revisit if a real
    excerpt turns out to matter in practice."""
    text = path.read_text(errors="ignore")
    title = None
    for line in text.splitlines():
        h1 = H1_RE.match(line.strip())
        if h1:
            title = h1.group(1).strip()
            break
    return {"title": title or "Dependency Audit", "path": str(path)}


def list_archive_instances(archive_dir: Path, viewed_entry: dict, load_content) -> list:
    """Generic dated-archive instance enumeration for Reports Tray v2
    (2026-08-08). Returns every unread instance (oldest first, so the
    widget's own top-to-bottom hex-column order puts the oldest unread one
    at the top - no separate sort step needed on the JS side) plus the
    single newest instance even when it's already viewed (so a source with
    an archive never fully disappears from the tray once it's produced
    anything at all), plus whichever instance's id exactly equals the
    current watermark (`viewed_entry["last_viewed_id"]`) even when that's
    neither the newest nor unread (2026-08-08 fix - without this, opening
    an older backlog instance marks it read and it drops out of the very
    next poll's result, closing its own just-opened overlay out from under
    you). `load_content(path) -> dict` is the per-source content loader
    (load_log_entry, load_usage_report_entry, load_dependency_audit_entry,
    ...); its returned dict is merged with `id`/`viewed` on each instance.
    Read state is a single watermark, not a per-instance flag - see
    is_unread's own docstring."""
    files = list_dated_files(archive_dir)
    if not files:
        return []
    newest = files[-1]
    last_viewed_id = viewed_entry.get("last_viewed_id")
    instances = []
    for path in files:
        instance_id = path.stem
        unread = is_unread(viewed_entry, instance_id=instance_id)
        if unread or path == newest or instance_id == last_viewed_id:
            content = load_content(path)
            instances.append({"id": instance_id, "viewed": not unread, **content})
    return instances


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

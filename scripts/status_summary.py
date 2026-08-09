#!/usr/bin/env python3
"""
status_summary.py — Reads the ClaudeSpace tracker and emits a JSON summary
for the desktop widget to render.

This script reads the tracker to build the widget's JSON, and does NOT touch
any tracker content (INDEX.md, NEEDS-IAN.md, project READMEs) - those stay
fully read-only. It DOES make small, narrowly-scoped writes back to two of
its own self-maintaining config anchors when they need to roll forward on
their own (see load_session_reset's and load_personal_health's own comments
for exactly what and why) - config/session_reset.json and
config/last_break.json, nothing else, both already designed to be rewritten
by automated processes (the widget's own click handlers already do the
same). Safe to run as often as the widget wants either way. Meant to be
called directly by an Übersicht widget's `command`:

    python3 /Users/ianerickson/Desktop/Projects/dashboard-visualizer/scripts/status_summary.py

Output shape (abridged):

{
  "generated_at": "...",
  "totals": {"active": 25, "idea": 25, "paused": 0, "backlog": 0, "done": 4, "done_recent": 1},
  "needs_ian_count": 13,
  "most_recent_project": {"name": "...", "hours_ago": 0.1},
  "usage_resets": [...],
  "sections": {
    "active":  {"total": 25, "shown": [...all 25, widget scrolls...]},
    "idea":    {"total": 25, "shown": [...all 25, widget scrolls...]},
    "paused":  {"total": 0,  "shown": []},
    "done":    {"total": 0,  "shown": []},
    "dormant": {"total": 2,  "shown": [...full item dicts, same shape as above...]}
  },
  "needs_attention": {
    "items": [{"kind": "ask", "title": "..."}, {"kind": "blocked", "title": "..."}]
  }
}

"shown" is the FULL list per section (2026-07-31: no more top-5 truncation - the
widget renders these in a scrollable list, since a static "+N more" count had no
way to actually see the rest). Each item looks like:
{
  "name": "dj-library-manager",
  "summary": "dedupe + stale-reference cleanup for Serato/rekordbox...",
  "last_completed": "Duplicate finder (music folder) — first working version built",
  "next_steps": ["Stale library-reference cleanup...", "..."],
  "time_estimate": "duplicate finder done; ~1-2 hrs each for the remaining pieces",
  "stale": false,
  "hours_ago": 0.2
}

Time estimates come from config/project_catalog.json — a cache a Claude
session fills in (real time-assessor-style judgment isn't something a plain
script can produce). See dashboard-visualizer/README.md for why this is a
cache, not a live call: the widget never makes its own LLM calls.

Imports three loader functions from report_summary.py (load_latest_log,
load_latest_usage_report, load_persona_nuggets) rather than duplicating
them, since both already parse the same ianlogger/usage-scheduler log and
report formats — a deliberate exception to this project's normal
scripts-stay-independent convention (see lifecycle_resort.py's own comment
on that convention).
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from report_summary import (
    load_latest_log,
    load_latest_usage_report,
    load_persona_nuggets,
    load_reports_viewed,
    list_archive_instances,
    load_log_entry,
    load_usage_report_entry,
    load_dependency_audit_entry,
)

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

STATUS_EMOJI = {
    "active": "🟢",
    "idea": "🟡",
    "paused": "⏸️",
    # Real status, added 2026-07-31 (Ian: "we still need a backlog section").
    # Structural piece only - see SECTION_META's comment in index.jsx for what
    # this does and doesn't cover yet (no automated promotion into/out of it).
    "backlog": "🔵",
    "done": "✅",
}

STALE_DAYS_THRESHOLD = 30  # proposed definition from system-healthcheck/README.md, pending sign-off
# "Done recently" window (2026-07-31, per Ian - answered the open "Done count is
# often just 0" question): the raw Done count is "how many projects are tagged
# done right now," which barely moves. Ian's fix: tiny mode should show how many
# were marked done in the last 2 weeks instead - a real momentum signal - while
# big mode can show both that AND the plain lifetime total. Reuses the same
# README-mtime signal everything else already uses (marking something Done
# always comes with a dated Notes touch per this session's own convention, so
# hours_ago already means "time since marked done" for a Done item).
DONE_RECENT_DAYS = 14
GENERIC_IDEA_ESTIMATE = "~10-30 min to expand into a real plan (per time-assessor's convention for idea-stage items)"
NEEDS_ATTENTION_LIMIT = 8  # cap on NEEDS-IAN.md items surfaced in the widget - scrollable in the UI, but no reason to ship an unbounded list

NEEDS_IAN_BULLET_RE = re.compile(r"^- (🤔|🚧)", re.MULTILINE)
# Open (not-yet-resolved) NEEDS-IAN.md entries only - excludes lines starting "✅ Resolved".
# Pulls the bolded lead-in as a short title for the widget (full text stays in the file).
# Group 3 (2026-07-31, per Ian: "would like you to start making these all
# expandable children too" - see parse_needs_ian_items' own comment) captures
# the REST of that same bullet's line - almost every entry in this file is one
# long line (bold title + its own explanation on the same bullet), so "the
# rest of the line" IS the detail text worth revealing on hover. Captured in
# the SAME regex pass as the title (not a second scan) so title/detail can
# never misalign.
NEEDS_IAN_ITEM_RE = re.compile(r"^- (🤔|🚧)\s*\*\*(.+?)\*\*(.*)$", re.MULTILINE)
NEEDS_IAN_DETAIL_MAX_CHARS = 320

# Matches an INDEX.md project line and pulls out: emoji, linked name + link (if a
# markdown link), or plain name (if not). Deliberately NOT anchored to end-of-line -
# some lines have a trailing italic aside like "_(2026-07-31 brainstorm: ...)_"
# instead of an em-dash summary, and an anchored regex missed those entirely
# (found while testing against the real INDEX.md - the "idea" count came out
# lower than count_statuses' separate count until this was line-by-line instead).
INDEX_LINE_RE = re.compile(r"^- (🟢|🟡|⏸️|🔵|✅)\s+(?:\[([^\]]+)\]\(([^)]+)\)|([^—_\n]+))")
SUMMARY_RE = re.compile(r"—\s*(.*)$")
# Many idea one-liners already embed a date in a parenthetical aside (a pattern
# this session itself established - e.g. "_(2026-07-31 brainstorm: ...)_",
# "(2026-07-31, safe to delete once tested)"). Scans the whole raw line, not
# just the summary, since some asides replace the em-dash summary entirely.
IDEA_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

CHECKED_ITEM_RE = re.compile(r"^- \[x\]\s*(?:\*\*(.+?)\*\*|([^\n]+))", re.MULTILINE)
UNCHECKED_ITEM_RE = re.compile(r"^- \[ \]\s*(?:\*\*(.+?)\*\*|([^\n]+))", re.MULTILINE)


def count_statuses(index_text: str) -> dict[str, int]:
    counts = {key: 0 for key in STATUS_EMOJI}
    for key, emoji in STATUS_EMOJI.items():
        counts[key] = len(re.findall(rf"^- {re.escape(emoji)}", index_text, re.MULTILINE))
    return counts


def active_project_names(index_text: str) -> list[str]:
    return [p["name"] for p in parse_index_projects(index_text) if p["status"] == "active"]


def parse_index_projects(index_text: str) -> list[dict]:
    """Every project line in INDEX.md, regardless of status. Line-by-line on
    purpose (see INDEX_LINE_RE's comment) rather than one big MULTILINE regex.

    `_order` (2026-07-31) is each project's position in the file - internal
    only, stripped before the JSON goes out (see build_sections). Originally
    meant as the sole proxy for "when was this idea created," but that broke
    in practice: categories interleave old and new entries (an old one-liner
    in a later category sorts "newer" than a fresh one added to an earlier
    category, purely by file position), found live when Ian correctly flagged
    idea sort as not actually working. `_created_date` is the more accurate
    signal where it exists - many idea one-liners already embed a real date in
    a parenthetical aside - with `_order` as the fallback only for entries
    that don't have one (see build_sections for how the two combine)."""
    status_by_emoji = {v: k for k, v in STATUS_EMOJI.items()}
    projects = []
    for line in index_text.splitlines():
        match = INDEX_LINE_RE.match(line)
        if not match:
            continue
        emoji, linked_name, link, plain_name = match.groups()
        name = (linked_name or plain_name or "").strip()
        if not name:
            continue
        summary_match = SUMMARY_RE.search(line)
        summary = summary_match.group(1).strip() if summary_match else None
        date_match = IDEA_DATE_RE.search(line)
        projects.append(
            {
                "status": status_by_emoji.get(emoji),
                "name": name,
                "link": link,
                "summary": summary,
                "_order": len(projects),
                "_created_date": date_match.group(0) if date_match else None,
            }
        )
    return projects


def count_needs_ian(needs_ian_text: str) -> int:
    # Bug found 2026-07-31 while adding parse_needs_ian_items(): this counted
    # NEEDS-IAN.md's own legend lines ("- 🚧 **Blocked** ...", "- 🤔 **Ask/Clarify**
    # ...") as if they were real entries, inflating the count by 2. Scope to text
    # after "## List", same fix as parse_needs_ian_items().
    list_section = needs_ian_text.split("## List", 1)
    body = list_section[1] if len(list_section) > 1 else needs_ian_text
    return len(NEEDS_IAN_BULLET_RE.findall(body))


NEEDS_IAN_PROJECT_RE = re.compile(r"^`([a-z0-9][a-z0-9\-]*)`")
# Matches the leading `` `project-name` `` backtick reference most NEEDS-IAN.md
# titles already start with (e.g. "`dev-identity` — anonymous vs pseudonymous",
# "`dashboard-visualizer` Phase 2 — ..."). Used for grouping, see
# parse_needs_ian_items' own comment below.

# PROJECT_NAME_ANYWHERE_RE (2026-08-04) - same backtick-project convention as
# NEEDS_IAN_PROJECT_RE above, but NOT anchored to the start of the string.
# Needed for load_daily_goal's per-item completion check below: goal titles
# from daily_goal.json phrase the project reference mid-sentence ("Decide
# `mentor-mode`'s explain-vs-just-do-it line"), not leading the line the way
# NEEDS-IAN.md's own entries do.
PROJECT_NAME_ANYWHERE_RE = re.compile(r"`([a-z0-9][a-z0-9\-]*)`")


def parse_needs_ian_items(needs_ian_text: str, limit: int = NEEDS_ATTENTION_LIMIT) -> dict:
    """Open NEEDS-IAN.md entries (🤔 ask/clarify or 🚧 blocked) for the widget's
    Needs Attention section. Resolved (✅) entries are excluded by the regex
    itself (only matches 🤔/🚧 leads). Full detail always lives in NEEDS-IAN.md
    itself, this is just a glance/pointer.

    Only scans text after "## List" - the file's own legend near the top defines
    "🚧 **Blocked**" / "🤔 **Ask/Clarify**" as key entries, which would otherwise
    get picked up as fake items.

    Sort order (2026-07-31, per Ian: sort by "the logic weight that is part of
    general list creation preference - critical level, how hard it gets the
    more it gets put off, if other things are dependent on it"): that's
    log-pose's real weight matrix (see log-pose/SKILL.md - dependency-blockers
    > workflow-improvement items > decay-sensitive > easy knock-outs), but
    it's built to be applied by an LLM reading full context, not computed from
    a plain-text title by a deterministic script - and this script deliberately
    never makes LLM calls of its own (see dashboard-visualizer/README.md's
    interface-layer decision). Honest partial version: 🚧 Blocked entries sort
    before 🤔 Ask/Clarify ones, since "blocked" already means something
    explicitly stopped further progress - a real, if partial, slice of
    "critical level" this script can actually read from the data it has.
    True dependency-aware and decay-aware ranking stays log-pose's job (run it
    for the full picture); NEEDS-IAN.md also has no reliable per-entry
    timestamp to sort by otherwise - entries have been both appended and
    inserted at various points over time, so file position isn't a trustworthy
    age signal here the way it is for INDEX.md's Idea one-liners.

    Project grouping (2026-07-31, per Ian: "inside of any subheader like active
    or needs attention, every item connected or part of the same scope or
    project should get linked together into another new subheader that can
    expand"). Needs Attention is where this is buildable today without
    inventing a new tagging convention first - almost every entry already
    starts with a `` `project-name` `` backtick reference (that's how they're
    written throughout NEEDS-IAN.md already), so grouping-by-project is just
    parsing what's already there, not new data. Items that share a project
    with at least one other open item become a collapsible group (same nested-
    list mechanism already used for the section itself, one level deeper);
    items whose project only has one open entry, or that don't start with a
    recognizable `` `project-name` `` reference at all, stay in the flat
    `items` list exactly as before. This is a first, narrow slice of Ian's
    broader ask - his own framing covers grouping inside ANY section (Active,
    Idea, etc.), not just Needs Attention, and by "connected/same scope," not
    only literal shared project name. Both are real, not built here: today
    every other section is already one-row-per-project (no multi-item-per-
    project case exists yet to group), and "same scope" beyond a literal
    project match would need the freeform-tagging convention Ian said to
    start loose and tighten later - not guessed at wholesale in this pass."""
    list_section = needs_ian_text.split("## List", 1)
    body = list_section[1] if len(list_section) > 1 else needs_ian_text
    raw_items = []
    for emoji, title, rest in NEEDS_IAN_ITEM_RE.findall(body):
        title = title.strip()
        # `rest` starts right after the closing ** of the title - trim the
        # leading punctuation most entries use before their own explanation
        # ("**Title.** Ian said..." / "**Title** — Ian said...") so the
        # detail text doesn't open with a stray ". " or " — ".
        detail = re.sub(r"^[\s.:—-]+", "", rest).strip()
        # Strip markdown bold - the widget renders plain text, so a literal
        # "**word**" would just show the asterisks.
        detail = re.sub(r"\*\*(.+?)\*\*", r"\1", detail)
        if len(detail) > NEEDS_IAN_DETAIL_MAX_CHARS:
            detail = detail[:NEEDS_IAN_DETAIL_MAX_CHARS].rsplit(" ", 1)[0] + "…"
        project_match = NEEDS_IAN_PROJECT_RE.match(title)
        raw_items.append(
            {
                "kind": "blocked" if emoji == "🚧" else "ask",
                "title": title,
                "detail": detail or None,
                "project": project_match.group(1) if project_match else None,
            }
        )
    raw_items.sort(key=lambda i: 0 if i["kind"] == "blocked" else 1)

    by_project: dict[str, list[dict]] = {}
    for item in raw_items:
        if item["project"]:
            by_project.setdefault(item["project"], []).append(item)

    grouped_projects = {proj for proj, entries in by_project.items() if len(entries) >= 2}
    ungrouped = [item for item in raw_items if item["project"] not in grouped_projects]
    groups = [
        {
            "project": proj,
            "items": [{"kind": i["kind"], "title": i["title"], "detail": i["detail"]} for i in entries],
        }
        for proj, entries in by_project.items()
        if proj in grouped_projects
    ]
    # Bigger clusters first - a project with several open items is more worth
    # noticing at a glance than one with exactly two.
    groups.sort(key=lambda g: -len(g["items"]))

    return {
        "items": [{"kind": i["kind"], "title": i["title"], "detail": i["detail"]} for i in ungrouped[:limit]],
        "groups": groups,
    }


def collect_stale_projects(sections: dict) -> list[dict]:
    """Full item dicts (not just names) for every project flagged stale anywhere
    in the sections dict. Returns full items - not just names - so the widget
    can render these as their own proper "Dormant" subsection (same ProjectRow,
    same hover detail, same click-to-open-in-Claude) rather than a flat
    comma-joined name list (2026-07-31, per Ian: wanted stale/dormant projects
    listed as their own subheader alongside Active/Idea/Paused/Done, not buried
    inside Needs Attention as plain text).

    Still excludes "done" (finishing something isn't "abandoning" it). Paused
    IS included again (2026-07-31, revised same day - see build_sections'
    comment): a paused item that keeps sitting untouched for 30+ days after
    being paused should surface as dormant too, per Ian's "if there is no
    movement done on a paused item it goes back to dormant." What's NOT
    happening anymore is an *immediate* double-signal the moment something is
    paused - that only shows up now if the pause itself didn't come with a
    real README touch (per PROCESS.md's own "flip to Paused with a one-line
    reason" convention), which resets the same 30-day clock everything else
    uses.

    "backlog" added 2026-07-31 alongside the new status itself - uses the
    same general 30-day threshold as everything else here for now, NOT the
    2-week-specifically number from Ian's original lifecycle proposal
    (Backlog → Dormant at 2 weeks, distinct from the 30-day default). Giving
    Backlog its own shorter threshold is real, still-open follow-up work
    (parse_project_readme would need a per-status threshold, not one global
    STALE_DAYS_THRESHOLD) - logged in NEEDS-IAN.md, not guessed at here."""
    stale = []
    for status in ("active", "idea", "paused", "backlog"):
        for item in sections.get(status, {}).get("shown", []):
            if item.get("stale"):
                stale.append(item)
    return stale


BIN_ENTRY_RE = re.compile(
    r"^-\s+\*\*(\d{4}-\d{2}-\d{2})\*\*\s+—\s+`([^`]+)`\s+\(was\s+([^)]+)\)(?:\s+—\s+(.*))?$"
)


def load_bin_items(claude_space: Path) -> list[dict]:
    """Reads _bin/BIN.md's dated entries (see that file's own "Convention"
    section for the exact line format) - the bin/trash Ian asked for
    (2026-08-04): "a bin/trash to discard ideas we don't wanna do anymore
    and keep track of stuff that way," physically confirmed as "move to a
    bin folder" rather than a status flag. Real project folders actually
    live at _bin/<name>/ (this function doesn't need to touch them - BIN.md
    is the one source of truth for display, same "trust the log, not a
    directory listing" choice most-recently-touched-project style signals
    in this file already make); bare idea one-liners never had a folder to
    move, so they're logged here directly instead.

    Returns items shaped exactly like build_sections' own project items
    (name/summary/hours_ago/last_completed/next_steps/stale) so the widget
    can render this as a normal Section/ProjectRow with zero new component
    code - "stale" is always False here (dormant-tagging something already
    in the bin doesn't mean anything), last_completed/next_steps are always
    empty (nothing left to act on), summary carries the discard reason."""
    bin_md = claude_space / "_bin" / "BIN.md"
    if not bin_md.exists():
        return []
    items = []
    for line in bin_md.read_text(errors="ignore").splitlines():
        m = BIN_ENTRY_RE.match(line.strip())
        if not m:
            continue
        date_str, name, former_path, reason = m.groups()
        try:
            discarded_at = datetime.strptime(date_str, "%Y-%m-%d")
            hours_ago = (datetime.now() - discarded_at).total_seconds() / 3600
        except ValueError:
            hours_ago = None
        summary = reason.strip() if reason else f"was {former_path.strip()}"
        items.append(
            {
                "name": name,
                "summary": summary[:140],
                "last_completed": None,
                "next_steps": [],
                "stale": False,
                "hours_ago": round(hours_ago, 1) if hours_ago is not None else None,
                "time_estimate": None,
            }
        )
    # Newest discard first - matches Active/Paused/Done's own "most recent
    # first" convention (see build_sections' own sort comment).
    items.sort(key=lambda i: (i["hours_ago"] is None, i["hours_ago"] or 0))
    return items


def resolve_project_readme(claude_space: Path, project: dict) -> Path | None:
    """Follows an INDEX.md link (./name/ or ../Projects/name/) to a real README.md,
    if this project has a folder at all (idea-stage one-liners usually don't)."""
    link = project.get("link")
    if not link:
        return None
    candidate = (claude_space / link).resolve() / "README.md"
    if candidate.exists():
        return candidate
    return None


def parse_project_readme(readme_path: Path, now_ts: float) -> dict:
    text = readme_path.read_text(errors="ignore")

    checked = CHECKED_ITEM_RE.findall(text)
    unchecked = UNCHECKED_ITEM_RE.findall(text)

    def clean(match_tuple: tuple[str, str]) -> str:
        bold, plain = match_tuple
        raw = (bold or plain).strip()
        # Trim to a reasonably short clause for a widget tooltip, not a full sentence dump.
        raw = re.split(r"\s[—(]", raw)[0].strip().rstrip(".:")
        return raw[:140]

    last_completed = clean(checked[-1]) if checked else None
    next_steps = [clean(item) for item in unchecked[:2]]

    notes_section = text.split("## Notes", 1)
    has_real_notes = len(notes_section) > 1 and bool(notes_section[1].strip())
    mtime = readme_path.stat().st_mtime
    age_days = (now_ts - mtime) / 86400
    stale = age_days >= STALE_DAYS_THRESHOLD and not checked and not has_real_notes

    return {
        "last_completed": last_completed,
        "next_steps": next_steps,
        "stale": stale,
        "hours_ago": round((now_ts - mtime) / 3600, 1),
    }


def load_catalog(catalog_path: Path) -> dict:
    if not catalog_path.exists():
        return {}
    try:
        return json.loads(catalog_path.read_text(errors="ignore")).get("projects", {})
    except (json.JSONDecodeError, OSError):
        return {}


def build_sections(claude_space: Path, index_projects: list[dict], catalog: dict, now_ts: float) -> dict:
    by_status: dict[str, list[dict]] = {key: [] for key in STATUS_EMOJI}

    for project in index_projects:
        status = project["status"]
        if status not in by_status:
            continue
        readme_path = resolve_project_readme(claude_space, project)
        item = {
            "name": project["name"],
            "summary": project["summary"],
            "last_completed": None,
            "next_steps": [],
            "stale": False,
            "hours_ago": None,
            "_order": project["_order"],
            "_created_date": project["_created_date"],
        }
        if readme_path is not None:
            item.update(parse_project_readme(readme_path, now_ts))

        # Paused + dormant relationship (2026-07-31, revised same day after
        # Ian's follow-up): NOT a blanket "paused can never be dormant" rule
        # anymore - that was too blunt. Ian's actual point: a paused item
        # shouldn't *immediately* double-signal as dormant the moment it's
        # paused, but a paused item that then sits untouched for the same 30+
        # days everything else uses SHOULD eventually flag dormant again - "if
        # there is no movement done on a paused item it goes back to dormant."
        # No special-casing needed for that: `parse_project_readme`'s existing
        # 30-day/no-checked-items/no-real-Notes computation already IS that
        # timer, and it resets naturally the moment a project's README
        # actually gets touched - which PROCESS.md's own Review step already
        # calls for when flipping something to Paused ("with a one-line
        # reason"). The original bug (jrpg-portfolio showing dormant the
        # instant it was paused) was really that only its INDEX.md line got
        # edited, not its own README - so its mtime never reset. Fixed at the
        # source (see jrpg-portfolio/README.md) instead of overriding here.

        cached = catalog.get(project["name"], {})
        item["time_estimate"] = cached.get("time_estimate") or (
            GENERIC_IDEA_ESTIMATE if status == "idea" else None
        )

        by_status[status].append(item)

    sections = {}
    for status, items in by_status.items():
        if status == "idea":
            # Newest-created first (2026-07-31, per Ian: ideas should sort by
            # creation, not by touch - most ideas are one-line INDEX.md entries
            # with no README/mtime at all, so "most recently touched" doesn't
            # even apply to them the way it does for the other statuses).
            #
            # First attempt used file position (_order) alone as a creation-
            # date proxy, reversed. Found broken live (2026-07-31, Ian: "ideas
            # are not sorted by newest idea") - INDEX.md's categories interleave
            # old and new entries, so an old one-liner sitting in a later
            # category outranked a genuinely new one added to an earlier
            # category, purely because of where its category happens to fall
            # in the file. Fixed with two passes, relying on Python's sort
            # being stable: first establish the _order-based baseline (still
            # the only signal available for undated entries), then a second
            # sort brings any item with a real `_created_date` to the front,
            # newest date first - undated items keep their relative order from
            # the first pass. Most existing one-liners have no date at all
            # (plain brainstorm entries like "Chumby"), so they fall back to
            # the position-based guess same as before; entries that follow the
            # "(YYYY-MM-DD ...)" convention this session established sort
            # accurately by that real date instead.
            items.sort(key=lambda i: -i["_order"])
            items.sort(key=lambda i: i["_created_date"] or "", reverse=True)
        else:
            # Most-recently-touched first (active = most recently actioned
            # against, done = most recently completed, paused = most recently
            # paused - all three read the same README-mtime signal, just with
            # a different real-world meaning per status). Items with no
            # README sort last.
            items.sort(key=lambda i: (i["hours_ago"] is None, i["hours_ago"] or 0))
        for item in items:
            item.pop("_order", None)  # internal sort key only, not part of the widget's JSON contract
            item.pop("_created_date", None)  # same - internal only
        # No truncation - the widget renders these in a scrollable list now (2026-07-31,
        # replacing the old top-5 + static "+N more" that had no way to actually see the rest).
        # Done used to get a separate "recent" (top-3) field since the widget only ever
        # showed that - now unified with every other section (full "shown" list,
        # collapsible in the UI), so "recent" was dropped as dead data.
        sections[status] = {"total": len(items), "shown": items}
    return sections


def most_recently_touched_project(claude_space: Path) -> dict | None:
    best = None
    best_mtime = -1.0
    for readme in claude_space.glob("*/README.md"):
        mtime = readme.stat().st_mtime
        if mtime > best_mtime:
            best_mtime = mtime
            best = readme.parent.name
    if best is None:
        return None
    hours_ago = (datetime.now().timestamp() - best_mtime) / 3600
    return {"name": best, "hours_ago": round(hours_ago, 1)}


def latest_scheduled_task_run_epoch(snapshot_path: Path) -> float | None:
    """Reads config/scheduled_tasks_snapshot.json - a small local cache of
    Ian's real scheduled-task lastRunAt timestamps (2026-08-05), per Ian:
    "is there a small file we can write to locally... on any activity after
    that 5 hr refresh, on first activity whether its me or an automated
    message, we update the initial time stamp." This is the "automated
    message" half of that - real data pulled from
    mcp__scheduled-tasks__list_scheduled_tasks (Cowork's own scheduling
    system, not a heuristic), not something status_summary.py can query
    live itself (it's a standalone script, no MCP access at all - only a
    live Claude session can call that tool). So this file is the honest
    bridge: refreshed with real lastRunAt data whenever a live session
    (Claude directly, or - going forward - the scheduled tasks themselves,
    see overnight-auto-execute/SKILL.md and daily-checkins' own prompt)
    writes it, then read here like any other local file. Format:
    {"refreshed_at": "<ISO>", "tasks": [{"taskId": "...", "lastRunAt": "<ISO, UTC, 'Z' suffix>"}]}.
    Returns the max lastRunAt across all tasks as a plain UNIX epoch float
    (directly comparable to st_mtime results elsewhere in this file), or
    None if the snapshot is missing/empty/unparseable - same silent-skip
    convention every other optional config in this script already uses."""
    if not snapshot_path.exists():
        return None
    try:
        data = json.loads(snapshot_path.read_text(errors="ignore"))
    except (json.JSONDecodeError, OSError):
        return None
    best_epoch = None
    for task in data.get("tasks", []):
        raw = task.get("lastRunAt")
        if not raw:
            continue
        try:
            # lastRunAt comes from the scheduler as UTC with a "Z" suffix -
            # fromisoformat needs "+00:00" instead, then .timestamp() gives
            # a real UNIX epoch (tz-aware datetime converts correctly,
            # unlike the naive local timestamps used everywhere else here).
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        epoch = dt.timestamp()
        if best_epoch is None or epoch > best_epoch:
            best_epoch = epoch
    return best_epoch


def latest_tracker_activity_mtime(
    claude_space: Path, repo_dir: Path | None = None, scheduled_snapshot_path: Path | None = None
) -> float | None:
    """Raw max mtime across every project README.md in the tracker - same
    directory walk as most_recently_touched_project above, just exposing the
    timestamp itself rather than a formatted "N hours ago" string. Added
    2026-08-04 as an activity signal for load_session_reset (see its own
    comment) - per PROCESS.md's own convention, any real Claude work
    (interactive or via a scheduled task) leaves a dated Notes entry in the
    project's own README.md, so "did any README change since X" is a
    reasonably honest local proxy for "did a real Claude session run since
    X" - not a live usage API (none exists), but a much closer match than a
    blind fixed-interval timer.

    Widened same day, real bug found live: this only ever looked at
    `claude_space.glob("*/README.md")` (one level under ClaudeSpace) - a
    whole session's worth of real, continuous Claude activity building THIS
    widget lives entirely under dashboard-visualizer's own repo (Projects/
    dashboard-visualizer - widgets/*/index.jsx, scripts/*.py, config/*.json,
    this repo's own README.md), a sibling directory this glob never touched.
    Per Ian, live: "we were supposed to implement logic that detects initial
    activity after the timer runs down to refresh, why isn't that working" -
    root cause was the signal being too narrow, not the reset-on-activity
    logic itself (that part already worked correctly once given a true
    activity timestamp - confirmed by re-running load_session_reset by hand
    with the real widening below). Now also takes `repo_dir` (this script's
    own repo root, i.e. script_dir.parent in build_summary) and additionally
    scans: ClaudeSpace's own root-level *.md files (PROCESS.md, NEEDS-IAN.md,
    INDEX.md - work that only touches those, not a specific project's
    README, was the same blind spot one level up) and skills-usage-log.json
    (built the same day specifically as a self-reported activity signal -
    see PROCESS.md's Ground Rule on it); and, if repo_dir is given, that
    repo's own README.md, config/*.json, scripts/*.py, and every
    widgets/*/index.jsx - anything actually edited during a live widget
    session like this one.

    Widened again (2026-08-05), real gap found live: `overnight-auto-execute`
    and `daily-checkins` both write a report on EVERY real run (Step 4 /
    the BETA REPORT section) to `usage-scheduler/latest-report.md` and
    `usage-scheduler/reports/YYYY-MM-DD.md` - a guaranteed, every-single-run
    trace of real automated activity, and neither path was actually being
    scanned (`usage-scheduler/latest-report.md` isn't literally named
    `README.md`, so the `*/README.md` glob above skips it; `reports/*.md`
    is two directories deep, past what `*.md` at ClaudeSpace's root
    reaches). Now scanned directly, independent of whether that run also
    happened to touch skills-usage-log.json.

    `scheduled_snapshot_path` (2026-08-05) is the other half of the same
    round - per Ian: "is there a small file we can write to locally...
    on any activity after that 5 hr refresh, on first activity whether
    its me or an automated message, we update the initial time stamp."
    See `latest_scheduled_task_run_epoch`'s own docstring for why this is
    a separate cache file rather than a live query - this script has no
    MCP access to call the scheduling system directly."""
    best_mtime = None

    def consider(path: Path):
        nonlocal best_mtime
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return
        if best_mtime is None or mtime > best_mtime:
            best_mtime = mtime

    for readme in claude_space.glob("*/README.md"):
        consider(readme)
    for md in claude_space.glob("*.md"):
        consider(md)
    consider(claude_space / "skills-usage-log.json")
    consider(claude_space / "usage-scheduler" / "latest-report.md")
    for report in claude_space.glob("usage-scheduler/reports/*.md"):
        consider(report)

    if repo_dir is not None:
        consider(repo_dir / "README.md")
        for cfg in (repo_dir / "config").glob("*.json"):
            consider(cfg)
        for script in (repo_dir / "scripts").glob("*.py"):
            consider(script)
        for widget_jsx in (repo_dir / "widgets").glob("*/index.jsx"):
            consider(widget_jsx)

    if scheduled_snapshot_path is not None:
        scheduled_epoch = latest_scheduled_task_run_epoch(scheduled_snapshot_path)
        if scheduled_epoch is not None and (best_mtime is None or scheduled_epoch > best_mtime):
            best_mtime = scheduled_epoch

    return best_mtime


def next_occurrence(now: datetime, weekday_name: str, time_str: str) -> datetime:
    """Next datetime matching the given weekday ('monday'..'sunday') and 'HH:MM' local time.

    Weekly usage-plan resets are a fixed day+time per Anthropic's own account-level
    schedule (not a rolling window) - see dashboard-visualizer/README.md for the
    research behind this. That means this is pure calendar math, no API needed.
    """
    target_weekday = WEEKDAYS.index(weekday_name.strip().lower())
    hour, minute = (int(part) for part in time_str.strip().split(":"))
    days_ahead = (target_weekday - now.weekday()) % 7
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(days=days_ahead)
    if candidate <= now:
        candidate += timedelta(days=7)
    return candidate


def load_usage_resets(config_path: Path, now: datetime) -> list[dict] | None:
    """Reads config/usage_resets.json (label/weekday/time entries) and computes
    a countdown for each. Returns None if the config is missing or empty - this
    feature is opt-in, not something to guess default values for."""
    if not config_path.exists():
        return None
    try:
        entries = json.loads(config_path.read_text(errors="ignore"))
    except (json.JSONDecodeError, OSError):
        return None
    if not entries:
        return None

    WEEK_SECONDS = 7 * 86400

    results = []
    for entry in entries:
        try:
            target = next_occurrence(now, entry["weekday"], entry["time"])
        except (KeyError, ValueError):
            continue
        seconds_left = (target - now).total_seconds()
        # elapsed_fraction (2026-07-31, per Ian - wanted a depleting gauge for
        # this too, not just the session countdown): a fixed weekly cadence
        # means the cycle length is always a known 7 days, so "how much of
        # this week's window is used up" is plain math off seconds_left, same
        # idea as session_reset's own elapsed_fraction just with a fixed
        # instead of manually-reported total.
        elapsed_fraction = max(0.0, min(1.0, 1 - (seconds_left / WEEK_SECONDS)))
        results.append(
            {
                "label": entry.get("label", "Weekly reset"),
                "resets_at": target.isoformat(timespec="minutes"),
                "days_left": int(seconds_left // 86400),
                "hours_left": int((seconds_left % 86400) // 3600),
                "elapsed_fraction": round(elapsed_fraction, 4),
            }
        )
    return results or None


# SESSION_WINDOW_HOURS_DEFAULT (2026-08-04) - Anthropic's own account-level
# session window (see dashboard-visualizer/README.md's research on this).
# Used only as a FALLBACK when config/session_reset.json doesn't specify its
# own "session_window_hours" (older configs, or a manual report that didn't
# include it) - see load_session_reset's own comment for why this is now a
# separate field from hours_from_report.
SESSION_WINDOW_HOURS_DEFAULT = 5.0


def load_session_reset(config_path: Path, now: datetime, last_activity_mtime: float | None = None) -> dict | None:
    """Reads config/session_reset.json - a MANUALLY reported anchor point, not
    something computed live (the ~5hr session window is rolling/usage-dependent,
    no fixed clock - see dashboard-visualizer/README.md). Format:
    {"reported_at": "<ISO timestamp>", "hours_from_report": 1.0, "session_window_hours": 5.0}
    Ian reports "X left, resets in Y hours" at some moment; this just counts
    down from that anchor and honestly shows how long ago it was reported,
    since the number drifts out of truth the more time passes without a
    fresh report.

    hours_from_report vs. session_window_hours (2026-08-04, real bug fix):
    these used to be the SAME number, which was wrong the moment Ian reports
    a REMAINING amount partway through a window rather than the window's
    full length - e.g. "3h18m left" partway through a real ~5hr window. Using
    that 3.3 as both the countdown target AND the bar's 100%-full reference
    made the bar render as nearly full (3.3 remaining out of a 3.3 "total"),
    when it should read as ~66% (3.3 remaining out of the real 5hr window).
    hours_from_report now ONLY drives the actual countdown/target (unchanged
    behavior); session_window_hours is the separate, comparatively stable
    "how long is a full window" figure the bar's fraction is measured
    against - falls back to SESSION_WINDOW_HOURS_DEFAULT if the config
    doesn't set it (e.g. an older report that predates this field).

    last_activity_mtime (2026-08-04) is the raw timestamp from
    latest_tracker_activity_mtime - see the reset-on-first-activity block
    below for how it's used."""
    if not config_path.exists():
        return None
    try:
        data = json.loads(config_path.read_text(errors="ignore"))
    except (json.JSONDecodeError, OSError):
        return None
    if not data or "reported_at" not in data or "hours_from_report" not in data:
        return None

    try:
        reported_at = datetime.fromisoformat(data["reported_at"])
    except ValueError:
        return None
    if reported_at.tzinfo is not None:
        reported_at = reported_at.replace(tzinfo=None)

    total_hours = float(data["hours_from_report"])
    window_hours = float(data.get("session_window_hours") or SESSION_WINDOW_HOURS_DEFAULT)

    # Reset-on-first-activity (2026-08-04), replacing the earlier
    # roll-forward-by-fixed-cycles approach (2026-08-02). Per Ian, live: the
    # old auto-roll was "pretty inaccurate" - it ticked the anchor forward by
    # a blind whole-cycle timer regardless of whether anything had actually
    # happened, so a quiet stretch with no real Claude usage still silently
    # advanced the window as if a fresh one had started. Ian's own framing of
    # how this actually works: "it essentially starts a 5hr timer when the
    # first Claude task or prompt or scheduled thing runs" after the
    # previous window closes - not on a fixed clock. That's a real behavior
    # difference worth matching, given there's still no API exposing
    # Claude's true session-reset boundary (confirmed, see NEEDS-IAN.md).
    #
    # New logic: once the window has fully expired, DON'T roll forward on a
    # schedule - hold at "expired" (already_passed stays true, gauge reads
    # empty) until real tracker activity is observed. last_activity_mtime
    # (see latest_tracker_activity_mtime's own comment for why README mtimes
    # are an honest proxy for "a Claude session did something") is compared
    # against the window's own expiry: the first time that mtime lands AFTER
    # expiry, that moment - not "now," which could be well later if nobody's
    # glanced at the widget in a while - becomes the new window's real start,
    # matching the "first one that runs" framing exactly. Still an estimate
    # (a same-machine file-edit signal, not Anthropic's real usage clock),
    # but it only moves in response to something actually happening, instead
    # of guessing forward on a timer regardless.
    if total_hours > 0:
        cycle_seconds = total_hours * 3600
        expires_at = reported_at + timedelta(seconds=cycle_seconds)
        if now >= expires_at and last_activity_mtime is not None:
            activity_at = datetime.fromtimestamp(last_activity_mtime)
            if activity_at > expires_at:
                reported_at = activity_at
                # Fresh window (2026-08-04): a brand-new session that just
                # started has its FULL length ahead of it, not whatever
                # partial amount was last manually reported (e.g. if Ian's
                # last report was "3h18m left," that 3.3 was correct for
                # THAT window's remaining countdown, but the next window
                # after it starts with the full session_window_hours ahead,
                # not another 3.3hr cycle). Reset both in-memory (so this same
                # poll's target/fraction below are already right) and
                # persisted.
                total_hours = window_hours
                try:
                    data["reported_at"] = reported_at.isoformat(timespec="seconds")
                    data["hours_from_report"] = window_hours
                    data["note"] = (
                        f"Auto-reset by status_summary.py on {now.isoformat(timespec='seconds')} - "
                        "the previous session window expired and this is the first tracker "
                        "activity (a ClaudeSpace README/.md touch or a dashboard-visualizer repo "
                        "edit - see latest_tracker_activity_mtime) seen since then, treated as the "
                        "start of the new session window (full session_window_hours ahead of it, "
                        "not the prior partial countdown). Estimate based on local file activity, "
                        "not a true live sync (no session-reset API exists) - overwritten the "
                        "moment Ian reports a fresh 'resets in Xh Ym.'"
                    )
                    config_path.write_text(json.dumps(data, indent=2))
                except OSError:
                    pass  # display still works this poll even if the write fails

    target = reported_at + timedelta(hours=total_hours)
    seconds_left = (target - now).total_seconds()
    reported_hours_ago = (now - reported_at).total_seconds() / 3600

    # elapsed_fraction (2026-07-31, per Ian: "I don't need rolling/approximate...
    # I'd love a little time bar that ticks down... and restarts when session
    # timer restarts"). This doesn't change what's fundamentally knowable - the
    # window's real length is still whatever Ian last reported (session_window_hours),
    # not something this script can detect live (see this function's own
    # docstring) - it's a display upgrade, not a new capability. "Restarts
    # when session restarts" already just works with no extra code: this is
    # recomputed fresh from session_reset.json every poll, so the moment Ian
    # reports a new reported_at/hours_from_report, the fraction (and
    # therefore the bar) jumps to reflect the new numbers on its own.
    # Denominator switched from total_hours to window_hours (2026-08-04, real
    # bug fix) - see this function's own comment above on why those are now
    # two different numbers: the bar should read "how much of the real ~5hr
    # window is left," not "how much of whatever was just reported is left"
    # (the latter always reads as nearly-full right after any report, which
    # is what Ian caught live). Clamped to [0, 1] so a stale (already_passed)
    # anchor renders as a full bar rather than overshooting past it.
    elapsed_fraction = 1.0 if window_hours <= 0 else 1 - (seconds_left / (window_hours * 3600))
    elapsed_fraction = max(0.0, min(1.0, elapsed_fraction))

    return {
        "label": "Session",
        "minutes_left": max(0, round(seconds_left / 60)),
        "already_passed": seconds_left <= 0,
        "reported_hours_ago": round(reported_hours_ago, 1),
        "elapsed_fraction": round(elapsed_fraction, 4),
    }


PERSONAL_HEALTH_INTERVAL_MINUTES = 60

# AWAY_IDLE_THRESHOLD_MINUTES (2026-08-02, per Ian: "if there is idle or long
# periods where I am away, can we change the icon... I don't want it to be
# in the 'needs a break' when I just am inactive or away"). No number given -
# 5 minutes is a reasonable, easy-to-tune-later default for "genuinely
# stepped away" vs. just reading/thinking at the keyboard. Flagging it as a
# guess, not a decided value, same as every other un-specified threshold in
# this file (DONE_RECENT_DAYS, STALE_DAYS_THRESHOLD).
AWAY_IDLE_THRESHOLD_MINUTES = 5


def get_system_idle_seconds() -> float | None:
    """macOS-only: seconds since the last keyboard/mouse input anywhere on
    the machine, read via `ioreg`'s HIDIdleTime (nanoseconds since last
    HID event). This is a real, commonly-used local signal (not an
    Anthropic/Claude API - no such thing exists for "is Ian actively using
    Claude specifically"), so it's an honest proxy for "away from the
    computer," not literally "away from Claude." Returns None if
    unavailable (wrong platform, ioreg missing, unexpected output) so
    callers fall back to "assume active" rather than guessing at absence."""
    try:
        out = subprocess.run(
            ["ioreg", "-c", "IOHIDSystem"],
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for line in out.splitlines():
        if "HIDIdleTime" in line:
            digits = "".join(ch for ch in line.split("=")[-1] if ch.isdigit())
            if digits:
                return int(digits) / 1_000_000_000
    return None


def load_personal_health(config_path: Path, now: datetime) -> dict | None:
    """Reads config/last_break.json - {"last_break_at": "<ISO timestamp>",
    "away_since": "<ISO timestamp>" | null} - and counts down from
    PERSONAL_HEALTH_INTERVAL_MINUTES (60) since last_break_at. Added
    2026-07-31 per Ian, tied to wellbeing-check's "unhealthy pattern" open
    question. The widget's own click handler rewrites last_break_at to "now"
    when Ian marks a break taken by hand (locked to overdue-only, see
    index.jsx) - away_since below is the automatic counterpart, added
    2026-08-02.

    Away handling: while get_system_idle_seconds() reports idle time past
    AWAY_IDLE_THRESHOLD_MINUTES, this freezes the countdown at the moment
    idle began (never counts down, never goes overdue, while away - per
    Ian's explicit ask) and reports "away": True so the widget can swap to a
    sleeping icon instead of the heartbeat. The instant activity resumes
    (idle drops back below threshold), last_break_at auto-resets to now -
    "auto start the 60m timer when I start working... again" - since a real
    away stretch already functions as a break whether or not Ian clicked
    anything. away_since is persisted so this only has to detect each
    away/active TRANSITION once, not re-derive it every 20s poll."""
    if not config_path.exists():
        return None
    try:
        data = json.loads(config_path.read_text(errors="ignore"))
    except (json.JSONDecodeError, OSError):
        return None
    if not data or "last_break_at" not in data:
        return None

    try:
        last_break_at = datetime.fromisoformat(data["last_break_at"])
    except ValueError:
        return None
    if last_break_at.tzinfo is not None:
        last_break_at = last_break_at.replace(tzinfo=None)

    away_since = None
    away_since_raw = data.get("away_since")
    if away_since_raw:
        try:
            away_since = datetime.fromisoformat(away_since_raw)
            if away_since.tzinfo is not None:
                away_since = away_since.replace(tzinfo=None)
        except ValueError:
            away_since = None

    idle_seconds = get_system_idle_seconds()
    is_idle_now = idle_seconds is not None and idle_seconds >= AWAY_IDLE_THRESHOLD_MINUTES * 60

    data_changed = False
    if is_idle_now:
        if away_since is None:
            # Just crossed the threshold - back-calculate the real moment
            # idle actually started (from idle_seconds itself) rather than
            # freezing at "now," so the frozen countdown reflects when Ian
            # actually stepped away, not when this poll happened to notice.
            away_since = now - timedelta(seconds=idle_seconds)
            data["away_since"] = away_since.isoformat(timespec="seconds")
            data_changed = True
        away = True
    else:
        if away_since is not None:
            # Returning from an away stretch - auto-restart the 60m timer,
            # per Ian's explicit ask, rather than resuming a countdown that
            # was frozen mid-way.
            last_break_at = now
            data["last_break_at"] = now.isoformat(timespec="seconds")
            data["away_since"] = None
            data_changed = True
        away = False

    if data_changed:
        try:
            data["note"] = (
                "Auto-managed by status_summary.py's away-detection "
                f"(2026-08-02) - last touched {now.isoformat(timespec='seconds')}."
            )
            config_path.write_text(json.dumps(data, indent=2))
        except OSError:
            pass  # display still works this poll even if the write fails

    # Frozen while away: compute against the moment idle began, not "now,"
    # so the bar/label neither keeps ticking down nor flips overdue while
    # Ian is genuinely away - exactly what he asked not to happen.
    effective_now = away_since if away else now

    total_seconds = PERSONAL_HEALTH_INTERVAL_MINUTES * 60
    target = last_break_at + timedelta(minutes=PERSONAL_HEALTH_INTERVAL_MINUTES)
    seconds_left = (target - effective_now).total_seconds()
    minutes_since_break = (effective_now - last_break_at).total_seconds() / 60

    elapsed_fraction = 1 - (seconds_left / total_seconds)
    elapsed_fraction = max(0.0, min(1.0, elapsed_fraction))

    return {
        "label": "Last Break",
        "minutes_left": max(0, round(seconds_left / 60)),
        "minutes_since_break": round(minutes_since_break),
        "overdue": (not away) and seconds_left <= 0,
        "elapsed_fraction": round(elapsed_fraction, 4),
        "away": away,
    }


GOAL_MATCH_STOPWORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "not", "no", "yet", "of", "to",
    "in", "on", "for", "with", "as", "is", "was", "are", "be", "been",
    "it", "its", "this", "that", "these", "those", "at", "by", "from",
    "if", "so", "than", "then", "into", "per", "via", "own", "real",
    "still", "already", "just", "also", "one", "two", "new", "ian",
    "sign", "off", "signed", "definition", "project",
})


def _goal_match_tokens(text: str, exclude: set[str]) -> set[str]:
    """Lowercase word/hyphenated-word tokens (>= 3 chars) from `text`, minus
    generic stopwords and whatever's in `exclude` (typically the project
    name itself and its hyphen-split parts, so "system-healthcheck" doesn't
    trivially "match" every entry that mentions the project). Used only by
    project_needs_ian_status's per-entry disambiguation below - this is a
    cheap word-overlap heuristic, not real NLP, and is only ever trusted
    above a minimum shared-word threshold for exactly that reason."""
    tokens = set(re.findall(r"[a-z0-9][a-z0-9\-]{2,}", text.lower()))
    return tokens - GOAL_MATCH_STOPWORDS - exclude


def project_needs_ian_status(needs_ian_text: str, project: str, goal_text: str = "") -> str:
    """Per-project completion signal for load_daily_goal's per-item tracking
    (2026-08-04), per Ian: "when a goal's real item gets completed the goal
    can remain for the day but have strike thru and move to the bottom."
    Aggregate progress (see load_daily_goal's own docstring) can say a goal
    is done in general, but can't say WHICH goal - this can, for the common
    case where a goal's title names a project that also has a NEEDS-IAN.md
    entry, by checking that project's own entries specifically.

    Unlike count_needs_ian/parse_needs_ian_items (which deliberately only
    look at OPEN 🤔/🚧 entries - see their own comments), this scans every
    top-level bullet under "## List", open and ✅ Resolved alike, since
    telling "resolved" from "never had an entry" is exactly the distinction
    a per-item completion check needs.

    Per-entry matching (2026-08-06 fix, real bug found live): a project
    can carry several independent open threads at once -
    `system-healthcheck`'s stale-project-definition goal signed off and
    shipped 2026-08-06, but the widget still wouldn't cross it off, because
    that same project ALSO had two other, unrelated open NEEDS-IAN.md
    entries (a report-surface decision, a network-blocked dependency pass).
    The old version aggregated every entry for a project into one
    has_open/has_resolved pair - "any open entry wins" - so a goal could
    never read resolved once its own project had ANY other loose end, no
    matter how unrelated. Now, when a project has more than one entry: each
    candidate entry is scored against `goal_text` (the goal's own title +
    detail, passed in by load_daily_goal) by shared significant words -
    project name and generic stopwords excluded via _goal_match_tokens -
    and the best-scoring entry's own status is trusted, but ONLY if the
    match clears a minimum bar (>= 2 shared words). A weak or absent match
    falls back to 'unknown' rather than guessing - the caller already knows
    to use the coarser aggregate signal in that case, so understating a
    match is always safer than fabricating one.

    Returns 'open' if the relevant entry (or, with one entry only, THE
    entry) referencing this project is 🤔/🚧, 'resolved' if it's ✅, or
    'unknown' if this project has no NEEDS-IAN.md entry at all, or has
    several and none can be confidently tied to this specific goal -
    callers should fall back to the aggregate signal in either case rather
    than assuming either way."""
    list_section = needs_ian_text.split("## List", 1)
    body = list_section[1] if len(list_section) > 1 else needs_ian_text

    entries: list[tuple[str, str]] = []  # (status, full entry line)
    for line in body.splitlines():
        kind_match = re.match(r"^- (🤔|🚧|✅)", line)
        if not kind_match:
            continue
        project_match = PROJECT_NAME_ANYWHERE_RE.search(line)
        if not project_match or project_match.group(1) != project:
            continue
        status = "resolved" if kind_match.group(1) == "✅" else "open"
        entries.append((status, line))

    if not entries:
        return "unknown"
    if len(entries) == 1:
        return entries[0][0]

    exclude = {project} | set(project.split("-"))
    goal_tokens = _goal_match_tokens(goal_text, exclude)
    if not goal_tokens:
        return "unknown"

    best_status, best_score = None, 0
    for status, line in entries:
        score = len(goal_tokens & _goal_match_tokens(line, exclude))
        if score > best_score:
            best_status, best_score = status, score

    return best_status if best_score >= 2 else "unknown"


def load_daily_goal(
    config_path: Path,
    totals: dict,
    needs_ian_count: int,
    needs_ian_text: str = "",
    code_project_names: frozenset = frozenset(),
) -> dict | None:
    """Reads config/daily_goal.json, written by the goal-for-day skill (see
    ClaudeSpace/goal-for-day/SKILL.md) - NOT generated here, same free/
    deferred pattern as everything else in this file (this script never
    makes its own LLM judgment calls; deciding what today's actual goal
    should be is real judgment over full tracker context, the skill's job,
    same reasoning log-pose's own README gives for the same split).

    What THIS function does mechanically: (1) only returns a goal for
    TODAY's date - a goal from a previous day is stale, not carried over
    silently; (2) computes a simple, honest completion proxy by comparing
    the goal's own baseline snapshot (needs_ian_count/idea total/done_recent
    at the moment the goal was set) against the current live numbers -
    "progress" is however many Needs Attention items have since cleared,
    plus however many ideas have since left the Idea section, plus however
    many things got marked done, summed. Completed once that sum reaches
    the goal's own target_count. This is a proxy, not literal task-tracking
    (it can't know if the SPECIFIC items the goal named got done, only that
    SOME equivalent amount of real tracker movement happened since) -
    flagged here the same way every other honest-proxy signal in this file
    is (away-detection, session-reset auto-roll, etc.).

    Schema change (2026-08-04), per Ian: "can the goal for the day be a list
    as well... more readable." `goal_text` (single string) is replaced by
    `goals` (a list of strings) - the widget now renders this as a proper
    collapsible "Daily Goals" section (header + list) instead of one
    cramped line. Completion is still tracked in aggregate only (the proxy
    above can't tell which SPECIFIC item moved, only that some equivalent
    amount of tracker movement happened) - when `completed` flips true, the
    widget marks every item in the list done together, not individually.

    Schema change again, same day, per Ian's direct follow-up: "have it
    match the style of the other collapsible sections and have brief
    summary that can be explandable and have it clickable so that i can
    work on it in a new thread." Each entry in `goals` is now an object -
    `{"title": "...", "detail": "..."}` - instead of a plain string, so the
    widget can give each item the same title+expandable-detail+
    click-to-copy-a-working-prompt treatment every other row in this file
    already has (ProjectRow, AttentionEntryRow). `detail` is optional; a
    plain string is still accepted per-item for backward compatibility
    (normalized to `{"title": item, "detail": None, ...}` below) so an
    older goals list written before this change doesn't just silently
    vanish.

    Two more optional fields added the same day, per Ian's further
    follow-up: "maybe sub sections can be summary, an explandable read out
    of what section it currently lives in and maybe the previous context
    piece or whatever." `current_section` (which tracker section/status the
    referenced item lives in right now - "Needs Attention," "Backlog,"
    etc.) and `context` (why it matters / prior related info) - both
    rendered as their own independently-expandable SubField in the widget,
    same shape ProjectRow already uses for Summary/Next steps/etc.

    Per-item `completed` added (2026-08-04 follow-up), per Ian: "when a
    goal's real item gets completed the goal can remain for the day but
    have strike thru and move to the bottom of the daily goals." The
    aggregate `progress`/`completed`/`target_count` above are kept exactly
    as before (still the only honest signal for goals whose item can't be
    traced to a specific project), but each entry in `goals` now ALSO gets
    its own `completed` bool: pulls the first backtick `` `project-name` ``
    out of the goal's title and checks project_needs_ian_status for it - a
    project with only ✅ Resolved NEEDS-IAN.md entries left is a real,
    specific "this one's done" signal, not just "some equivalent amount of
    tracker movement happened somewhere." (2026-08-06: passes the goal's own
    title+detail through too, so project_needs_ian_status can tell this
    goal's own entry apart from a same-project entry about something else
    entirely - see that function's own docstring for why this exists.)
    Falls back to the shared aggregate `completed` flag when the title
    doesn't name a recognizable project, or that project has no NEEDS-IAN.md
    entry at all to check (status 'unknown') - so a goal never regresses to
    "can't tell" silently, it just
    inherits the coarser signal instead.

    `requires_code` added same follow-up round, per Ian: "it should specify
    if it should be pasted into a regular thread or code if it requires
    code or plugins." Reuses the directory convention INDEX.md/PROCESS.md
    already draw (`../Projects/` = real code, `ClaudeSpace/<name>/` =
    tracker/skill work, no repo) rather than inventing a new signal - a
    goal's named project is looked up in `code_project_names` (every
    INDEX.md project whose link points into `../Projects/`, built once in
    build_summary) and flagged True if it's a real code project. False
    (including when the project can't be identified at all) means "regular
    thread" - the safer default, since most tracker work isn't code."""
    if not config_path.exists():
        return None
    try:
        data = json.loads(config_path.read_text(errors="ignore"))
    except (json.JSONDecodeError, OSError):
        return None
    if not data or "date" not in data or "goals" not in data or not data["goals"]:
        return None

    goals = [
        {"title": g, "detail": None, "current_section": None, "context": None}
        if isinstance(g, str)
        else {
            "title": g.get("title", ""),
            "detail": g.get("detail"),
            "current_section": g.get("current_section"),
            "context": g.get("context"),
        }
        for g in data["goals"]
    ]

    today_str = datetime.now().strftime("%Y-%m-%d")
    if data["date"] != today_str:
        return None

    baseline = data.get("baseline", {})
    target_count = int(data.get("target_count", 1))

    progress = 0
    progress += max(0, baseline.get("needs_ian_count", needs_ian_count) - needs_ian_count)
    progress += max(0, baseline.get("idea_total", totals.get("idea", 0)) - totals.get("idea", 0))
    progress += max(0, totals.get("done_recent", 0) - baseline.get("done_recent", totals.get("done_recent", 0)))
    aggregate_completed = progress >= target_count

    for goal in goals:
        project_match = PROJECT_NAME_ANYWHERE_RE.search(goal["title"] or "")
        project = project_match.group(1) if project_match else None
        goal_text = f"{goal.get('title') or ''} {goal.get('detail') or ''}"
        item_status = (
            project_needs_ian_status(needs_ian_text, project, goal_text) if project else "unknown"
        )
        if item_status == "resolved":
            goal["completed"] = True
        elif item_status == "open":
            goal["completed"] = False
        else:
            goal["completed"] = aggregate_completed
        goal["requires_code"] = bool(project) and project in code_project_names

    return {
        "date": data["date"],
        "time_budget_minutes": data.get("time_budget_minutes"),
        "goals": goals,
        "target_count": target_count,
        "progress": min(progress, target_count),
        "completed": aggregate_completed,
    }


SKILL_NAME_RE = re.compile(r"^name:\s*(.+)$", re.MULTILINE)
SKILL_DESC_RE = re.compile(r"^description:\s*(.+)$", re.MULTILINE)
SKILL_CALLS_RE = re.compile(r"^calls:\s*(.+)$", re.MULTILINE)
# Raised 160 -> 600 (2026-08-05), per Ian, looking at the Skill Tray's new
# click-to-open overlay live: "with this extra space we can have the
# summary go longer and provide more info... this doesn't need to be
# expandable but we can provide summary." The overlay already scrolls
# (`overflow-y: auto`) once it's open, so there's no real UI reason to cut
# a description short at all - 160 was sized for the old cramped hover
# tooltip this overlay replaced several rounds ago, never revisited since.
#
# No longer a real display cap at all (2026-08-05, real bug found live) -
# per Ian, seeing `time-assessor`'s own description cut off mid-sentence
# with a trailing "…": "i dont like the ... in the summary if we can have
# scroll here we should rewrite summaries so they are complete ideas and
# not trail off." The 600-char figure above was already wrong the day it
# was set - claimed to "comfortably fit every real description... in full"
# but `time-assessor`'s real description (the one in Ian's screenshot) was
# already longer than that. Checked every real SKILL.md `description:` in
# this workspace: each one is already written as a complete, well-formed
# paragraph ending in a real sentence - the "trailing off" was never a
# writing-quality problem in the descriptions themselves, purely an
# artifact of this file cutting them short. The overlay scrolls specifically
# so a long description has somewhere to go instead of needing to be
# shortened - so stop shortening it.
#
# SKILL_DESC_HARD_SAFETY_CAP is NOT the same kind of limit - it only
# exists to stop a genuinely pathological SKILL.md (a malformed file with
# megabytes of accidental content landing in its description line) from
# blowing out the panel, sits far above any real description ever written
# here, and marks itself as truncated explicitly rather than trailing off
# with a bare "…" that reads like a natural, if long, complete thought.
SKILL_DESC_HARD_SAFETY_CAP = 4000


def _script_description(text: str) -> str:
    """Best-effort one-line description for a script that has no
    frontmatter convention (unlike SKILL.md) - the first real comment/
    docstring line, skipping a leading shebang and blank lines. Returns
    "" if no such line is found within the first few lines (honest empty
    state, never guessed)."""
    lines = text.splitlines()
    i = 0
    while i < min(6, len(lines)):
        stripped = lines[i].strip()
        if not stripped or stripped.startswith("#!"):
            i += 1
            continue
        if stripped.startswith('"""') or stripped.startswith("'''"):
            quote = '"""' if stripped.startswith('"""') else "'''"
            # Check if line is just the opening quotes (multi-line docstring)
            if stripped == quote:
                # Multi-line: next line has the summary
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line and not next_line.startswith(quote):
                        return next_line
                return ""
            else:
                # Same-line docstring
                return stripped.strip('"').strip("'").strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
        break
    return ""


def load_scripts_catalog(claude_space: Path, dashboard_visualizer_dir: Path) -> list:
    """Script Tray data source (2026-08-05). Unlike skills (which have a
    SKILL.md frontmatter convention), there is no metadata convention for
    scripts yet - this reads only what can be honestly determined from
    the filesystem: every */scripts/*.py and */scripts/*.sh under
    claude_space, plus this repo's (dashboard_visualizer_dir) own
    scripts/*.py and scripts/*.sh. No call-count/usage-log fields (no
    such log exists for scripts) - deliberately narrower than
    load_skills_catalog, not a placeholder for later."""
    scripts = []

    def add_scripts_from(scripts_dir: Path, project_name: str):
        entries = list(scripts_dir.glob("*.py")) + list(scripts_dir.glob("*.sh"))
        for script_path in sorted(entries):
            try:
                text = script_path.read_text(errors="ignore")
            except OSError:
                text = ""
            try:
                updated_hours_ago = round(
                    (datetime.now() - datetime.fromtimestamp(script_path.stat().st_mtime)).total_seconds() / 3600, 1
                )
            except OSError:
                updated_hours_ago = None
            scripts.append({
                "name": script_path.stem,
                "project": project_name,
                "path": f"{project_name}/scripts/{script_path.name}",
                "description": _script_description(text),
                "updated_hours_ago": updated_hours_ago,
            })

    for scripts_dir in sorted(claude_space.glob("*/scripts")):
        if scripts_dir.is_dir():
            add_scripts_from(scripts_dir, scripts_dir.parent.name)

    own_scripts_dir = dashboard_visualizer_dir / "scripts"
    if own_scripts_dir.is_dir():
        add_scripts_from(own_scripts_dir, dashboard_visualizer_dir.name)

    return sorted(scripts, key=lambda s: (s["project"], s["name"]))


def load_skills_catalog(claude_space: Path) -> list:
    """Skills Tray data source (2026-08-04), per Ian: "i want to visualize
    and keep track of how often they are getting run and brief
    descriptions of what they do."

    Two pieces, merged: (1) scans ClaudeSpace/*/SKILL.md for `name`/
    `description`/`calls` (YAML frontmatter, single-line values - matches
    every real SKILL.md in this workspace today, no full YAML parser
    needed); (2) reads config/../ClaudeSpace/skills-usage-log.json
    (written by whichever skill just ran, per PROCESS.md's Ground Rule - a
    self-reported signal, same honest-proxy pattern as run-log.md/
    relationship-log.md elsewhere in this workspace, not hard telemetry)
    for call_count and how long ago each skill last ran.

    manual_count/auto_count split (2026-08-04), real gap found live - Ian:
    "it says these have never run? we need to keep track of when they ran
    and count the number of times... also we need to make sure these are
    all distinguished [manual vs auto-executed]." Root cause of "never
    run" for everything: the Ground Rule existed but nothing had actually
    been appending to the log yet - the mechanism was real, just unused.
    Seeded one real entry (goal-for-day, which genuinely ran today) rather
    than fabricating history for skills that didn't actually run. Log
    entries now carry an optional `"trigger": "manual"|"auto"` field
    (missing/unrecognized values default to "manual", the safer assumption
    since most historical calls were Ian asking directly) - each skill's
    catalog entry reports `call_count` (total), `manual_count`, and
    `auto_count` separately so the widget can show "3x manual - 2x auto"
    instead of one undifferentiated number.

    `calls` field (2026-08-04) - some skills invoke OTHER skills as part
    of their own run (overnight-auto-execute calls log-pose and
    time-assessor; goal-for-day calls time-assessor) - per Ian: "for these
    skills like log pose or auto exec they should include what other
    skills they run or call." Parsed the same single-line-frontmatter way
    as name/description, comma-separated skill names, only added to the
    SKILL.md files that are actually known to call others - not guessed
    for the rest.

    Known limitation, flagged honestly rather than silently: this only
    catalogs skills with a SKILL.md file physically present in
    ClaudeSpace. A few real skills (incubator, skill-creator) are saved
    directly to Cowork's own skill store with no local mirror here - no
    local-file-reading script can see into that store, so they won't
    appear unless/until a SKILL.md gets added for them too. Logged usage
    for an unmirrored skill still surfaces (with an empty description)
    rather than being silently dropped.

    Sorted by call_count descending (most-used first), then name
    ascending for ties - "how often they are getting run" is the primary
    ask, so the busiest skills lead."""
    catalog = {}
    for skill_md in sorted(claude_space.glob("*/SKILL.md")):
        try:
            text = skill_md.read_text(errors="ignore")
        except OSError:
            continue
        name_match = SKILL_NAME_RE.search(text)
        if not name_match:
            continue
        name = name_match.group(1).strip()
        desc_match = SKILL_DESC_RE.search(text)
        description = desc_match.group(1).strip() if desc_match else ""
        if len(description) > SKILL_DESC_HARD_SAFETY_CAP:
            description = description[:SKILL_DESC_HARD_SAFETY_CAP].rsplit(" ", 1)[0] + " [truncated - malformed SKILL.md?]"
        calls_match = SKILL_CALLS_RE.search(text)
        calls = [c.strip() for c in calls_match.group(1).split(",") if c.strip()] if calls_match else []
        # updated_hours_ago (2026-08-05) - per Ian: "provide... latest
        # update... when new skill is created or skill is updated skill
        # tray needs to update." SKILL.md's own mtime, same file-mtime
        # pattern every other "last touched"/"X hours ago" signal in this
        # script already uses (see e.g. most_recently_touched_project) -
        # editing a skill's SKILL.md IS what "updating" a skill means in
        # this workspace, so this is a real signal, not a guess. This part
        # was already live the moment it's read: `claude_space.glob(...)`
        # re-scans the real folder on every widget refresh, so a newly
        # created or freshly edited SKILL.md shows up (and gets a fresh
        # mtime) automatically, no caching layer sits in front of it.
        try:
            updated_hours_ago = round((datetime.now() - datetime.fromtimestamp(skill_md.stat().st_mtime)).total_seconds() / 3600, 1)
        except OSError:
            updated_hours_ago = None
        catalog[name] = {
            "name": name,
            "description": description,
            "calls": calls,
            "called_by": [],
            "call_count": 0,
            "manual_count": 0,
            "auto_count": 0,
            "last_called_hours_ago": None,
            "updated_hours_ago": updated_hours_ago,
        }

    usage_log_path = claude_space / "skills-usage-log.json"
    if usage_log_path.exists():
        try:
            entries = json.loads(usage_log_path.read_text(errors="ignore"))
        except (json.JSONDecodeError, OSError):
            entries = []
        if not isinstance(entries, list):
            entries = []
        now = datetime.now()
        manual_counts: dict = {}
        auto_counts: dict = {}
        latest_by_skill: dict = {}
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            skill = entry.get("skill")
            at = entry.get("at")
            if not skill or not at:
                continue
            trigger = entry.get("trigger") if entry.get("trigger") in ("manual", "auto") else "manual"
            if trigger == "auto":
                auto_counts[skill] = auto_counts.get(skill, 0) + 1
            else:
                manual_counts[skill] = manual_counts.get(skill, 0) + 1
            try:
                at_dt = datetime.fromisoformat(at)
            except ValueError:
                continue
            if skill not in latest_by_skill or at_dt > latest_by_skill[skill]:
                latest_by_skill[skill] = at_dt
        all_skills = set(manual_counts) | set(auto_counts)
        for skill in all_skills:
            if skill not in catalog:
                catalog[skill] = {
                    "name": skill,
                    "description": "",
                    "calls": [],
                    "called_by": [],
                    "call_count": 0,
                    "manual_count": 0,
                    "auto_count": 0,
                    "last_called_hours_ago": None,
                    "updated_hours_ago": None,
                }
            manual = manual_counts.get(skill, 0)
            auto = auto_counts.get(skill, 0)
            catalog[skill]["manual_count"] = manual
            catalog[skill]["auto_count"] = auto
            catalog[skill]["call_count"] = manual + auto
            last = latest_by_skill.get(skill)
            if last:
                catalog[skill]["last_called_hours_ago"] = round((now - last).total_seconds() / 3600, 1)

    # called_by (2026-08-05) - the reverse of `calls`, per Ian: "provide...
    # if its used by other skills." `calls` (built above, from each
    # skill's own SKILL.md frontmatter) only ever answers "what does THIS
    # skill invoke" - looking at, say, `time-assessor`'s own entry gives
    # no way to tell it's actually invoked BY `log-pose`/`goal-for-day`/
    # `overnight-auto-execute` without cross-referencing all three by
    # hand. One pass over the catalog once every `calls` list is known:
    # for each skill A that declares it calls skill B, append A's name to
    # B's own `called_by` list - a real, computed answer instead of
    # something Ian would have to piece together himself from three
    # different skills' descriptions.
    for skill_entry in catalog.values():
        for called_name in skill_entry.get("calls", []):
            if called_name in catalog and skill_entry["name"] not in catalog[called_name]["called_by"]:
                catalog[called_name]["called_by"].append(skill_entry["name"])
    for skill_entry in catalog.values():
        skill_entry["called_by"].sort()

    return sorted(catalog.values(), key=lambda s: (-s["call_count"], s["name"]))


def build_reports_payload(claude_space: Path, script_dir: Path) -> dict:
    """Reports Tray v2 (2026-08-08) - the uniform {source: {"instances": [...]}}
    payload the widget's HexGrid consumes directly, one entry per archive
    source. Running-log sources (skill-auditor, automation-scout) and
    tip-of-day are a follow-up (Plan B) - this only wires the three
    sources that already have a clean one-file-per-day archive."""
    viewed_path = script_dir.parent / "config" / "reports_viewed.json"
    viewed = load_reports_viewed(viewed_path)

    return {
        "ianlogger": {
            "instances": list_archive_instances(
                claude_space / "ianlogger" / "logs",
                viewed.get("ianlogger", {}),
                load_log_entry,
            )
        },
        "usage_scheduler": {
            "instances": list_archive_instances(
                claude_space / "usage-scheduler" / "reports",
                viewed.get("usage_scheduler", {}),
                load_usage_report_entry,
            )
        },
        "dependency_audit": {
            "instances": list_archive_instances(
                claude_space / "dependency-audit" / "reports",
                viewed.get("dependency_audit", {}),
                load_dependency_audit_entry,
            )
        },
    }


def build_summary(claude_space: Path, script_dir: Path) -> dict:
    index_path = claude_space / "INDEX.md"
    needs_ian_path = claude_space / "NEEDS-IAN.md"
    resets_config_path = script_dir.parent / "config" / "usage_resets.json"
    session_reset_config_path = script_dir.parent / "config" / "session_reset.json"
    personal_health_config_path = script_dir.parent / "config" / "last_break.json"
    catalog_path = script_dir.parent / "config" / "project_catalog.json"
    scheduled_snapshot_path = script_dir.parent / "config" / "scheduled_tasks_snapshot.json"

    index_text = index_path.read_text(errors="ignore") if index_path.exists() else ""
    needs_ian_text = needs_ian_path.read_text(errors="ignore") if needs_ian_path.exists() else ""
    now = datetime.now()
    now_ts = now.timestamp()

    index_projects = parse_index_projects(index_text)
    catalog = load_catalog(catalog_path)
    sections = build_sections(claude_space, index_projects, catalog, now_ts)

    # "Dormant" is a synthetic 5th section (2026-07-31, per Ian) - not a real
    # status like active/idea/paused/done, just every project flagged stale
    # anywhere else, surfaced as its own subheader in the widget so it's not
    # buried inside Needs Attention as plain unclickable text. Same shape as
    # every other section ({"total", "shown"}) so the widget can reuse its
    # existing Section/ProjectRow rendering with no special-casing.
    dormant_items = collect_stale_projects(sections)
    sections["dormant"] = {"total": len(dormant_items), "shown": dormant_items}

    # "Bin" is a synthetic section too (2026-08-04), same pattern as Dormant
    # above - reads from _bin/BIN.md rather than INDEX.md/build_sections,
    # but shaped identically so the widget's existing Section/ProjectRow
    # handles it with zero new rendering code.
    bin_items = load_bin_items(claude_space)
    sections["bin"] = {"total": len(bin_items), "shown": bin_items}

    totals = count_statuses(index_text)
    # done_recent (2026-07-31): how many Done items were marked done within the
    # last DONE_RECENT_DAYS, using the same README-mtime signal as everything
    # else (see DONE_RECENT_DAYS' comment above). totals["done"] stays the
    # plain lifetime count exactly as before - this is an additional field,
    # not a replacement, since Ian wants both shown (recent in tiny mode, both
    # in big mode).
    totals["done_recent"] = sum(
        1
        for item in sections.get("done", {}).get("shown", [])
        if item.get("hours_ago") is not None and item["hours_ago"] <= DONE_RECENT_DAYS * 24
    )

    needs_ian_count = count_needs_ian(needs_ian_text)
    daily_goal_config_path = script_dir.parent / "config" / "daily_goal.json"
    # code_project_names (2026-08-04) - every INDEX.md project whose link
    # points into `../Projects/`, i.e. a real repo per PROCESS.md/INDEX.md's
    # own convention, rather than a ClaudeSpace/-only tracker or skill
    # folder. Feeds load_daily_goal's requires_code flag below.
    code_project_names = {
        p["name"] for p in index_projects if p.get("link") and p["link"].startswith("../Projects/")
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totals": totals,
        "active_project_names": active_project_names(index_text),
        "needs_ian_count": needs_ian_count,
        "most_recent_project": most_recently_touched_project(claude_space),
        "daily_goal": load_daily_goal(
            daily_goal_config_path, totals, needs_ian_count, needs_ian_text, code_project_names
        ),
        "usage_resets": load_usage_resets(resets_config_path, now),
        "session_reset": load_session_reset(
            session_reset_config_path,
            now,
            latest_tracker_activity_mtime(claude_space, script_dir.parent, scheduled_snapshot_path),
        ),
        "personal_health": load_personal_health(personal_health_config_path, now),
        "sections": sections,
        "needs_attention": parse_needs_ian_items(needs_ian_text),
        "skills": load_skills_catalog(claude_space),
        "scripts": load_scripts_catalog(claude_space, script_dir.parent),
        "log": load_latest_log(claude_space),
        "report": load_latest_usage_report(claude_space),
        "nuggets": load_persona_nuggets(claude_space),
        "reports": build_reports_payload(claude_space, script_dir),
    }


def main() -> int:
    claude_space = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop" / "ClaudeSpace"
    if not claude_space.exists():
        print(json.dumps({"error": f"ClaudeSpace folder not found at {claude_space}"}))
        return 1
    script_dir = Path(__file__).resolve().parent
    print(json.dumps(build_summary(claude_space, script_dir)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

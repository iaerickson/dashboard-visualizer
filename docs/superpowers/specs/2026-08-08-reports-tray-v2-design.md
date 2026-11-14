# Reports Tray v2: more sources, read/unread, backlog stacking

**Date:** 2026-08-08
**Status:** Approved, pending implementation plan

## Goal

Expand the Reports Tray (currently 2 real sources: ianlogger, usage-scheduler) to cover every sweep/audit/health-check the tracker already runs nightly, and give it real read/unread state: a hex is "filled" (attention-grabbing) only while it's unread, and if a source generates a new instance before the old one was read, the old one doesn't vanish — it stacks as its own hex until it's actually clicked. Also fixes the current hex-face titles (too long, truncate) and adds `system-healthcheck` as a report source for the first time (it currently only prints to stdout).

## Context (from a full inventory pass, 2026-08-07)

Confirmed BUILT, with real files on disk, one file per dated instance (`YYYY-MM-DD.md` or similar) — call these **archive sources**:
- `ianlogger` → `ianlogger/logs/YYYY-MM-DD.md` (already wired in)
- `usage-scheduler` → `usage-scheduler/reports/YYYY-MM-DD.md` (dated archive; `latest-report.md` is just a pointer to the newest one — already wired in, but only the pointer, not the archive)
- `dependency-audit` → `dependency-audit/reports/YYYY-MM-DD.md` (sparse, manual-triggered mostly)

Confirmed BUILT, but as one running file with dated entries appended *inside* it, not one file per instance — call these **running-log sources**:
- `skill-auditor` → `skill-auditor/relationship-log.md`
- `automation-scout` → `automation-scout/sweep-log.md`

Confirmed NOT BUILT yet, stdout-only:
- `system-healthcheck`'s `consistency_sweep.py` — this spec adds a dated-file write step, making it an **archive source** like dependency-audit.

Confirmed fundamentally different shape, included per the owner's direct call:
- `tip-of-day` (dashboard-visualizer widget) — no file at all today, deterministic day-of-year rotation. Gets exactly one "instance" per day (today's tip), never a backlog.

Explicitly deferred (per the owner, "for now I want to see it in reports, we can tweak later"): `dependency-audit`/`skill-auditor`/`automation-scout` already have their own hexes in the Skill Tray (call counts). Their *output* now also appears in Reports Tray. Acknowledged as possibly redundant; not resolved here.

## Design

### 1. Read/unread persistence: `config/reports_viewed.json`

One file, one entry per source:

```json
{
  "ianlogger": {"last_viewed_id": "2026-08-06"},
  "usage_scheduler": {"last_viewed_id": "2026-08-06"},
  "dependency_audit": {"last_viewed_id": "2026-08-04"},
  "system_healthcheck": {"last_viewed_id": null},
  "skill_auditor": {"last_viewed_mtime": 1723000000.0},
  "automation_scout": {"last_viewed_mtime": 1723000000.0},
  "tip_of_day": {"last_viewed_id": "2026-08-07"}
}
```

Archive sources (and tip-of-day) key on `last_viewed_id` — a date string, compared lexicographically against each instance's own filename-derived date (same "the filename IS the date" convention `report_summary.py`'s `find_latest_dated_file` already established). Running-log sources key on `last_viewed_mtime` — a float timestamp, compared against the log file's own `stat().st_mtime`, since there's no per-entry file to date-compare. Two different key shapes for two genuinely different signal types — not an inconsistency to unify, the same way `formatReportHoursAgo` vs `formatHoursAgo`'s different cutovers aren't.

Missing file or missing per-source entry = "never viewed" (everything currently unread) — same fail-open-to-honest-empty-state posture every other config anchor in this codebase already uses.

**Explicit simplification, stated here to close an ambiguity found in self-review:** this is a single watermark per source, not a per-instance read flag. Reading is assumed chronological — clicking the newest unread instance advances the watermark past it, which also marks any *older* still-unread instance as read even if it was never individually opened. This matches the common case the stacking behavior describes (you fell behind, you catch up in order) but means "read the newest first, come back for an older one later" isn't representable — clicking the newer one silently clears the older one too. A true per-instance flag set (open-ended growth in `reports_viewed.json`, one entry per date ever seen) would remove this limitation at the cost of unbounded file growth with no pruning story; not worth it for a first version. Revisit if reading out of chronological order turns out to matter in practice.

### 2. Data layer: uniform `instances` list per source

Python (`status_summary.py`/`report_summary.py`) returns:

```python
"reports": {
    "ianlogger": {"instances": [...]},
    "usage_scheduler": {"instances": [...]},
    "dependency_audit": {"instances": [...]},
    "system_healthcheck": {"instances": [...]},
    "skill_auditor": {"instances": [...]},   # always 0 or 1 items
    "automation_scout": {"instances": [...]}, # always 0 or 1 items
    "tip_of_day": {"instances": [...]},       # always 0 or 1 items
}
```

Every instance dict carries at minimum `{"id": str, "viewed": bool, ...source-specific content fields}`. For archive sources, `id` is the instance's own date; `instances` includes every unread dated file (oldest first, so the JSX side's natural top-to-bottom column order puts oldest-unread at the top per the owner's own ordering ask) **plus** the single newest instance even if already viewed (so the source's hex never fully disappears — there's always at least one hex per source once it has ever produced anything). For running-log and tip-of-day sources, `instances` is always length 0 or 1 (no backlog concept).

### 3. JSX: uniform hex-per-instance, `fillPredicate` now means "unread"

`reportsItems(reportsData)` flattens every source's `instances` array into one flat list of hex items (`{key, kind, name, viewed, data}}`), across all 7 sources. `HexGrid`'s existing `fillPredicate` becomes `(item) => !item.viewed` — filled means "you haven't seen this," not "this source has any data." `renderReportOverlayBody` dispatches on `item.kind` (7 cases now, same pattern as today's 3) using each instance's own content fields.

### 4. Mark-as-read: click-to-shell-out, reusing the existing pattern

Opening a hex's overlay is what marks it read (one action, matches how notification-style UIs typically clear on open) — mirrors this file's own `copyPrompt`, which already shells out via Übersicht's `run()` on click. A new small script, `scripts/mark_report_viewed.py`, takes a source key and either an id or an mtime-flag, and does a safe read-modify-write of `reports_viewed.json`. `HexTile`/`HexGrid` gain one new **optional** prop (`onTileSelect`, defaulting to a no-op) fired alongside the existing `toggleHexSelection` — Skill Tray and Script Tray don't pass it, so their behavior is unchanged; Reports Tray passes a handler that shells out only when opening (not closing) a currently-unread tile.

### 5. `system-healthcheck` addition

`consistency_sweep.py` gains a write step: `system-healthcheck/reports/YYYY-MM-DD.md`, same shape/convention as `dependency-audit`'s dated reports. The stdout report stays exactly as-is for manual runs; this only adds a file alongside it. Contained to one script in a different repo (ClaudeSpace, not dashboard-visualizer) — flagged explicitly since it crosses the repo boundary this whole tray system otherwise stays inside.

### 6. Title fix

Hex face becomes a short fixed label per source (`"IANLOGGER"`, `"MORNING REPORT"`, `"DEPENDENCY AUDIT"`, `"SYSTEM HEALTHCHECK"`, `"SKILL AUDITOR"`, `"AUTOMATION SCOUT"`, `"TIP OF THE DAY"`) instead of today's full report title truncating mid-word. The real title/date moves into the overlay, next to the existing freshness text.

## Testing

Same constraints as every prior tray branch: no JS test runner, no live-GUI access in any implementation subagent's environment — `scripts/verify_widget.sh` plus a human pass at the end. The Python-side instance-enumeration and read/unread comparison logic (archive-source date comparison, running-log mtime comparison, `mark_report_viewed.py`'s read-modify-write) is real, testable logic — plain-assert test scripts, same convention as every prior task in this branch, no pytest.

## Out of scope

- Parsing individual dated entries out of `skill-auditor`/`automation-scout`'s running log files to give them real backlog support — v1 ships them as single always-current hexes (mtime-based read/unread only). A follow-up if the single-hex treatment turns out to feel wrong in practice.
- Resolving the Skill-Tray/Reports-Tray content overlap for dependency-audit/skill-auditor/automation-scout — shipping both, per the owner's explicit "tweak later."
- Any UI for manually marking something unread again, or a "mark all read" action — not asked for.
- A cap on unread backlog size — explicitly decided against (no cap).

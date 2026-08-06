# Reports Tray design

**Date:** 2026-08-06
**Status:** Approved, pending implementation plan

## Goal

Add a third pop-out tray to the `claudespace-status` widget ("Commandspace"): a Reports Tray, showing the latest `ianlogger` daily entry and the latest `usage-scheduler` overnight report (plus a dormant, forward-compatible "Recent Nuggets" panel for the `___man`-family personas, matching what already exists). This **replaces** the standalone `report-viewer` widget entirely — same information, now living in Commandspace's tray system instead of a separate floating card, per Ian's direct call ("fold report viewer into this is a better way to handle it").

This is the third tray built on the shared `Tray`/`trayColumn` abstraction from the Script Tray work (2026-08-05) — the first to prove that abstraction generalizes to non-hex-grid content, since `Tray` was deliberately built to accept arbitrary `children` rather than being hardcoded to `HexGrid`.

## Current state (context)

- `widgets/report-viewer/index.jsx` (360 lines) is a standalone Übersicht widget, positioned `bottom: 20px; left: 40px;`, refreshed every 5 minutes (`refreshFrequency = 300000`, slower than claudespace-status's 20s since reports update at most a few times a day). It reads `scripts/report_summary.py`'s JSON output and renders three stacked panels: "Today's Log," the latest usage-scheduler report (filtered to "Completed"/"Needs you" bullets, capped at 3 each with a "+N more" note), and "Recent Nuggets" (renders only when at least one `___man`-family persona has actually written a `log.md` — none do yet today, so this panel is currently always absent; dormant, forward-compatible plumbing per its own comments, not filler).
- `scripts/report_summary.py` is a separate, independently-runnable Python script (own `if __name__ == "__main__":` entry point) with three loader functions:
  - `load_latest_log(claude_space)` → `{date, text, hours_ago}` or `None` — ianlogger's latest dated entry, full body text, no bullet parsing (ianlogger writes narrative prose, not structured bullets).
  - `load_latest_usage_report(claude_space)` → `{title, sections: {heading: [bullets]}, hours_ago}` or `None` — always reads `usage-scheduler/latest-report.md` specifically (always-overwritten-with-newest, not the dated archive), splits it into `{heading: [bullet lines]}` by top-level `##`/`- ` markdown.
  - `load_persona_nuggets(claude_space)` → `[{persona, entries: [text]}]` — checks `<persona>/log.md` for each of `historyman`/`cultureman`/`learnerman`/`tutor`; skips any that don't exist yet (none do today).
  - `build_summary(claude_space)` combines all three into `{generated_at, log, report, nuggets}`.
- `claudespace-status`'s own `status_summary.py` and `report_summary.py` are currently two **separate** processes — Übersicht's `command` for each widget shells out to its own script independently, producing two separate JSON payloads. Folding the tray in means `status_summary.py` needs `report_summary.py`'s three loader functions in its own single payload.
- `claudespace-status/index.jsx` already has its own `formatHoursAgo` (bucketing: `<1h` → minutes, `<24h` → hours, else → days) used for "Last touched: X." `report-viewer/index.jsx`'s own `formatHoursAgo` is very slightly different — the hour/day cutover is `<48h` there, not `<24h`. This is a real, if small, tuned behavioral difference (not an oversight) — the ported version keeps its own `<48h` cutover under a distinct name (`formatReportHoursAgo`) rather than silently unifying with claudespace-status's existing helper or overwriting it (a `const` name collision would be a hard JS error, and unifying the two thresholds is an unrelated behavior change out of scope for this work).
- Theme colors used by the two existing trays: `STATUS_RED` (Skill Tray), `STATUS_BLUE` (Script Tray, reusing the existing "Paused"/away-icon color). Remaining theme colors: `STATUS_GREEN` ("Active" icon), `STATUS_TEAL` ("Idea" *and* "Done" icons — already double-booked), `STATUS_PURPLE` ("Backlog" icon only) — `STATUS_PURPLE` is the cleanest remaining choice: distinct from red/blue, and not already carrying two separate meanings the way teal is.

## Design

### 1. Data: fold `report_summary.py`'s loaders into `status_summary.py`

`status_summary.py` imports the three loader functions directly from `report_summary.py` (same `scripts/` folder, plain Python import — no subprocess, no duplicated logic):

```python
from report_summary import load_latest_log, load_latest_usage_report, load_persona_nuggets
```

`build_summary()`'s return dict gains three new keys:

```python
"log": load_latest_log(claude_space),
"report": load_latest_usage_report(claude_space),
"nuggets": load_persona_nuggets(claude_space),
```

`report_summary.py` itself is **not deleted** — it stays as a real, independently-runnable module (its own `__main__` entry point keeps working for anyone debugging it directly, matching this repo's existing "small deterministic scripts" convention). Only its **widget wrapper**, `widgets/report-viewer/index.jsx`, is deleted, along with whatever Übersicht symlink currently points at it (a manual step on Ian's machine — the plan will call this out explicitly rather than assume filesystem access to `~/Library/Application Support/Übersicht/widgets/` is available or safe to touch unprompted).

### 2. Tray: `Tray id="reports"`, `STATUS_PURPLE`, third in `trayColumn`

Stacks under Script Tray (`trayColumn`'s existing flex order: Skill, Script, Reports). No changes to `Tray`, `trayColumn`, or the mutual-exclusion/mini-mode-reset machinery — this tray is just a third config-driven instance of what already exists, which is the point.

**Pill:** shows hours-since-freshest, not an item count (this content isn't a catalog). Computed as `Math.min` of `log?.hours_ago` and `report?.hours_ago` (whichever exists; `null` if both are absent), formatted with the same `formatReportHoursAgo` the panels use. `Tray`'s existing `count` prop is reused for this numeric display, but the **hide-when-empty gate changes**: instead of `if (!count) return null` (which would wrongly hide a tray whose freshest report was exactly "0 hours ago"), the Reports Tray call site passes a boolean presence check (`log || report ? <realCount> : 0`) so the *only* thing that hides the tray is having neither source at all, never a coincidentally-falsy hours value. This is a call-site concern, not a change to `Tray` itself — `Tray`'s own `if (!count) return null` stays exactly as built for Skill/Script.

### 3. Content: port report-viewer's three panels as `Tray`'s children

A new `ReportsPanels` component renders the same three panels report-viewer does today — Today's Log, Latest Report (completed/needs-you bullets, same 3-item cap and "+N more" pattern), Recent Nuggets (same dormant-until-populated behavior) — reusing report-viewer's existing helper functions (`findSection`, `cleanReportTitle`, `parse_report_sections` stays server-side in Python) ported into `claudespace-status/index.jsx`. Styling follows the same pattern established for Script Tray's overlay content: shared structural classes, `STATUS_PURPLE` threaded in wherever report-viewer's version used its own accent color, so the panel visually matches the purple tray it lives in rather than carrying report-viewer's old (unthemed-to-a-specific-tray) look.

## Testing

Same constraints as the Script Tray work: no JS test runner, no live-GUI access in any implementation subagent's environment. `scripts/verify_widget.sh`'s static checks (parse cleanliness, no JSX fragments, no backtick-in-comment bugs) remain the automated gate; live-widget confirmation is a human step at the end, same as before. The Python-side loader-reuse (`status_summary.py` importing from `report_summary.py`) is real, testable logic — a plain-assert test script (same convention as `load_scripts_catalog`'s Task 1, no pytest) confirms the merged `build_summary()` payload actually contains working `log`/`report`/`nuggets` keys against a real or fixture ClaudeSpace folder.

## Out of scope

- Any change to `report_summary.py`'s own loading/parsing logic — this only changes *who calls it*, not what it does.
- Unifying `formatHoursAgo`'s two slightly different cutover thresholds across the file — kept as two distinctly-named functions, not a behavior change.
- Building out the nuggets persona format itself (still an open, unresolved decision per `protoman/README.md` and `tutor/README.md`) — the nuggets panel stays exactly as dormant/forward-compatible as report-viewer already made it.
- Actually removing the Übersicht symlink for `report-viewer` on Ian's machine — flagged as a manual step, not something the plan performs unprompted.

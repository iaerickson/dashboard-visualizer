# dashboard-visualizer ("Commandspace")

A desktop widget system for macOS that shows the state of the ClaudeSpace project tracker at a glance: project counts and lists by status, what is waiting on you, usage-reset countdowns, and three hex-grid trays for skills, scripts and reports. It runs on [Übersicht](https://tracesof.net/uebersicht/), so the widgets sit on the desktop itself rather than in a window.

**Status:** Parked. Fully working as of 2026-11-13, powered down on purpose until the workflow around it is settled and it can be refactored. Nothing here is broken; see [Turning it off and back on](#turning-it-off-and-back-on) to bring it back.
**Started:** 2026-07-30
**Full build history:** [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md) (the original README, every round of design decisions, bugs and fixes)

## What's in the repo

| Path | What it is |
| --- | --- |
| `widgets/claudespace-status/index.jsx` | The main "Commandspace" widget (the card, its sections, gauges and trays). |
| `widgets/tip-of-day/index.jsx` | A small second widget: one static tip per day, rotates at midnight. |
| `widgets/src/` | Shared modules. `paths.config.js` holds the folder paths; `theme.config.js` points at the active theme in `themes/` (currently `nerv.js`). |
| `scripts/status_summary.py` | Reads the tracker and prints the JSON the main widget renders. The widget runs this every 20 seconds. |
| `scripts/report_summary.py` | Helpers for parsing report files (used by `status_summary.py` and the Reports Tray). |
| `scripts/mark_report_viewed.py` | Called by the widget when a report hex is opened, to mark it read. |
| `scripts/lifecycle_resort.py` | Optional: moves quiet Active projects to Backlog in `INDEX.md`. Dry run unless `--apply`. |
| `scripts/verify_widget.sh` | One-command sanity check: widgets parse, `status_summary.py` runs. |
| `config/` | Small JSON files the widget reads (and a few it writes). See [Config files](#config-files). |
| `tests/` | `unittest` suite for the two summary scripts. |
| `docs/` | Build log, plus the design specs and plans for the Script Tray and Reports Tray. |

## Requirements

- macOS with [Übersicht](https://tracesof.net/uebersicht/) installed (free, open source).
- Python 3 (ships with macOS). Standard library only, nothing to `pip install`.
- A ClaudeSpace tracker folder containing `INDEX.md` and `NEEDS-IAN.md`.

The widget never calls an LLM or any network service. It only reads local files.

## Install (one time)

Übersicht loads widgets from `~/Library/Application Support/Übersicht/widgets/`. Link this repo's three widget folders into it so there is only ever one copy of the code:

```bash
REPO="$HOME/Desktop/Projects/dashboard-visualizer/widgets"
UB="$HOME/Library/Application Support/Übersicht/widgets"
ln -s "$REPO/claudespace-status" "$UB/claudespace-status"
ln -s "$REPO/tip-of-day"         "$UB/tip-of-day"
ln -s "$REPO/src"                "$UB/src"
```

Notes:

- Use `ln -s` in Terminal, not a Finder alias. Übersicht does not follow Finder aliases.
- `src` has to sit next to the two widget folders because both widgets import `../src/theme.config`. Übersicht ignores folders named `src`, so it will not show up as a widget.
- If a folder with the same name already exists in Übersicht's widgets folder, remove it first, otherwise `ln -s` nests the link inside it.
- Do not drag the folders in with Finder. A plain drag on the same disk moves them out of the repo.

Then turn on clicking (hover works without this, clicks do not):

1. Übersicht menu bar icon → Preferences → tick **Enable interaction**.
2. System Settings → Privacy & Security → Accessibility → allow Übersicht.

### Pointing it at your folders

All widget paths live in one file, `widgets/src/paths.config.js`:

- `REPO_DIR`: where this repo is checked out (default `$HOME/Desktop/Projects/dashboard-visualizer`).
- `CLAUDE_SPACE_DIR`: the tracker folder (default `$HOME/Desktop/ClaudeSpace`).

If your layout differs, edit those two values (absolute paths work too), update the symlinks above to match, then quit and reopen Übersicht. The Python scripts take the tracker path as their first argument and fall back to `~/Desktop/ClaudeSpace`.

## Using it

**Tiny and big mode.** The card rests as a compact strip: the title plus a count pill for each status that has anything in it. Hover the card, or click the title, to expand it. It collapses about 12 seconds after the pointer leaves, or immediately on a second click of the title.

**Gauges (top of the expanded card).** Three depleting bars:

- *Last Break*: time since your last break. When it is overdue, click it to reset. It pauses on its own when you are away from the machine.
- *Session*: an estimate of the rolling ~5 hour Claude session window, restarted automatically when tracker activity is seen after the previous window ran out. It is an estimate; Settings → Usage in Claude is the real number.
- *Weekly usage*: countdown to the fixed weekly reset set in `config/usage_resets.json`.

**Sections.** Daily Goals, Active, Idea, Paused, Backlog, Done, Dormant, Bin, and Needs Attention. Each shows its header and count; hover a section to open its list, and hover a row to open that project's detail (summary, last completed item, next steps, time estimate). Statuses come from the emoji on each project's line in `INDEX.md`; the detail comes from that project's own README checklist. Dormant is a flag, not a status (30+ days with no README activity). Bin lists what `_bin/BIN.md` records. Needs Attention lists the open items in `NEEDS-IAN.md`, grouped by project.

**Click to copy.** Clicking a next step, an idea, a paused project or a Needs Attention item copies a ready-made prompt to the clipboard and flashes the row. Paste it into a Claude session. (It used to open Claude directly; that was turned off because Claude's folder-trust dialog wipes the prefilled text.)

**Trays (the tabs on the side of the expanded card).** Each opens into a hex grid; click a hex for its detail overlay.

- *Skill Tray*: every skill found in the tracker, with run counts from `skills-usage-log.json`.
- *Script Tray*: every `scripts/*.py` and `scripts/*.sh` in the tracker and in this repo.
- *Reports Tray*: archived reports from `usage-scheduler/reports/`. Unread ones are highlighted; opening one marks it read.

**Everything updates itself.** The widget re-reads the tracker files every 20 seconds, so any edit to `INDEX.md`, `NEEDS-IAN.md` or a project README shows up without doing anything.

## Config files

| File | Purpose | Who writes it |
| --- | --- | --- |
| `usage_resets.json` | Weekly usage reset day and time. | You, by hand. Tracked in git. |
| `project_catalog.json` | Cached time estimate per project, shown in row detail. | A Claude session, on request. Tracked in git. |
| `session_reset.json` | Anchor for the Session gauge. | `status_summary.py`, automatically. |
| `last_break.json` | Anchor for the Last Break gauge. | The widget (on click) and `status_summary.py`. |
| `reports_viewed.json` | Which reports have been opened. | `mark_report_viewed.py`. |
| `daily_goal.json` | Contents of the Daily Goals section. | Nothing, any more. See below. |
| `scheduled_tasks_snapshot.json` | Last-run times of scheduled tasks, used as an activity signal. | Nothing, any more. See below. |

The last five are live state, not settings, and are listed in `.gitignore` so git operations never overwrite them. On a fresh clone they will not exist; the widget handles a missing file by leaving that part blank.

## Checks

```bash
cd ~/Desktop/Projects/dashboard-visualizer
python3 -m unittest discover -s tests          # 34 tests, a few milliseconds
scripts/verify_widget.sh                       # widgets parse + status_summary.py runs
python3 scripts/status_summary.py ~/Desktop/ClaudeSpace | python3 -m json.tool | head -40
```

`verify_widget.sh` does a real JSX parse if it can find `@babel/parser` (set `VERIFY_JSX_PARSER_DIR` to a folder whose `node_modules` has it); otherwise it falls back to a basic balance check.

If the widget goes blank on the desktop, the error is in Übersicht's own debug console (opened from its menu bar icon), not on screen.

## Changing the look

Colors and font live in `widgets/src/themes/nerv.js`. To add a look, copy that file to a new name in the same folder (every key must be present), point the one import line in `widgets/src/theme.config.js` at it, then quit and reopen Übersicht. Icon shapes are not themed.

## Turning it off and back on

To power down without uninstalling anything:

- Hide the widgets: Übersicht menu bar icon → `claudespace-status` → Hide (same for `tip-of-day`), or
- Quit Übersicht entirely, and untick "Launch Übersicht when I login" in its Preferences so it stays off.

Neither touches this repo or the symlinks. To bring it back, open Übersicht and unhide the widgets. If it was never installed on the machine, follow [Install](#install-one-time).

## Things to know before editing

Übersicht's environment has a few traps that each cost a debugging session during the build:

- Do not use the `<>...</>` fragment shorthand. There is no global `React`; use a real `<div>` or `<span>`.
- `uebersicht` exports `css`, `styled` and `run`, but not `keyframes`. Write `@keyframes` blocks inline inside a `css` template.
- No React hooks. State that must survive a refresh lives in module-level variables, and the widget re-renders every 20 seconds whether or not anything changed.
- Any top-level `.js`/`.jsx` file in a widget folder is treated as its own widget unless it is inside a folder named `src`, `lib` or `node_modules`.
- After a confusing error that does not match the code, quit and reopen Übersicht. Its bundler caches builds.
- Widgets cannot float above other app windows. That is a hard limit of Übersicht.

## State when it was parked (2026-11-13)

- The self-tracking skills that used to feed parts of the widget were retired (see `ClaudeSpace/_bin/BIN.md`). As a result **Daily Goals will show its last goal from 2026-10-09 indefinitely**, since nothing writes `config/daily_goal.json` any more, and `config/scheduled_tasks_snapshot.json` is a hand-written snapshot that no longer refreshes. Both are safe to leave; edit them by hand if wanted.
- `scripts/lifecycle_resort.py` was run by that same retired automation. Nothing runs it now. It still works by hand.
- The `ianlogger` and `dependency_audit` report sources were removed from the Reports Tray; `usage_scheduler` is the only source left.
- Hardcoded personal paths remain throughout (see [Paths baked into the code](#paths-baked-into-the-code)). Making this usable by someone else would need those moved into config first.

## Sub-projects

- [x] Phases 0 to 3: platform choice, main status widget, NERV-style theme, tip-of-day widget, Skill/Script/Reports trays, Daily Goals. Detail in `docs/BUILD-LOG.md`.
- [ ] Refactor around the new workflow before turning it back on (decide what the widget should track now that the nightly automation is gone)
- [ ] Remove or rework the Daily Goals section, which has no data source any more
- [ ] Split `widgets/claudespace-status/index.jsx` (about 4,000 lines, mostly history comments) into smaller modules under `src/`
- [ ] Move hardcoded paths into one config file
- [ ] Ideas carried over, not scoped: a tray for scheduled tasks, and a "Project Focus Mode" that shows one project's own breakdown

## Notes

- 2026-11-13: README rewritten as a usage guide and the previous README moved to `docs/BUILD-LOG.md`. Project parked pending a refactor, per the owner: happy with where it got to, but powering it down until the workflow it serves is settled.

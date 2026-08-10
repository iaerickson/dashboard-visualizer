# wellbeing-check: escalating breaks + active mental engagement

**Date:** 2026-08-10
**Repo/branch:** `dashboard-visualizer`, `feature/wellbeing-check-escalating-breaks`
**Source project:** `ClaudeSpace/wellbeing-check/README.md` (design decisions + research already recorded there — this doc is the buildable spec for the two still-unbuilt sub-projects: the escalating break system and active mental engagement)

## Goal

Two independent features, both surfaced through the existing `claudespace-status` Übersicht widget:

1. **Escalating break-reminder system** — three stages of increasing urgency when Ian has been actively using Claude too long without a break: (1) a gentle, dismissible suggestion in the widget, (2) a 10-minute wrap-up warning via native macOS notification, (3) a persistent, hard-to-dismiss (but honestly not-a-real-lock) repeating prompt to physically step away.
2. **Active mental engagement** — occasional brain-teasers/questions surfaced in the widget, unrelated to the break system, meant to counter cognitive offloading during long sessions by deliberately making Ian think rather than just removing friction.

Neither feature spends money, calls a metered API, or touches secrets. Both are pure local/free primitives (Python stdlib, `ioreg`, `osascript`), consistent with `PROCESS.md`'s Ground Rules.

## Non-goals

- Not a real lock or enforcement mechanism — the system cannot and must not claim to block the computer or Claude access. All UI/notification copy must be honest about this.
- Not modifying `historyman`/`cultureman`/`learnerman` themselves — this consumes their logs if/when they have entries; it does not change how those habits get triggered or written to.
- Not building a generic "usage tracker" — this reuses the existing idle-detection primitive already built for `load_personal_health`, not a new telemetry system.

## Part 1 — Escalating break-reminder system

### Builds on existing code, does not replace it

`scripts/status_summary.py` already has `load_personal_health()` — reads `config/last_break.json` (`last_break_at`, `away_since`), computes a 60-minute countdown, freezes/auto-resets on genuine away-time (via `get_system_idle_seconds()` / `AWAY_IDLE_THRESHOLD_MINUTES = 5`), and the widget already renders this as a gauge with click-to-mark-taken (locked to overdue-only). This spec extends that function and its config file; it does not introduce a parallel timer.

### New signal: Claude-activity accumulation

```python
CLAUDE_APP_NAMES = {"Claude", "Claude Code", "Cowork"}  # NEEDS IAN'S CONFIRMATION — see Open Questions
CLAUDE_ACTIVE_THRESHOLD_MINUTES = 60   # primary trigger
WALL_CLOCK_FLOOR_MINUTES = 90          # fallback trigger if activity detection misses

def get_frontmost_app_name() -> str | None:
    """osascript: name of the frontmost application process, via System
    Events. Same lightweight-subprocess/timeout pattern as
    get_system_idle_seconds(); returns None on any failure so callers
    degrade to 'unknown' rather than guessing."""
```

Each poll (every 20s, matching the widget's existing `refreshFrequency`), `load_personal_health` samples:

```
is_claude_active_now = (frontmost app in CLAUDE_APP_NAMES) and (idle_seconds < AWAY_IDLE_THRESHOLD_MINUTES * 60)
```

If true, add the elapsed seconds since the last poll to a new accumulator field, `claude_active_seconds`, in `last_break.json`. This accumulator resets to 0 whenever a break is actually taken (manual click or away-triggered auto-reset — the same two events that already reset `last_break_at` today).

Stage 1 triggers when **either**:
- `claude_active_seconds >= CLAUDE_ACTIVE_THRESHOLD_MINUTES * 60` (primary — matches Ian's own description that it's continuous *Claude* use specifically that drains him), **or**
- wall-clock minutes since `last_break_at >= WALL_CLOCK_FLOOR_MINUTES` (floor — fires regardless, in case the app-name allow-list ever misses a real Claude session)

### Escalation state machine — one clock, not three

New fields in `last_break.json`:

```json
{
  "last_break_at": "...",
  "away_since": null,
  "claude_active_seconds": 0,
  "stage": 0,
  "stage1_started_at": null,
  "stage2_fired_at": null,
  "stage3_last_fired_at": null
}
```

- **Stage 0 → 1:** the moment either trigger condition above is met, set `stage = 1`, `stage1_started_at = now`. Widget shows a dismissible "time for a break?" row next to the existing gauge.
- **Stage 1 → 2:** 10 minutes after `stage1_started_at`, if no break has been taken, set `stage = 2`, `stage2_fired_at = now`, and fire one passive `osascript -e 'display notification ...'` banner. Dismissing the stage-1 widget row is **UI-only** (local React state, not persisted) — it does not delay or prevent this transition. This is the deliberate honest version of "if I swipe away I still get warned."
- **Stage 2 → 3:** on the next poll after stage 2 fires, if no break has been taken yet, set `stage = 3` and begin the repeating-modal loop below. No extra delay is inserted here — the 10-minute wrap-up warning in stage 2 already was the buffer.
- **Stage 3 repeat:** every 5 minutes (`STAGE3_REPEAT_MINUTES`) while `stage == 3` and Ian is not already away, fire:
  ```
  osascript -e 'display dialog "..." buttons {"OK"} default button 1 with title "..." giving up after 20'
  ```
  `giving up after 20` guarantees this can never hang the polling script if nobody's there to click it. Clicking OK does **not** reset the clock — the dialog will reappear in another 5 minutes. Only a genuine break (manual click, or the existing away-detector tripping) resets `stage` to 0 and clears `claude_active_seconds`.

This reuses the exact same "what counts as a break" signal the gauge already uses today — no new definition of "break taken" is introduced.

### Widget changes

- Extend the existing Personal Health block (`index.jsx`, around the `personal_health` rendering) with a `stage >= 1` conditional row: brief text + an X to dismiss locally. No new backend endpoint — `stage`/`claude_active_seconds` ride along in the same JSON `status_summary.py` already emits.
- No changes to the existing gauge visuals/away-icon behavior.

### Copy, honestly framed

Stage 1: *"You've been in Claude a while — worth a short break?"*
Stage 2 notification: *"10-minute heads up: wrap up soon and step away."*
Stage 3 dialog: *"Still going. This isn't going to lock anything — but seriously, step away from the computer for a bit: a walk, something non-computer, real physical movement."* — repeats every 5 min until a real break is logged.

## Part 2 — Active mental engagement

Deliberately **not** wired to the break system's state — independent config, independent timer, so neither feature can break the other.

### Content

New static file, `config/engagement_prompts.json` — a starter bank (~15-20 hand-written entries at build time) spanning a few light categories (logic/brain-teaser, "do this step by hand" cognitive-offloading countermeasures, general culture/science/history questions), each shaped like:

```json
{ "id": "...", "category": "logic", "prompt": "..." }
```

At read time, the rotation also pulls from `historyman/log.md`, `cultureman/log.md`, `learnerman/log.md` (ClaudeSpace root, sibling to this repo) whenever they contain real entries, parsed per `protoman`'s shared `{summary, tags, source}` line format and folded in as additional prompt candidates tagged with their originating persona. Empty/missing log files are silently skipped — this must not error or show placeholder content when a log is empty, per `PROCESS.md`'s "no filler content" convention already established for `report-viewer`'s Recent Nuggets panel.

### Cadence

New config file, `config/mental_engagement.json`:

```json
{ "claude_active_seconds": 0, "last_shown_at": null, "current_prompt_id": null }
```

Reuses the same `is_claude_active_now` sampling as Part 1 (same `get_frontmost_app_name()` / idle check — one shared helper, two independent accumulators) but its own 20s-sampled counter. Every `ENGAGEMENT_INTERVAL_MINUTES = 45` of accumulated Claude-active time, rotate in a new random prompt (weighted so log-sourced entries and the starter bank both have a real chance of appearing once logs have content) and reset the counter.

### Widget changes

New collapsible section in the widget, same pattern as Active/Idea/Paused/Done (`Section`-style component): header `[ mental engagement ]`, collapsed until hovered. Shows the current prompt; clicking it requests a new one (pure "skip," not an answer-check — this is meant to prompt genuine thinking, not gamify it). No native notification for this feature — it's meant to be glanceable, not intrusive, per Ian's explicit "not another break nudge."

## Testing approach

Per `PROCESS.md`'s Code Standards, all real logic gets real tests, `unittest`, stdlib-only, matching `tests/test_status_summary.py`'s existing convention:

- `is_claude_active_now(frontmost_name, idle_seconds)` — pure function, fully testable (in/out of allow-list × above/below idle threshold).
- Stage transition logic — pure function taking `(now, stage, stage1_started_at, stage2_fired_at, stage3_last_fired_at, claude_active_seconds, wall_clock_minutes)` and returning the next state — testable without touching the filesystem or shelling out, same shape as the existing `load_personal_health` tests would need if they existed (there currently are none for that function either — worth adding basic coverage for the extended version as part of this work, not just the new pieces).
- Engagement rotation/threshold logic and the log-parsing function — testable against fixture strings, same pattern as `tests/test_status_summary.py`'s `needs_ian_doc()` helper.
- `get_frontmost_app_name()` and the two `osascript` side-effecting calls (notification, dialog) are thin wrappers around `subprocess.run` — not meaningfully unit-testable (they talk to the real OS). These get a short manual smoke-test note in the README instead, and the code keeps them isolated (single-purpose functions) so the untested surface area is as small as possible.

**Required manual verification before calling this done** (cannot be confirmed from here): the actual frontmost-app name(s) match `CLAUDE_APP_NAMES`, the notification and dialog actually appear on Ian's Mac, and neither blocks the widget's poll loop longer than expected.

## Open questions for Ian

- **Confirm `CLAUDE_APP_NAMES`.** What does the menu bar actually show as the active app name when Claude is what you're using — `Claude`? `Claude Code`? Something else? The primary break-trigger signal silently never fires if this list is wrong.
- **`STAGE3_REPEAT_MINUTES = 5`** and **`ENGAGEMENT_INTERVAL_MINUTES = 45`** are my own reasonable-default guesses, not something you specified — flagging both as easy-to-tune constants, not settled numbers.

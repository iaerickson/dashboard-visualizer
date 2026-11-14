# Script Tray design

**Date:** 2026-08-05
**Status:** Approved, pending implementation plan

## Goal

Add a second pop-out tray to the `claudespace-status` widget ("Commandspace"), alongside the existing Skill Tray, that lists scripts generated/in use across the tracker. Styled identically to the Skill Tray (same pop-out shell, hex-grid content, animations, layout) but themed blue instead of red, and pops out directly under the Skill Tray when expanded.

This also generalizes the Skill Tray's current tray-specific state and markup into a shared, config-driven shape so a third future tray doesn't require copy-pasting structure again.

## Current state (context)

- Widget lives at `widgets/claudespace-status/index.jsx` in this repo (dashboard-visualizer), a plain-JS/JSX Übersicht widget with **no React hooks available** — all interactive state is module-level JS variables that directly toggle DOM `classList`, baked into `className` on every render pass (see `cardExpanded`, `setExpanded`, `armCollapse`/`disarmCollapse`).
- The Skill Tray (`SkillsTab`) is a permanent DOM child of `cardOuter` (sibling of `cardInner`), never conditionally mounted, so its CSS transition rides the same `.is-expanded` class/timing as the rest of "big mode." It is NOT built as a generic component — it's a bespoke set of styles/components (`skillsTrayBox`, `skillsTabCount`, `SkillHex`, `SkillHexGrid`, etc.) hard-coded to `STATUS_RED`.
- Tray open/closed state: `let skillsTrayOpen = false` (module-level), toggled by `toggleSkillsTray`, applied via `.is-open` class on `.skills-tray-wrap`. Reset to closed on mini-mode collapse via `resetSkillsTray`, called from `setExpanded(el, false)`.
- Per-hex selection (click to show an info overlay) is a separate piece of state: `.skill-hex-cell.is-active`, set by `toggleSkillHex`, cleared by `resetSkillHexSelection`.
- Skill data comes from `scripts/status_summary.py`'s `load_skills_catalog(claude_space)`, which globs `claude_space.glob("*/SKILL.md")`, parses frontmatter (`name`, `description`), and merges in usage-log call counts (`manual_count`/`auto_count`) and `calls`/`called_by` relationships. `build_summary` returns this as `"skills"`, which `render(state)` destructures directly from the fetched JSON and passes to `<SkillsTab skills={skills} />`.
- Theme colors live in `widgets/src/themes/nerv.js`; `STATUS_BLUE` (`#7fb8d9`) already exists there, currently used only for the "Paused" project-status icon and the away/sleep icon — no conflicting semantic meaning, safe to reuse as the Script Tray's accent.
- There is **no existing catalog or metadata convention for scripts** (unlike skills' `SKILL.md` frontmatter) — no usage log, no call counts. Real generated scripts today are plain files: `dependency-audit/scripts/housekeeping.sh`, `system-healthcheck/scripts/consistency_sweep.py`, `log-rollup/scripts/rollup.py` (ClaudeSpace repo), plus this repo's own `scripts/status_summary.py`, `scripts/lifecycle_resort.py`, `scripts/report_summary.py`, `scripts/verify_widget.sh`.

## Scope decisions (confirmed with the owner)

1. **Script source scope:** scan both the ClaudeSpace tracker's `*/scripts/*.{py,sh}` AND this repo's (dashboard-visualizer) own `scripts/*.{py,sh}` — not ClaudeSpace-only.
2. **Content presentation:** same hex-grid visualization as the Skill Tray (not a plain list), re-themed blue. Since scripts have no usage-count data, every script hex renders in the **filled** state (existence is the only true signal available — no fabricated "used/unused" distinction).

## Design

### 1. Generalized tray state (replaces tray-specific booleans)

```js
let activeTrayId = null // was: let skillsTrayOpen = false

const toggleTray = (trayId, e) => {
  e.stopPropagation()
  const wrapEl = e.currentTarget.closest(".tray-wrap")
  if (!wrapEl) return
  const opening = activeTrayId !== trayId
  // Close whichever other tray is open first (mutual exclusivity)
  if (activeTrayId && activeTrayId !== trayId) {
    closeTrayById(activeTrayId, wrapEl.parentElement)
  }
  wrapEl.classList.toggle("is-open", opening)
  resetHexSelection(wrapEl) // clears stale selection when closing
  activeTrayId = opening ? trayId : null
}

const closeTrayById = (trayId, containerEl) => {
  const el = containerEl?.querySelector(`.tray-wrap[data-tray-id="${trayId}"]`)
  if (!el) return
  el.classList.remove("is-open")
  resetHexSelection(el)
}

const resetAllTrays = (cardEl) => {
  // Replaces resetSkillsTray - called from setExpanded(el, false)
  if (!cardEl) return
  cardEl.querySelectorAll(".tray-wrap").forEach((el) => {
    el.classList.remove("is-open")
    resetHexSelection(el)
  })
  activeTrayId = null
}
```

`resetHexSelection`/hex-click-selection logic is unchanged in spirit from today's `toggleSkillHex`/`resetSkillHexSelection`, just generalized to operate on whichever `.tray-wrap` it's called with instead of assuming `.skills-tray-wrap`.

This satisfies both explicit behavioral requirements structurally:
- **Expanding one tray auto-collapses any other** — `toggleTray` always closes the other tray before opening the requested one.
- **A collapsed tray can only be expanded when no other is active** — trivially true given the above; there is never a moment with two open.
- **Mini mode resets all trays** — `resetAllTrays(el)` is called from `setExpanded(el, false)` (the existing mini-mode-collapse path), covering every tray, not just skills.

### 2. Shared `Tray` shell + generic `HexGrid`/`HexTile`

New shared pieces (replacing the skill-specific `skillsTrayBox`/`SkillsTab`/`SkillHexGrid`/`SkillHex`):

- **`trayBoxStyles(accentColor)`** — factory returning the Emotion `css` block that is today's `skillsTrayBox`, with `STATUS_RED`/`RED_LINE` replaced by the passed `accentColor` and a derived line-tint (`color-mix(in srgb, ${accentColor} 35%, transparent)`). Same for the hazard-stripe `::before` background and `skillsTabCount`.
- **`Tray({ id, accentColor, label, count, children })`** — renders the box (`data-tray-id={id}`, class `tray-wrap`), handle zone (`onClick={(e) => toggleTray(id, e)}`), and the `tray-list`/list-grid wrapper around `children`. Replaces `SkillsTab`.
- **`HexTile({ item, accentColor, filled, renderOverlayBody })`** — replaces `SkillHex`; same outline/fill/triangle/label markup, colors parameterized, overlay body content supplied by the caller instead of hard-coded skill fields.
- **`HexGrid({ items, accentColor, fillPredicate, renderOverlayBody })`** — replaces `SkillHexGrid`; same `chunkSkillsIntoColumns`-style column-chunking (generalized to `chunkIntoColumns`), same fixed 3-column layout and sizing constants (shared, not duplicated).

Per-tray usage becomes two thin call sites:

```jsx
<Tray id="skills" accentColor={STATUS_RED} label="SKILL TRAY" count={skills.length}>
  <HexGrid
    items={skills}
    accentColor={STATUS_RED}
    fillPredicate={(s) => s.call_count > 0}
    renderOverlayBody={renderSkillOverlay}
  />
</Tray>

<Tray id="scripts" accentColor={STATUS_BLUE} label="SCRIPT TRAY" count={scripts.length}>
  <HexGrid
    items={scripts}
    accentColor={STATUS_BLUE}
    fillPredicate={() => true}
    renderOverlayBody={renderScriptOverlay}
  />
</Tray>
```

`renderSkillOverlay`/`renderScriptOverlay` are the existing per-skill overlay JSX (summary/used/called-by/calls/updated) and a new script equivalent (name/project/path/last-updated/description) respectively — kept separate since the two data shapes are genuinely different, only the shell and hex mechanics are shared.

### 3. Layout — stacked column, not independent absolute positioning

Both `<Tray>` elements render inside one wrapper:

```jsx
<div className={trayColumn}>
  <Tray id="skills" ... />
  <Tray id="scripts" ... />
</div>
```

`trayColumn` is `position: absolute; top: 0; left: 0; display: flex; flex-direction: column; gap: 8px;` (8px matching this file's other small-gap conventions, e.g. `skillsTrayHandleZone`'s own `gap: 4px` doubled for tray-to-tray spacing) and is the thing that's the permanent sibling of `cardInner` inside `cardOuter` (replacing `SkillsTab`'s current direct placement). Each individual `Tray` no longer sets its own `position: absolute; top: 0` — it participates in the column's normal flex flow. This makes "pops out directly under the Skill Tray" automatic and correct regardless of either tray's collapsed/expanded height, with no measurement/ResizeObserver needed (consistent with this file's established preference for simple, non-measured positioning — see the Skill Tray's own history of dropping a ResizeObserver for exactly this reason).

Visibility/enter-exit animation is unchanged in mechanism: still driven purely by the ancestor `.is-expanded` class on `cardOuter`, same transition timing as today.

### 4. Script data source (`scripts/status_summary.py`)

New function, mirroring `load_skills_catalog`'s shape and glob-based approach:

```python
def load_scripts_catalog(claude_space: Path, dashboard_visualizer_dir: Path) -> list:
    """
    Scans */scripts/*.py and */scripts/*.sh under claude_space, plus
    dashboard_visualizer_dir's own scripts/*.py and scripts/*.sh.
    No frontmatter/usage-log convention exists for scripts (unlike SKILL.md),
    so this returns only what can be honestly read off the filesystem.
    """
```

Per script, returns:
- `name` — filename without extension
- `project` — parent project folder name (e.g. `dependency-audit`, or `dashboard-visualizer` for its own scripts)
- `path` — relative path for display
- `updated_hours_ago` — mtime-based, same bucketing helper pattern as `formatSkillUpdated`
- `description` — best-effort: first leading `#` (or `"""`) comment line if present, else empty string

No `call_count`/`manual_count`/`auto_count`/`calls`/`called_by` fields — those require the skills-usage-log.json convention, which has no script equivalent today. This is a deliberate scope boundary, not a placeholder for "later."

`dashboard_visualizer_dir` is this repo's own root; the function globs `(dashboard_visualizer_dir / "scripts").glob("*.py")` / `"*.sh"` for its own scripts, alongside `claude_space.glob("*/scripts/*.py")` / `"*.sh"` for every other project's.

Wired into `build_summary`:
```python
"scripts": load_scripts_catalog(claude_space, script_dir.parent),
```
(`script_dir` is already passed into `build_summary` today as this file's own containing directory — its parent is the repo root, giving `load_scripts_catalog` access to this repo's `scripts/` folder without a new argument.)

`render(state)` destructures `scripts` alongside the existing `skills` destructure and passes it into the `scripts` `<Tray>` above.

### 5. Overlay content per script hex

Clicking a script hex shows (mirroring the skill overlay's layout — the equivalent of today's `skillOverlaySection`/`skillOverlayLabel`, generalized to take `accentColor` the same way the rest of the tile does):
- Script name (bold, larger, like the skill overlay's name line)
- **Project** — the source project folder
- **Path** — relative path
- **Description** — only if a leading comment was found
- **Last updated** — mtime-based recency string

No "Used"/"Called by"/"Calls" sections — those represent skill-specific relationship/telemetry data that has no script equivalent.

## Testing

- `scripts/verify_widget.sh` (existing live-parity checker for the hex-tiling constants) gets a companion check, or an extended check, confirming the generalized `chunkIntoColumns`/hex sizing math still respects `SKILLS_TRAY_HEX_ROW_MAX_WIDTH` for both trays — this constant is shared, so one check covers both as long as both use the same `HEX_W`/`SKILL_HEX_COLUMNS`.
- Manual verification in Übersicht (per this repo's existing "reload and look at it live" pattern — no automated UI test harness exists for this widget): expand/collapse both trays independently, confirm mutual exclusivity, confirm mini-mode collapse resets both, confirm Script Tray always renders directly under Skill Tray regardless of skill count.

## Out of scope

- A metadata/frontmatter convention for scripts (that's `script-creator`'s own open decision per its README — not something this tray should invent unilaterally).
- Any real "used" telemetry for scripts (would require a script-side usage-log convention that doesn't exist).
- Changing the Skill Tray's own visual design — this only extracts its existing shell/hex logic into shared, parameterized pieces; the rendered result for the Skill Tray itself should be pixel-identical to today.

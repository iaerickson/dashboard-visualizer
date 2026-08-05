# Script Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second pop-out tray ("Script Tray") to the `claudespace-status` widget, styled identically to the existing Skill Tray but blue-themed, listing generated scripts across ClaudeSpace and this repo — while generalizing the Skill Tray's own bespoke shell/state into shared, config-driven components so a third future tray is a config entry, not new markup.

**Architecture:** One module-level `activeTrayId` (+ `toggleTray`/`resetAllTrays`) replaces the tray-specific `skillsTrayOpen` boolean, guaranteeing mutual exclusivity and a mini-mode reset that covers every tray, not just skills. A generic `Tray` shell component and generic `HexGrid`/`HexTile` components (both parameterized by `accentColor` and a `renderOverlayBody` render-prop) replace the skill-specific `SkillsTab`/`SkillHexGrid`/`SkillHex`. Both trays render inside one `trayColumn` flex wrapper so the Script Tray stacks under the Skill Tray automatically, with no pixel measurement.

**Tech Stack:** Plain JSX (Babel, no bundler) + Emotion `css` via the `uebersicht` package, Python 3 (no third-party deps) for the data source, both already established in this repo. No test framework exists in either language here — see Testing Approach below.

## Global Constraints

- No JSX fragment shorthand (`<>...</>`) anywhere — known to crash this Übersicht environment at render time (missing `React` global). Use a plain wrapper `<div>` instead. Enforced by `scripts/verify_widget.sh` check 1.5.
- No literal backtick characters inside `/* ... */` comments that live inside a `css\`...\`` template literal — breaks template-literal parsing. Enforced by `scripts/verify_widget.sh` check 1.6.
- Do not rename `SKILLS_TRAY_HEX_ROW_MAX_WIDTH`, `HEX_W`, or `SKILL_HEX_COLUMNS` — `scripts/verify_widget.sh` check 1.7 reads these three by exact name via regex from `widgets/claudespace-status/index.jsx` and silently *skips* (not fails) if any is missing/renamed.
- Skill Tray's rendered output (layout, animation, colors, data shown) must be pixel-identical to today after every task except where this plan explicitly changes it (there are no intended Skill Tray visual changes — only internal restructuring).
- Run `bash scripts/verify_widget.sh` after every JS task in this plan (from the repo root; it defaults to `~/Desktop/ClaudeSpace` if no path is passed) and confirm `== all checks passed ==`.
- This repo has no JS test runner and no Python test framework (no `package.json`, no `pytest`) — see Testing Approach below for what "test" means per task.

---

## Testing Approach (read before Task 1)

- **Python** (`status_summary.py`): real TDD via plain `assert` statements run directly with `python3` (this repo has never used `pytest`; don't introduce it for one function). Each Python task step below gives the exact command to run and its expected output.
- **JSX** (`index.jsx`): no unit-test runner exists for this widget (plain JSX, no bundler, no jsdom). "Test cycle" here means: (1) `scripts/verify_widget.sh` — real, automated, already-enforced static checks (parses cleanly, no fragments, no bad backticks, hex-row-width invariant, `status_summary.py` runs clean) — and (2) manual live verification against the actual desktop widget, which is this repo's own established verification method (the symlink setup makes the widget live-reload on save; see README "Quick way to confirm it worked"). Each JS task step gives the exact manual checklist to run against the live widget.

---

### Task 1: Script data source (`load_scripts_catalog`)

**Files:**
- Modify: `scripts/status_summary.py:1240` (insert new function after `SKILL_DESC_HARD_SAFETY_CAP`, before `load_skills_catalog`)
- Modify: `scripts/status_summary.py:1485` (add `"scripts"` key to `build_summary`'s return dict)

**Interfaces:**
- Produces: `load_scripts_catalog(claude_space: Path, dashboard_visualizer_dir: Path) -> list[dict]`, each dict shaped `{"name": str, "project": str, "path": str, "description": str, "updated_hours_ago": float | None}`.
- Produces: `_script_description(text: str) -> str` (private helper, used only by `load_scripts_catalog`).

- [ ] **Step 1: Write the failing test covering both `_script_description` and `load_scripts_catalog`**

Save this as `/tmp/test_load_scripts_catalog.py` (not committed — this repo has no test directory convention to add it to; see Testing Approach above):

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, "scripts")
from status_summary import _script_description, load_scripts_catalog

# _script_description
assert _script_description("#!/usr/bin/env bash\n# Cleans up dependency-audit findings\nset -e") == "Cleans up dependency-audit findings"
assert _script_description("import sys\nprint(1)") == ""
assert _script_description('"""One-line docstring summary."""\nimport os') == "One-line docstring summary."
assert _script_description("#!/usr/bin/env python3\n\n# Second real line after a blank\nimport os") == "Second real line after a blank"

# load_scripts_catalog
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    claude_space = tmp / "ClaudeSpace"
    dashboard_visualizer = tmp / "dashboard-visualizer"
    (claude_space / "project-a" / "scripts").mkdir(parents=True)
    (claude_space / "project-a" / "scripts" / "foo.py").write_text("#!/usr/bin/env python3\n# Does foo things\nprint(1)\n")
    (claude_space / "project-b" / "scripts").mkdir(parents=True)
    (claude_space / "project-b" / "scripts" / "bar.sh").write_text("#!/usr/bin/env bash\necho bar\n")
    (dashboard_visualizer / "scripts").mkdir(parents=True)
    (dashboard_visualizer / "scripts" / "baz.py").write_text("# Its own script\nprint(2)\n")

    result = load_scripts_catalog(claude_space, dashboard_visualizer)
    names = [s["name"] for s in result]
    # sorted by (project, name): "dashboard-visualizer" < "project-a" < "project-b"
    assert names == ["baz", "foo", "bar"], names
    by_name = {s["name"]: s for s in result}
    assert by_name["foo"]["project"] == "project-a"
    assert by_name["foo"]["path"] == "project-a/scripts/foo.py"
    assert by_name["foo"]["description"] == "Does foo things"
    assert by_name["bar"]["project"] == "project-b"
    assert by_name["bar"]["description"] == ""
    assert by_name["baz"]["project"] == "dashboard-visualizer"
    assert by_name["baz"]["description"] == "Its own script"
    assert all(isinstance(s["updated_hours_ago"], float) for s in result)

print("OK")
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
python3 /tmp/test_load_scripts_catalog.py
```

Expected: `ImportError: cannot import name '_script_description' from 'status_summary'` (neither function exists yet).

- [ ] **Step 3: Implement `_script_description` and `load_scripts_catalog`**

Insert into `scripts/status_summary.py` immediately after the `SKILL_DESC_HARD_SAFETY_CAP = 4000` line (currently line 1240) and before `def load_skills_catalog`:

```python
def _script_description(text: str) -> str:
    """Best-effort one-line description for a script that has no
    frontmatter convention (unlike SKILL.md) - the first real comment/
    docstring line, skipping a leading shebang and blank lines. Returns
    "" if no such line is found within the first few lines (honest empty
    state, never guessed)."""
    for line in text.splitlines()[:6]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#!"):
            continue
        if stripped.startswith('"""'):
            return stripped.strip('"').strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
        if stripped.startswith("//"):
            return stripped.lstrip("/").strip()
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
        entries = sorted(scripts_dir.glob("*.py")) + sorted(scripts_dir.glob("*.sh"))
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
```

- [ ] **Step 4: Run the Step 1 test again, confirm it passes**

```bash
python3 /tmp/test_load_scripts_catalog.py
```

Expected: `OK`

- [ ] **Step 5: Wire into `build_summary`**

In `scripts/status_summary.py`, change (currently around line 1485):

```python
        "skills": load_skills_catalog(claude_space),
    }
```

to:

```python
        "skills": load_skills_catalog(claude_space),
        "scripts": load_scripts_catalog(claude_space, script_dir.parent),
    }
```

(`script_dir` is `build_summary`'s existing second parameter, already `Path(__file__).resolve().parent` i.e. this repo's own `scripts/` folder — `script_dir.parent` is the repo root, which is what `load_scripts_catalog`'s `dashboard_visualizer_dir` parameter expects.)

- [ ] **Step 6: Run the existing end-to-end check**

```bash
bash scripts/verify_widget.sh
```

Expected: `[ok] status_summary.py runs clean against ...` and `== all checks passed ==` (this exercises `load_scripts_catalog` for real against your actual ClaudeSpace + dashboard-visualizer folders, since `build_summary` now calls it unconditionally).

- [ ] **Step 7: Delete the scratch test file and commit**

```bash
rm /tmp/test_load_scripts_catalog.py
```

```bash
git add scripts/status_summary.py
git commit -m "Add load_scripts_catalog data source for the Script Tray"
```

---

### Task 2: Generalize tray-open state and mini-mode reset

**Files:**
- Modify: `widgets/claudespace-status/index.jsx:97-107` (`setExpanded`)
- Modify: `widgets/claudespace-status/index.jsx:1272-1326` (`skillsTrayOpen`/`toggleSkillsTray`/`toggleSkillHex`/`resetSkillHexSelection`/`resetSkillsTray`)
- Modify: `widgets/claudespace-status/index.jsx:2088-2100` (`SkillsTab`'s wrap div + handle-zone `onClick`)

**Interfaces:**
- Produces: `toggleTray(trayId: string, e: MouseEvent) -> void`, `resetAllTrays(cardEl: HTMLElement) -> void` — both used by Task 3's `Tray` component and by `setExpanded`.
- Consumes: nothing new (still targets the existing `.skills-tray-wrap` DOM structure, renamed to `.tray-wrap` in this task).

- [ ] **Step 1: Replace the tray-open state and handlers**

In `widgets/claudespace-status/index.jsx`, replace (currently lines 1272-1278):

```js
let skillsTrayOpen = false

const toggleSkillsTray = (e) => {
  e.stopPropagation()
  skillsTrayOpen = !skillsTrayOpen
  const wrapEl = e.currentTarget.closest(".skills-tray-wrap")
  if (wrapEl) wrapEl.classList.toggle("is-open", skillsTrayOpen)
}
```

with:

```js
let activeTrayId = null

const toggleTray = (trayId, e) => {
  e.stopPropagation()
  const wrapEl = e.currentTarget.closest(".tray-wrap")
  if (!wrapEl) return
  const opening = activeTrayId !== trayId
  if (activeTrayId && activeTrayId !== trayId) {
    const container = wrapEl.parentElement
    const otherEl = container && container.querySelector(`.tray-wrap[data-tray-id="${activeTrayId}"]`)
    if (otherEl) {
      otherEl.classList.remove("is-open")
      resetSkillHexSelection(otherEl)
    }
  }
  wrapEl.classList.toggle("is-open", opening)
  if (!opening) resetSkillHexSelection(wrapEl)
  activeTrayId = opening ? trayId : null
}
```

Update the `toggleSkillHex`/`resetSkillHexSelection` selectors (currently lines 1292-1305) from `.skills-tray-wrap` to `.tray-wrap` — same bodies otherwise:

```js
const toggleSkillHex = (e) => {
  e.stopPropagation()
  const cell = e.currentTarget
  const wrapEl = cell.closest(".tray-wrap")
  if (!wrapEl) return
  const wasActive = cell.classList.contains("is-active")
  wrapEl.querySelectorAll(".skill-hex-cell.is-active").forEach((el) => el.classList.remove("is-active"))
  if (!wasActive) cell.classList.add("is-active")
}

const resetSkillHexSelection = (wrapEl) => {
  if (!wrapEl) return
  wrapEl.querySelectorAll(".skill-hex-cell.is-active").forEach((el) => el.classList.remove("is-active"))
}
```

Replace `resetSkillsTray` (currently lines 1319-1326):

```js
const resetSkillsTray = (cardEl) => {
  if (!cardEl) return
  const wrapEl = cardEl.querySelector(".skills-tray-wrap")
  if (!wrapEl) return
  skillsTrayOpen = false
  wrapEl.classList.remove("is-open")
  resetSkillHexSelection(wrapEl)
}
```

with:

```js
const resetAllTrays = (cardEl) => {
  if (!cardEl) return
  cardEl.querySelectorAll(".tray-wrap").forEach((wrapEl) => {
    wrapEl.classList.remove("is-open")
    resetSkillHexSelection(wrapEl)
  })
  activeTrayId = null
}
```

- [ ] **Step 2: Update `setExpanded`'s call site**

In `setExpanded` (currently lines 99-107), change:

```js
  if (!expanded) resetSkillsTray(el)
```

to:

```js
  if (!expanded) resetAllTrays(el)
```

- [ ] **Step 3: Update `SkillsTab`'s wrap div (class + click handler)**

In `SkillsTab` (currently around line 2089), change:

```jsx
      className={`skills-tray-wrap ${skillsTrayBox}`}
```

to:

```jsx
      className={`tray-wrap ${skillsTrayBox}`}
      data-tray-id="skills"
```

and change the handle zone's click handler (currently `onClick={toggleSkillsTray}` around line 2100) to:

```jsx
      <div className={skillsTrayHandleZone} onClick={(e) => toggleTray("skills", e)}>
```

- [ ] **Step 4: Automated check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==`

- [ ] **Step 5: Manual verification (live widget)**

Save the file, wait for the symlinked widget to live-reload (or quit/reopen Übersicht if it doesn't pick it up — see this repo's README), then on the real desktop card confirm, unchanged from before this task:
1. Hover/click Commandspace's title to expand to big mode — Skill Tray's half-circle pill appears flush at the top-left.
2. Click the pill — it opens into the full hex-grid panel.
3. Click it again — it closes back to the pill.
4. Click a hex tile — its overlay appears; move the mouse out of the tray entirely — overlay selection clears.
5. Collapse Commandspace back to mini mode (mouse away, wait out the grace period, or click the title again) — re-expand — the tray starts closed (pill state), never mid-open.

- [ ] **Step 6: Commit**

```bash
git add widgets/claudespace-status/index.jsx
git commit -m "Generalize tray-open state to activeTrayId/toggleTray/resetAllTrays"
```

---

### Task 3: Extract generic `Tray` shell component

**Files:**
- Modify: `widgets/claudespace-status/index.jsx:1376-1478` (`skillsTrayBox` → `trayBoxStyles` factory)
- Modify: `widgets/claudespace-status/index.jsx:1492-1531` (`skillsTrayHandleZone`/`skillsTabLabel`/`skillsTabCount` → generic renames + `trayCountStyles` factory)
- Modify: `widgets/claudespace-status/index.jsx:1541-1563` (`skillsTrayListGrid`/`skillsTrayListInner` → generic renames)
- Modify: `widgets/claudespace-status/index.jsx:2085-2118` (`SkillsTab` → `Tray`)
- Modify: `widgets/claudespace-status/index.jsx:3151` (render call site)

**Interfaces:**
- Produces: `Tray({ id, accentColor, label, count, children })` — a React component, renders `null` when `count` is falsy (matches `SkillsTab`'s existing `if (!skills || skills.length === 0) return null`).
- Consumes: `toggleTray`, `resetSkillHexSelection` (from Task 2), `disarmCollapse`/`armCollapse`/`cardNode` (existing).

- [ ] **Step 1: Turn `skillsTrayBox` into a factory**

Change the `const skillsTrayBox = css\`...\`` declaration (currently lines 1376-1478) from a plain const into a function, replacing every `${STATUS_RED}` inside it with `${accentColor}`:

```js
const trayBoxStyles = (accentColor) => css`
  position: absolute;
  top: 0;
  left: -84px;
  z-index: 5;
  width: 84px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: ${NERV_BG};
  border: 1px solid ${NERV_LINE};
  border-right: none;
  border-radius: 999px 0 0 999px;
  overflow: hidden;
  cursor: pointer;
  opacity: 0;
  transform: rotate(-90deg);
  pointer-events: none;
  transform-origin: top right;
  box-shadow: none;
  transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms,
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms, width 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    left 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.25s ease, box-shadow 0.25s ease;

  .is-expanded & {
    opacity: 1;
    transform: rotate(0deg);
    pointer-events: auto;
    transition-delay: 0s;
  }

  &.is-open {
    width: 272px;
    left: -272px;
    border-radius: 10px 0 0 10px;
    box-shadow: 0 4px 28px rgba(0, 0, 0, 0.5);
  }

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, ${accentColor} 8%, transparent) 0px,
      color-mix(in srgb, ${accentColor} 8%, transparent) 5px,
      transparent 5px,
      transparent 11px
    );
    pointer-events: none;
  }

  &.is-open .tray-list {
    transition-delay: 120ms;
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
  }
`
```

(All comments from the original explaining the container-transform design, click-only-open bug fix, etc. still apply verbatim — carry them forward above this declaration; omitted here for brevity, not to be omitted in the real file.)

- [ ] **Step 2: Generalize the handle-zone/label/count styles**

Rename (content unchanged) `skillsTrayHandleZone` → `trayHandleZone`, `skillsTabLabel` → `trayLabel`. Turn `skillsTabCount` into a factory:

```js
const trayCountStyles = (accentColor) => css`
  font-size: 12px;
  font-weight: 700;
  color: ${accentColor};
`
```

- [ ] **Step 3: Generalize the list-grid styles**

Rename (content unchanged) `skillsTrayListGrid` → `trayListGrid`, `skillsTrayListInner` → `trayListInner`.

- [ ] **Step 4: Replace `SkillsTab` with generic `Tray`**

Replace the `SkillsTab` component (currently lines 2085-2118):

```jsx
const Tray = ({ id, accentColor, label, count, children }) => {
  if (!count) return null
  return (
    <div
      className={`tray-wrap ${trayBoxStyles(accentColor)}`}
      data-tray-id={id}
      onMouseEnter={() => { if (cardNode) disarmCollapse(cardNode) }}
      onMouseLeave={(e) => {
        if (cardNode) armCollapse(cardNode)
        resetSkillHexSelection(e.currentTarget)
      }}
    >
      <div className={trayHandleZone} onClick={(e) => toggleTray(id, e)}>
        <span className={trayCountStyles(accentColor)}>{count}</span>
        <span className={trayLabel}>{label}</span>
      </div>
      <div className={`tray-list ${trayListGrid}`}>
        <div className={trayListInner}>{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Update the render call site**

In `render(state)` (currently line 3151), change:

```jsx
      <SkillsTab skills={skills} />
```

to:

```jsx
      <Tray id="skills" accentColor={STATUS_RED} label="SKILL TRAY" count={skills.length}>
        <SkillHexGrid skills={skills} />
      </Tray>
```

(`SkillHexGrid` is untouched in this task — Task 4 generalizes it. This step only swaps the shell.)

- [ ] **Step 6: Automated check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==`

- [ ] **Step 7: Manual verification (live widget)**

Same 5-point checklist as Task 2 Step 5 — output must still be pixel-identical (this task only changed how the shell is built, not what it renders).

- [ ] **Step 8: Commit**

```bash
git add widgets/claudespace-status/index.jsx
git commit -m "Extract generic Tray shell component from SkillsTab"
```

---

### Task 4: Generalize hex-grid content (`HexGrid`/`HexTile`)

**Files:**
- Modify: `widgets/claudespace-status/index.jsx:1803-1807` (`chunkSkillsIntoColumns` → `chunkIntoColumns`)
- Modify: `widgets/claudespace-status/index.jsx:1855-2062` (`skillHexOutline`/`skillHexOverlay`/`SkillHex`/`SkillHexGrid` → generic factories + `HexTile`/`HexGrid`)
- Modify: `widgets/claudespace-status/index.jsx:1583-1588` (`formatSkillUpdated` → `formatUpdatedRecency`, keep call sites in sync)
- Modify: `widgets/claudespace-status/index.jsx:3151` area (render call site, from Task 3)

**Interfaces:**
- Produces: `HexTile({ item, accentColor, filled, renderOverlayBody })`, `HexGrid({ items, accentColor, fillPredicate, renderOverlayBody })`, `renderSkillOverlayBody(skill)`.
- Consumes: `toggleSkillHex` (renamed `toggleHexSelection` in this task), `chunkIntoColumns`, `HEX_FILL_TEXT`, `SKILL_HEX_COLUMNS` (unchanged name — see Global Constraints).

- [ ] **Step 1: Rename the column-chunking helper**

Rename `chunkSkillsIntoColumns` → `chunkIntoColumns` (body unchanged, still keyed by the unchanged `SKILL_HEX_COLUMNS` constant):

```js
const chunkIntoColumns = (items) => {
  const columns = Array.from({ length: SKILL_HEX_COLUMNS }, () => [])
  items.forEach((item, i) => columns[i % SKILL_HEX_COLUMNS].push(item))
  return columns
}
```

- [ ] **Step 2: Rename hex-selection handlers and class**

Rename `toggleSkillHex` → `toggleHexSelection` and `resetSkillHexSelection` → `resetHexSelection` (both fully generic now — neither references anything skill-specific), and update the class they operate on from `.skill-hex-cell` → `.hex-cell`:

```js
const toggleHexSelection = (e) => {
  e.stopPropagation()
  const cell = e.currentTarget
  const wrapEl = cell.closest(".tray-wrap")
  if (!wrapEl) return
  const wasActive = cell.classList.contains("is-active")
  wrapEl.querySelectorAll(".hex-cell.is-active").forEach((el) => el.classList.remove("is-active"))
  if (!wasActive) cell.classList.add("is-active")
}

const resetHexSelection = (wrapEl) => {
  if (!wrapEl) return
  wrapEl.querySelectorAll(".hex-cell.is-active").forEach((el) => el.classList.remove("is-active"))
}
```

**Update every other call site to the new name** — `resetSkillHexSelection` was introduced in Task 2 (inside `toggleTray` and `resetAllTrays`) and used again in Task 3 (inside `Tray`'s `onMouseLeave`). Find every remaining call to `resetSkillHexSelection(...)` in the file and rename it to `resetHexSelection(...)` — there should be none left after this step (`grep -n resetSkillHexSelection widgets/claudespace-status/index.jsx` should return nothing but the now-removed old definition).

- [ ] **Step 3: Turn `skillHexOutline` and `skillHexOverlay` into factories**

Replace (currently lines 1897-1908):

```js
const skillHexOutline = css`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  background: ${STATUS_RED};
  position: relative;

  .skill-hex-cell:hover & {
    background: ${NERV_TEXT};
  }
`
```

with:

```js
const hexOutlineStyles = (accentColor) => css`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  background: ${accentColor};
  position: relative;

  .hex-cell:hover & {
    background: ${NERV_TEXT};
  }
`
```

Replace `skillHexOverlay` (currently lines 1966-1986):

```js
const skillHexOverlay = css`
  position: absolute;
  inset: 0;
  z-index: 30;
  background: ${NERV_BG};
  border: 1px solid ${STATUS_RED};
  padding: 10px;
  overflow-y: auto;
  text-align: left;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${RED_LINE};
    border-radius: 2px;
  }
`
```

with:

```js
const hexOverlayStyles = (accentColor) => css`
  position: absolute;
  inset: 0;
  z-index: 30;
  background: ${NERV_BG};
  border: 1px solid ${accentColor};
  padding: 10px;
  overflow-y: auto;
  text-align: left;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, ${accentColor} 35%, transparent);
    border-radius: 2px;
  }
`
```

(`RED_LINE` becomes unused after this — remove its declaration.)

- [ ] **Step 4: Rename the color-neutral hex styles**

Rename (content unchanged) `skillHexCell` → `hexCell`, `skillHexFill` → `hexFill`, `skillHexTriangle` → `hexTriangle`, `skillHexLabel` → `hexLabel`, `skillsHexWrap` → `hexWrap`, `skillsHexGrid` → `hexGrid`, `skillHexColumn` → `hexColumn`.

- [ ] **Step 5: Rename `formatSkillUpdated`**

Rename `formatSkillUpdated` → `formatUpdatedRecency` (body unchanged) — do this now, before Step 6 introduces a call to it, so the file never has a dangling reference to the new name. It's no longer skill-specific once scripts use it too (Task 5). Confirm no other call sites reference the old name: `grep -n formatSkillUpdated widgets/claudespace-status/index.jsx` should return nothing.

- [ ] **Step 6: Extract `renderSkillOverlayBody` and replace `SkillHex`**

Replace `SkillHex` (currently lines 1988-2048) with:

```jsx
const renderSkillOverlayBody = (skill) => (
  <div>
    <div className={skillRowName} style={{ fontSize: 13 }}>{skill.name}</div>

    {skill.description && (
      <div className={skillOverlaySection}>
        <div className={skillOverlayLabel}>Summary</div>
        <div className={skillOverlayBody}>{skill.description}</div>
      </div>
    )}

    <div className={skillOverlaySection}>
      <div className={skillOverlayLabel}>Used</div>
      <div className={skillOverlayBody} style={{ whiteSpace: "normal" }}>
        {formatSkillCounts(skill)}
        {formatSkillLastUsed(skill.last_called_hours_ago)}
      </div>
    </div>

    {skill.called_by && skill.called_by.length > 0 && (
      <div className={skillOverlaySection}>
        <div className={skillOverlayLabel}>Called by</div>
        <div className={skillOverlayBody}>{skill.called_by.join(", ")}</div>
      </div>
    )}

    {skill.calls && skill.calls.length > 0 && (
      <div className={skillOverlaySection}>
        <div className={skillOverlayLabel}>Calls</div>
        <div className={skillOverlayBody}>{skill.calls.join(", ")}</div>
      </div>
    )}

    <div className={skillOverlaySection}>
      <div className={skillOverlayLabel}>Last updated</div>
      <div className={skillOverlayBody}>{formatUpdatedRecency(skill.updated_hours_ago)}</div>
    </div>
  </div>
)

const HexTile = ({ item, accentColor, filled, renderOverlayBody }) => (
  <div className={`hex-cell ${hexCell}`} onClick={toggleHexSelection}>
    <div className={hexOutlineStyles(accentColor)}>
      <div className={hexFill} style={{ background: filled ? accentColor : NERV_BG }}>
        <span className={hexTriangle} style={{ color: filled ? HEX_FILL_TEXT : accentColor }}>▲</span>
        <span className={hexLabel} style={{ color: filled ? HEX_FILL_TEXT : accentColor }}>{item.name}</span>
        <span className={hexTriangle} style={{ color: filled ? HEX_FILL_TEXT : accentColor }}>▼</span>
      </div>
    </div>
    <div className={`hex-overlay ${hexOverlayStyles(accentColor)}`}>
      {renderOverlayBody(item, accentColor)}
    </div>
  </div>
)
```

Note: `renderOverlayBody`'s return value is wrapped in a plain `<div>` here (not a fragment) — this environment cannot render `<>...</>` (see Global Constraints).

- [ ] **Step 7: Replace `SkillHexGrid` with generic `HexGrid`**

Replace `SkillHexGrid` (currently lines 2050-2062):

```jsx
const HexGrid = ({ items, accentColor, fillPredicate, renderOverlayBody }) => (
  <div className={hexWrap}>
    <div className={hexGrid}>
      {chunkIntoColumns(items).map((column, i) => (
        <div className={hexColumn} key={i}>
          {column.map((item) => (
            <HexTile
              key={item.path || item.name}
              item={item}
              accentColor={accentColor}
              filled={fillPredicate(item)}
              renderOverlayBody={renderOverlayBody}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
)
```

- [ ] **Step 8: Update the render call site from Task 3**

Change:

```jsx
      <Tray id="skills" accentColor={STATUS_RED} label="SKILL TRAY" count={skills.length}>
        <SkillHexGrid skills={skills} />
      </Tray>
```

to:

```jsx
      <Tray id="skills" accentColor={STATUS_RED} label="SKILL TRAY" count={skills.length}>
        <HexGrid
          items={skills}
          accentColor={STATUS_RED}
          fillPredicate={(s) => s.call_count > 0}
          renderOverlayBody={renderSkillOverlayBody}
        />
      </Tray>
```

- [ ] **Step 9: Automated check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==` (this specifically re-confirms check 1.7's hex-row-width math, since `HEX_W`/`SKILL_HEX_COLUMNS` are untouched but the surrounding code moved).

- [ ] **Step 10: Manual verification (live widget)**

Same 5-point checklist as Task 2 Step 5, plus: click a hex tile and confirm its overlay still shows Summary/Used/Called by/Calls/Last updated exactly as before.

- [ ] **Step 11: Commit**

```bash
git add widgets/claudespace-status/index.jsx
git commit -m "Generalize SkillHex/SkillHexGrid into HexTile/HexGrid"
```

---

### Task 5: Add the Script Tray and stack both trays in a column

**Files:**
- Modify: `widgets/claudespace-status/index.jsx` (new `trayColumn` style; `trayBoxStyles` positioning change; `render(state)` destructure + render tree)

**Interfaces:**
- Produces: `renderScriptOverlayBody(script)`, `trayColumn` style.
- Consumes: `Tray`, `HexGrid`, `STATUS_BLUE` (all already defined by Tasks 1-4).

- [ ] **Step 1: Move absolute positioning from each tray box to the shared column**

The column now owns the "flush against the card's left edge, growing leftward" behavior that each tray box used to handle individually via `left: -width`. In `trayBoxStyles` (from Task 3), remove `position: absolute; top: 0; left: -84px;` and the `.is-open` rule's `left: -272px;`, and add `flex-shrink: 0;`:

```js
const trayBoxStyles = (accentColor) => css`
  z-index: 5;
  width: 84px;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: ${NERV_BG};
  border: 1px solid ${NERV_LINE};
  border-right: none;
  border-radius: 999px 0 0 999px;
  overflow: hidden;
  cursor: pointer;
  opacity: 0;
  transform: rotate(-90deg);
  pointer-events: none;
  transform-origin: top right;
  box-shadow: none;
  transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms,
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms, width 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    border-radius 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.25s ease, box-shadow 0.25s ease;

  .is-expanded & {
    opacity: 1;
    transform: rotate(0deg);
    pointer-events: auto;
    transition-delay: 0s;
  }

  &.is-open {
    width: 272px;
    border-radius: 10px 0 0 10px;
    box-shadow: 0 4px 28px rgba(0, 0, 0, 0.5);
  }

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, ${accentColor} 8%, transparent) 0px,
      color-mix(in srgb, ${accentColor} 8%, transparent) 5px,
      transparent 5px,
      transparent 11px
    );
    pointer-events: none;
  }

  &.is-open .tray-list {
    transition-delay: 120ms;
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
  }
`
```

Add the new `trayColumn` style (this is what now owns the absolute positioning and the "grow leftward from a fixed right edge" behavior, via `align-items: flex-end` — each tray's right edge stays flush with the column's own right edge regardless of its width):

```js
const trayColumn = css`
  position: absolute;
  top: 0;
  right: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
`
```

- [ ] **Step 2: Add `renderScriptOverlayBody`**

```jsx
const renderScriptOverlayBody = (script) => (
  <div>
    <div className={skillRowName} style={{ fontSize: 13 }}>{script.name}</div>

    <div className={skillOverlaySection}>
      <div className={skillOverlayLabel}>Project</div>
      <div className={skillOverlayBody}>{script.project}</div>
    </div>

    <div className={skillOverlaySection}>
      <div className={skillOverlayLabel}>Path</div>
      <div className={skillOverlayBody}>{script.path}</div>
    </div>

    {script.description && (
      <div className={skillOverlaySection}>
        <div className={skillOverlayLabel}>Summary</div>
        <div className={skillOverlayBody}>{script.description}</div>
      </div>
    )}

    <div className={skillOverlaySection}>
      <div className={skillOverlayLabel}>Last updated</div>
      <div className={skillOverlayBody}>{formatUpdatedRecency(script.updated_hours_ago)}</div>
    </div>
  </div>
)
```

- [ ] **Step 3: Destructure `scripts` in `render(state)`**

Change (currently around line 2915):

```js
    daily_goal,
    skills,
  } = state
```

to:

```js
    daily_goal,
    skills,
    scripts,
  } = state
```

- [ ] **Step 4: Stack both trays inside `trayColumn`**

Change the render tree (currently the `<Tray id="skills" ...>` block from Task 4, around line 3151):

```jsx
      <Tray id="skills" accentColor={STATUS_RED} label="SKILL TRAY" count={skills.length}>
        <HexGrid
          items={skills}
          accentColor={STATUS_RED}
          fillPredicate={(s) => s.call_count > 0}
          renderOverlayBody={renderSkillOverlayBody}
        />
      </Tray>
```

to:

```jsx
      <div className={trayColumn}>
        <Tray id="skills" accentColor={STATUS_RED} label="SKILL TRAY" count={skills.length}>
          <HexGrid
            items={skills}
            accentColor={STATUS_RED}
            fillPredicate={(s) => s.call_count > 0}
            renderOverlayBody={renderSkillOverlayBody}
          />
        </Tray>
        <Tray id="scripts" accentColor={STATUS_BLUE} label="SCRIPT TRAY" count={scripts ? scripts.length : 0}>
          <HexGrid
            items={scripts || []}
            accentColor={STATUS_BLUE}
            fillPredicate={() => true}
            renderOverlayBody={renderScriptOverlayBody}
          />
        </Tray>
      </div>
```

(`scripts ? scripts.length : 0` / `scripts || []` guard against an older cached `status_summary.py` JSON payload that predates Task 1's `"scripts"` key — same defensive style already used elsewhere in this file for optional state fields.)

- [ ] **Step 5: Automated check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==`

- [ ] **Step 6: Full manual verification (live widget)**

On the real desktop card, in big mode:
1. Skill Tray pill appears at the top-left, flush with the card's top edge, as before.
2. Script Tray pill appears directly below it (blue-tinted hazard-stripe texture, blue count number, "SCRIPT TRAY" label), with a small gap between the two pills.
3. Click the Skill Tray open — it expands; the Script Tray pill stays put, still closed, positioned correctly below the now-wider open Skill Tray panel (both still right-aligned to the same edge).
4. Click the Script Tray open — the Skill Tray auto-closes (mutual exclusivity); Script Tray now shows blue hex tiles (all filled, since `fillPredicate` is always-true), one per discovered script.
5. Click a script hex tile — overlay shows Project/Path/Summary (if present)/Last updated.
6. With the Script Tray open, click the Skill Tray — Script Tray auto-closes, Skill Tray opens (mutual exclusivity, the other direction).
7. Collapse Commandspace to mini mode, then re-expand — both trays start closed (pill state).
8. Confirm the actual scripts listed match real files: at minimum `dependency-audit/housekeeping`, `system-healthcheck/consistency_sweep`, `log-rollup/rollup` (ClaudeSpace), and `dashboard-visualizer/status_summary`, `dashboard-visualizer/lifecycle_resort`, `dashboard-visualizer/report_summary`, `dashboard-visualizer/verify_widget`.

- [ ] **Step 7: Commit**

```bash
git add widgets/claudespace-status/index.jsx
git commit -m "Add Script Tray, stack Skill/Script trays in a shared column"
```

---

## Spec coverage check

- Styled identically, blue-themed: Tasks 3-5 (`Tray`/`HexGrid` parameterized by `accentColor`).
- Pops out directly under the Skill Tray: Task 5 (`trayColumn`).
- Lists generated scripts (ClaudeSpace + this repo): Task 1.
- Mutual exclusivity / collapsed-tray-only-when-none-active: Task 2 (`toggleTray`).
- Mini mode resets all trays: Task 2 (`resetAllTrays`).
- Config-driven abstraction, no copy-pasted markup: Tasks 2-4 (`Tray`, `HexGrid`/`HexTile`, `trayBoxStyles`/`hexOutlineStyles`/`hexOverlayStyles` factories).

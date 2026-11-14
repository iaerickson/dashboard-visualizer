# Reports Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third pop-out tray ("Reports Tray") to the `claudespace-status` widget, showing the latest `ianlogger` entry and `usage-scheduler` report, replacing the standalone `report-viewer` widget entirely.

**Architecture:** `status_summary.py` imports `report_summary.py`'s three existing loader functions directly (no subprocess) and adds their output to its own JSON payload. A new `ReportsPanels` component in `claudespace-status/index.jsx` ports report-viewer's three panels (Today's Log / Latest Report / Recent Nuggets) as `children` of a third `<Tray id="reports">`, reusing the `Tray`/`trayColumn` shell built for the Script Tray with zero changes to that shell.

**Tech Stack:** Same as the Script Tray work — plain JSX (Babel, no bundler) + Emotion `css`, Python 3 stdlib, no test framework in either language.

## Global Constraints

- No JSX fragment shorthand (`<>...</>`) anywhere — crashes this Übersicht environment at render time. Use a plain wrapper `<div>`.
- No literal backtick characters inside `/* ... */` comments living inside a `css\`...\`` template literal.
- Do not rename `SKILLS_TRAY_HEX_ROW_MAX_WIDTH`, `HEX_W`, or `SKILL_HEX_COLUMNS` — unrelated to this work, but `verify_widget.sh` still checks them and this plan doesn't touch them.
- `Tray`'s own definition (shell: box/handle/label/count/list-grid) is NOT modified by this plan — the Reports Tray is a third caller of the existing, unchanged component. The hide-when-empty behavior for this specific tray is handled entirely at its own call site (see Task 2), not by changing `Tray` itself.
- `report_summary.py`'s own loading/parsing logic (`load_latest_log`, `load_latest_usage_report`, `load_persona_nuggets`, `find_latest_dated_file`, `parse_report_sections`) is NOT modified — only imported and called from a new location. The file itself is not deleted.
- `claudespace-status/index.jsx` already has its own `formatHoursAgo` (24h cutover to days). The ported version keeps its own distinct 48h cutover under the name `formatReportHoursAgo` — do not rename either to unify them, and do not let the new one shadow/collide with the existing one.
- Run `bash scripts/verify_widget.sh` (from the repo root; prefer `VERIFY_JSX_PARSER_DIR=~/Desktop/Projects/recast` if available, for a real JSX parse rather than the brace/backtick fallback) after every task and confirm `== all checks passed ==`.
- This repo has no JS test runner and no Python test framework (no `package.json`, no `pytest`) — plain `assert`-based scripts for Python, static checks + manual self-review for JSX (no live-GUI access in any implementation subagent's environment — flag the live-widget check as not performed rather than fake it, same as the Script Tray plan).

---

### Task 1: Fold `report_summary.py`'s loaders into `status_summary.py`

**Files:**
- Modify: `scripts/status_summary.py:65` (add import after the existing `from pathlib import Path` line)
- Modify: `scripts/status_summary.py:1542` (add three keys to `build_summary`'s return dict)

**Interfaces:**
- Consumes (already exist in `scripts/report_summary.py`, unchanged): `load_latest_log(claude_space: Path) -> dict | None`, `load_latest_usage_report(claude_space: Path) -> dict | None`, `load_persona_nuggets(claude_space: Path) -> list`.
- Produces: `build_summary`'s return dict gains `"log"`, `"report"`, `"nuggets"` keys with those same shapes.

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test_reports_fold.py` (not committed — no test directory convention in this repo):

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, "scripts")
from status_summary import build_summary

with tempfile.TemporaryDirectory() as tmp:
    claude_space = Path(tmp)
    (claude_space / "ianlogger" / "logs").mkdir(parents=True)
    (claude_space / "ianlogger" / "logs" / "2026-08-06.md").write_text(
        "# 2026-08-06\n\nFixed the widget positioning bug.\n"
    )
    (claude_space / "usage-scheduler").mkdir(parents=True)
    (claude_space / "usage-scheduler" / "latest-report.md").write_text(
        "# 🌙 Morning Report — for 2026-08-06\n\n"
        "## Completed tonight\n- Rolled up logs\n- Refreshed snapshot\n\n"
        "## Still needs you\n- Review the new spec\n"
    )
    # No persona log.md files - nuggets should come back empty, not error.

    # script_dir only feeds config paths (usage_resets.json, session_reset.json,
    # etc.) that this test doesn't exercise - every loader that reads them
    # already guards on `.exists()` first (the established pattern throughout
    # this file), so passing a script_dir whose "config" sibling doesn't exist
    # is safe and returns None/defaults for those unrelated fields rather than
    # erroring. No directory needs to be pre-created for this test.
    script_dir = claude_space

    result = build_summary(claude_space, script_dir)

    assert "log" in result, "build_summary must return a 'log' key"
    assert result["log"]["date"] == "2026-08-06"
    assert "Fixed the widget positioning bug." in result["log"]["text"]
    assert result["log"]["hours_ago"] is not None

    assert "report" in result, "build_summary must return a 'report' key"
    assert result["report"]["sections"]["Completed tonight"] == ["Rolled up logs", "Refreshed snapshot"]
    assert result["report"]["sections"]["Still needs you"] == ["Review the new spec"]

    assert "nuggets" in result, "build_summary must return a 'nuggets' key"
    assert result["nuggets"] == []  # no persona log.md files in this fixture

print("OK")
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
python3 /tmp/test_reports_fold.py
```

Expected: `AssertionError: build_summary must return a 'log' key` (the keys don't exist yet).

- [ ] **Step 3: Add the import**

In `scripts/status_summary.py`, change (currently lines 58-65):

```python
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
```

to:

```python
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from report_summary import load_latest_log, load_latest_usage_report, load_persona_nuggets
```

(This import resolves correctly with no `sys.path` changes needed: `report_summary.py` lives in the same `scripts/` directory as `status_summary.py`, and Python automatically adds a directly-invoked script's own directory to `sys.path[0]`.)

- [ ] **Step 4: Wire the three keys into `build_summary`'s return dict**

Change (currently the end of `build_summary`, around line 1560):

```python
        "skills": load_skills_catalog(claude_space),
        "scripts": load_scripts_catalog(claude_space, script_dir.parent),
    }
```

to:

```python
        "skills": load_skills_catalog(claude_space),
        "scripts": load_scripts_catalog(claude_space, script_dir.parent),
        "log": load_latest_log(claude_space),
        "report": load_latest_usage_report(claude_space),
        "nuggets": load_persona_nuggets(claude_space),
    }
```

- [ ] **Step 5: Run the Step 1 test again, confirm it passes**

```bash
python3 /tmp/test_reports_fold.py
```

Expected: `OK`

- [ ] **Step 6: Run the existing end-to-end check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==` (exercises the new import and wiring for real against your actual ClaudeSpace folder — if your real `ianlogger`/`usage-scheduler` data doesn't exist yet, `log`/`report` will be `null`, which is valid and already handled by both loader functions).

- [ ] **Step 7: Delete the scratch test file and commit**

```bash
rm /tmp/test_reports_fold.py
git add scripts/status_summary.py
git commit -m "Fold report_summary.py's loaders into status_summary.py's payload"
```

---

### Task 2: Port report-viewer's panels into a Reports Tray, retire the standalone widget

**Files:**
- Modify: `widgets/claudespace-status/index.jsx` (new styles/component, `render(state)` destructure, third `<Tray>`)
- Delete: `widgets/report-viewer/index.jsx`

**Interfaces:**
- Consumes: `Tray({ id, accentColor, label, count, children })` (unchanged, from the Script Tray work), `STATUS_PURPLE` (already destructured from `THEME.statusPurple` near the top of the file, currently used only for the "Backlog" status icon).
- Produces: `ReportsPanels({ log, report, nuggets, accentColor })` — a component, not exported elsewhere, used only as `Tray`'s children at this task's own render call site.

- [ ] **Step 1: Add the ported panel styles**

Add these near the other shared overlay/section styles (e.g. after `skillOverlayBody`'s definition) in `widgets/claudespace-status/index.jsx`. All ported verbatim from `widgets/report-viewer/index.jsx` except `panelHeader`, which becomes a color factory so its header line can carry `STATUS_PURPLE` (the one deliberate accent touch tying this content to the tray it lives in — everything else stays the same neutral NERV amber/orange this widget already uses throughout its non-tray content, matching how the rest of `claudespace-status` looks):

```js
const reportsPanel = css`
  margin-bottom: 12px;
  &:last-child {
    margin-bottom: 0;
  }
`

const reportsPanelHeaderStyles = (accentColor) => css`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${accentColor};
  margin-bottom: 5px;
`

const reportsPanelMeta = css`
  font-size: 9px;
  color: ${NERV_TEXT_DIM};
  text-transform: none;
  letter-spacing: 0;
`

const reportsEmptyNote = css`
  font-size: 11px;
  color: ${NERV_TEXT_DIM};
  font-style: italic;
`

const reportsLogText = css`
  font-size: 11px;
  line-height: 1.5;
  color: ${NERV_TEXT};
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;

  &:hover {
    -webkit-line-clamp: unset;
  }
`

const reportsBulletList = css`
  margin: 0;
  padding: 0;
  list-style: none;
`

const reportsBulletItem = css`
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT};
  margin-bottom: 4px;
  padding-left: 10px;
  position: relative;

  &::before {
    content: "–";
    position: absolute;
    left: 0;
    color: ${NERV_TEXT_DIM};
  }

  &:last-child {
    margin-bottom: 0;
  }
`

const reportsAttentionBulletItem = css`
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT};
  margin-bottom: 4px;
  padding-left: 12px;
  position: relative;

  &::before {
    content: "!";
    position: absolute;
    left: 0;
    color: ${NERV_ORANGE};
    font-weight: 700;
  }

  &:last-child {
    margin-bottom: 0;
  }
`

const reportsMoreNote = css`
  font-size: 9px;
  color: ${NERV_TEXT_DIM};
  margin-top: 3px;
`

const reportsNuggetPersonaLabel = css`
  color: ${NERV_ORANGE};
  font-weight: 600;
  text-transform: capitalize;
  font-size: 10px;
`

const reportsNuggetGroup = css`
  margin-bottom: 6px;
  &:last-child {
    margin-bottom: 0;
  }
`

const reportsNuggetEntry = css`
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT_DIM};
  margin-top: 2px;
`
```

- [ ] **Step 2: Add the ported helper functions**

```js
// formatReportHoursAgo (2026-08-06) - ported from report-viewer/index.jsx's
// own formatHoursAgo verbatim, including its 48h (not 24h) hour/day
// cutover - a real, if small, tuned difference from this file's own
// formatHoursAgo (used for "Last touched: X"), kept as a separate named
// function rather than unified, since unifying the two thresholds is an
// unrelated behavior change out of scope for this work.
const formatReportHoursAgo = (hoursAgo) => {
  if (hoursAgo == null) return null
  if (hoursAgo < 1) return `${Math.round(hoursAgo * 60)}m ago`
  if (hoursAgo < 48) return `${Math.round(hoursAgo)}h ago`
  return `${Math.round(hoursAgo / 24)}d ago`
}

// Report titles look like "🌙 Morning Report — for 2026-08-06" - strips the
// leading emoji (rendered separately/redundantly next to a text label would
// look odd here) and keeps the rest as-is.
const cleanReportTitle = (title) => {
  if (!title) return "Latest report"
  return title.replace(/^[^\w]+/, "").trim()
}

// findSection (ported verbatim) - report headings aren't a fixed,
// guaranteed contract, so this matches by pattern instead of an exact key.
// Skips empty sections rather than showing an empty panel.
const findSection = (sections, patterns) => {
  if (!sections) return null
  const keys = Object.keys(sections)
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k) && sections[k] && sections[k].length > 0)
    if (key) return sections[key]
  }
  return null
}

const REPORTS_BULLET_CAP = 3
```

- [ ] **Step 3: Add the `ReportsPanels` component**

```jsx
const ReportsPanels = ({ log, report, nuggets, accentColor }) => {
  const completed = findSection(report?.sections, [/completed/i])
  const needsYou = findSection(report?.sections, [/still needs you/i, /needs you/i])

  return (
    <div>
      <div className={reportsPanel}>
        <div className={reportsPanelHeaderStyles(accentColor)}>
          <span>Today's Log</span>
          {log && <span className={reportsPanelMeta}>{log.date} · {formatReportHoursAgo(log.hours_ago)}</span>}
        </div>
        {log ? (
          <div className={reportsLogText}>{log.text}</div>
        ) : (
          <div className={reportsEmptyNote}>no ianlogger entry yet</div>
        )}
      </div>

      <div className={reportsPanel}>
        <div className={reportsPanelHeaderStyles(accentColor)}>
          <span>{report ? cleanReportTitle(report.title) : "Latest Report"}</span>
          {report && <span className={reportsPanelMeta}>{formatReportHoursAgo(report.hours_ago)}</span>}
        </div>
        {report ? (
          <div>
            {completed && (
              <ul className={reportsBulletList}>
                {completed.slice(0, REPORTS_BULLET_CAP).map((item, i) => (
                  <li className={reportsBulletItem} key={i}>{item}</li>
                ))}
              </ul>
            )}
            {completed && completed.length > REPORTS_BULLET_CAP && (
              <div className={reportsMoreNote}>+{completed.length - REPORTS_BULLET_CAP} more completed</div>
            )}
            {needsYou && (
              <ul className={reportsBulletList} style={{ marginTop: completed ? 8 : 0 }}>
                {needsYou.slice(0, REPORTS_BULLET_CAP).map((item, i) => (
                  <li className={reportsAttentionBulletItem} key={i}>{item}</li>
                ))}
              </ul>
            )}
            {!completed && !needsYou && <div className={reportsEmptyNote}>nothing to report</div>}
          </div>
        ) : (
          <div className={reportsEmptyNote}>no usage-scheduler report yet</div>
        )}
      </div>

      {nuggets && nuggets.length > 0 && (
        <div className={reportsPanel}>
          <div className={reportsPanelHeaderStyles(accentColor)}>
            <span>Recent Nuggets</span>
          </div>
          {nuggets.map((n) => (
            <div className={reportsNuggetGroup} key={n.persona}>
              <span className={reportsNuggetPersonaLabel}>{n.persona}</span>
              {n.entries.slice(0, 1).map((entry, i) => (
                <div className={reportsNuggetEntry} key={i}>{entry}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Note: the outer `<div>` (not a fragment) is required — this environment cannot render `<>...</>`.

- [ ] **Step 4: Add the pill-freshness helper**

```js
// reportsPillLabel (2026-08-06) - Tray's `count` prop is reused here for a
// short "how fresh" token instead of an item count (this content isn't a
// catalog like skills/scripts). Returning a non-empty STRING when data
// exists and "" when it doesn't means Tray's own unchanged `if (!count)
// return null` gate works correctly here too - a non-empty string is
// always truthy in JS even when it reads "0h", unlike the number 0 (which
// would have wrongly hidden the tray the moment the freshest source was
// exactly zero hours old). No changes to Tray itself needed.
const reportsPillLabel = (log, report) => {
  const hours = [log?.hours_ago, report?.hours_ago].filter((h) => h != null)
  if (!hours.length) return ""
  const freshest = Math.min(...hours)
  return freshest < 1 ? "<1h" : `${Math.round(freshest)}h`
}
```

- [ ] **Step 5: Destructure `log`/`report`/`nuggets` in `render(state)`**

Change (currently around line 3019):

```js
    skills,
    scripts,
  } = state
```

to:

```js
    skills,
    scripts,
    log,
    report,
    nuggets,
  } = state
```

- [ ] **Step 6: Add the third `<Tray>` to `trayColumn`**

Change the render tree (currently around lines 3256-3273):

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
        <Tray id="reports" accentColor={STATUS_PURPLE} label="REPORTS TRAY" count={reportsPillLabel(log, report)}>
          <ReportsPanels log={log} report={report} nuggets={nuggets} accentColor={STATUS_PURPLE} />
        </Tray>
      </div>
```

- [ ] **Step 7: Delete the standalone `report-viewer` widget**

```bash
rm -rf widgets/report-viewer
```

- [ ] **Step 8: Automated check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==` (the check loops over every `widgets/*/index.jsx` automatically, so `report-viewer`'s removal needs no separate update to the checker itself — it simply has one fewer widget to check now).

- [ ] **Step 9: Self-review (no live-GUI access in this environment)**

Trace through by hand and confirm:
- `ReportsPanels` receives `log`/`report`/`nuggets` exactly as `status_summary.py`'s `build_summary` now produces them (Task 1) — field names match (`date`/`text`/`hours_ago` for `log`; `title`/`sections`/`hours_ago` for `report`; `persona`/`entries` per item in `nuggets`).
- `reportsPillLabel(null, null)` returns `""` (empty string, falsy) — confirm `Tray`'s existing `if (!count) return null` correctly hides the Reports Tray when neither source exists, exactly like Skill/Script do at zero.
- `reportsPillLabel({hours_ago: 0.3}, null)` returns `"<1h"` (non-empty, truthy) — confirm the tray does NOT hide itself just because the freshest source is very recent.
- No lingering references to `report-viewer` anywhere in `widgets/claudespace-status/index.jsx` or elsewhere in the repo that assumed the old widget still existed (check `README.md` for any setup instructions specifically about the `report-viewer` symlink that should be flagged, even if not edited by this task).

This step requires a human with the real desktop widget open to actually confirm visually — write in your report that it needs a human check, and list exactly what to look for:
1. A third, purple-tinted collapsed pill appears below the Script Tray pill, flush against it (no gap), showing a short "Xh"/"<1h" freshness token.
2. Clicking it opens a panel showing today's ianlogger entry (if one exists) and the latest usage-scheduler report's Completed/Needs-you bullets (if any) — same content `report-viewer`'s old floating card used to show.
3. It participates correctly in mutual exclusion with Skill Tray and Script Tray (opening it closes whichever of the other two was open, and vice versa).
4. The old `report-viewer` floating card (bottom-left of the screen) is gone. **Separately, on your own machine:** remove whatever Übersicht symlink pointed at the old `widgets/report-viewer` folder (this plan does not touch your local Übersicht setup) — otherwise Übersicht may show a broken/errored widget where that card used to be.

- [ ] **Step 10: Commit**

```bash
git add widgets/claudespace-status/index.jsx
git add widgets/report-viewer
git commit -m "Add Reports Tray (log/report/nuggets), retire the standalone report-viewer widget"
```

---

## Spec coverage check

- Fold `report_summary.py`'s loaders into `status_summary.py`, keep the file itself: Task 1.
- Retire the `report-viewer` widget: Task 2, Step 7.
- Third tray, `STATUS_PURPLE`, stacks under Script Tray: Task 2, Step 6.
- Pill shows hours-since-freshest, not an item count: Task 2, Step 4.
- Ported panels (Today's Log / Latest Report / Recent Nuggets), same content and caps as `report-viewer`: Task 2, Steps 1-3.
- `formatReportHoursAgo` kept distinct from the existing `formatHoursAgo`: Task 2, Step 2, and called out in Global Constraints.
- Hide-when-empty via a call-site string trick, no changes to `Tray` itself: Task 2, Steps 4 and 6, and called out in Global Constraints.
- Manual Übersicht-symlink cleanup flagged as a human step, not performed by the plan: Task 2, Step 9.

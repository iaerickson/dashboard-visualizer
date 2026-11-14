# Reports Tray v2, Plan A: Core Read/Unread Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Reports Tray real read/unread state and unread-backlog stacking, shipped end-to-end for the three sources that already have a clean one-file-per-day archive: ianlogger, usage-scheduler, dependency-audit.

**Architecture:** A new `config/reports_viewed.json` tracks a per-source watermark. A generalized archive-instance enumerator in `report_summary.py` turns "the latest file" logic into "every unread file, oldest first, plus the current one" for any dated-archive source. `status_summary.py` wires three sources through it into a uniform `"reports"` payload. `HexTile`/`HexGrid` gain one new optional prop (`onTileSelect`) so opening a hex can mark it read via the same `run()` shell-out pattern this file's `copyPrompt` already uses — no changes to how Skill Tray or Script Tray behave. Reports Tray's JSX is rewritten to consume the new uniform payload shape (replacing today's hardcoded 2-source version) and its hex titles get fixed to short, non-truncating labels.

**Tech Stack:** Same as every prior tray branch — plain JSX (Babel, no bundler) + Emotion `css`, Python 3 stdlib, no test framework in either language.

## Global Constraints

- Read state is a single watermark per source (`last_viewed_id`), not a per-instance flag — clicking a newer unread instance also marks any older still-unread instance as read, even if it was never individually opened. This is a deliberate, documented simplification (see the design spec's own note) — do not "fix" it into per-instance tracking, that's explicitly out of scope.
- `HexTile`/`HexGrid`'s existing behavior for Skill Tray and Script Tray must be pixel- and behavior-identical after this plan — the new `onTileSelect` prop must default to a no-op when not passed.
- No JSX fragment shorthand (`<>...</>`) anywhere — crashes this Übersicht environment at render time.
- No literal backtick characters inside `/* ... */` comments living inside a `css\`...\`` template literal.
- Config writes follow this codebase's existing convention exactly: `config_path.write_text(json.dumps(data, indent=2))` — no atomic temp-file-plus-rename dance, that's not this codebase's pattern (see `load_session_reset`/`load_personal_health` in `status_summary.py`).
- Dated-file sort order is always by FILENAME (the stem, e.g. `"2026-08-06"`), never by file mtime — same reasoning `find_latest_dated_file`'s own existing docstring already gives (a rollup move can bump mtime without changing what day the entry is about).
- This repo has no JS test runner and no Python test framework (no `package.json`, no `pytest`) — plain `assert`-based scripts for Python, static checks (`verify_widget.sh`, prefer `VERIFY_JSX_PARSER_DIR=~/Desktop/Projects/recast` for a real JSX parse) + human self-review for JSX (no live-GUI access in any implementation subagent's environment — flag the live-widget check as not performed rather than fake it).

---

### Task 1: `reports_viewed.json` read/write helpers + `mark_report_viewed.py` CLI

**Files:**
- Modify: `scripts/report_summary.py:43` (add helpers after the existing `H2_RE` constant, before `find_latest_dated_file`)
- Create: `scripts/mark_report_viewed.py`

**Interfaces:**
- Produces: `load_reports_viewed(config_path: Path) -> dict`, `save_reports_viewed(config_path: Path, data: dict) -> None`, `is_unread(viewed_entry: dict, instance_id: str | None = None, mtime: float | None = None) -> bool` (pass exactly one of `instance_id`/`mtime`).
- Produces (script): `mark_report_viewed.py --config <path> --source <key> --id <date>` or `--config <path> --source <key> --mtime`, updates the watermark monotonically (never regresses it).

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test_reports_viewed.py` (not committed — this repo has no test directory convention):

```python
import sys, json, tempfile, subprocess
from pathlib import Path
sys.path.insert(0, "scripts")
from report_summary import load_reports_viewed, save_reports_viewed, is_unread

with tempfile.TemporaryDirectory() as tmp:
    config_path = Path(tmp) / "reports_viewed.json"

    # load_reports_viewed: missing file -> {}
    assert load_reports_viewed(config_path) == {}

    # save then load round-trips
    save_reports_viewed(config_path, {"ianlogger": {"last_viewed_id": "2026-08-05"}})
    assert load_reports_viewed(config_path) == {"ianlogger": {"last_viewed_id": "2026-08-05"}}

    # malformed JSON -> {} (fail-open, matches this file's other loaders)
    config_path.write_text("not json")
    assert load_reports_viewed(config_path) == {}

    # is_unread: id-based
    save_reports_viewed(config_path, {"ianlogger": {"last_viewed_id": "2026-08-05"}})
    entry = load_reports_viewed(config_path)["ianlogger"]
    assert is_unread(entry, instance_id="2026-08-06") is True   # newer than watermark
    assert is_unread(entry, instance_id="2026-08-05") is False  # equal to watermark
    assert is_unread(entry, instance_id="2026-08-04") is False  # older than watermark
    assert is_unread({}, instance_id="2026-08-06") is True      # no entry at all = unread

    # is_unread: mtime-based
    mtime_entry = {"last_viewed_mtime": 1000.0}
    assert is_unread(mtime_entry, mtime=1001.0) is True
    assert is_unread(mtime_entry, mtime=999.0) is False
    assert is_unread({}, mtime=1001.0) is True

    # mark_report_viewed.py CLI: id mode, fresh file
    subprocess.run(
        ["python3", "scripts/mark_report_viewed.py", "--config", str(config_path),
         "--source", "usage_scheduler", "--id", "2026-08-06"],
        check=True,
    )
    data = load_reports_viewed(config_path)
    assert data["usage_scheduler"]["last_viewed_id"] == "2026-08-06"
    assert data["ianlogger"]["last_viewed_id"] == "2026-08-05"  # untouched

    # mark_report_viewed.py CLI: monotonic - older id does NOT regress the watermark
    subprocess.run(
        ["python3", "scripts/mark_report_viewed.py", "--config", str(config_path),
         "--source", "usage_scheduler", "--id", "2026-08-01"],
        check=True,
    )
    assert load_reports_viewed(config_path)["usage_scheduler"]["last_viewed_id"] == "2026-08-06"

    # mark_report_viewed.py CLI: mtime mode
    subprocess.run(
        ["python3", "scripts/mark_report_viewed.py", "--config", str(config_path),
         "--source", "skill_auditor", "--mtime"],
        check=True,
    )
    assert "last_viewed_mtime" in load_reports_viewed(config_path)["skill_auditor"]

print("OK")
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
python3 /tmp/test_reports_viewed.py
```

Expected: `ImportError: cannot import name 'load_reports_viewed' from 'report_summary'`

- [ ] **Step 3: Implement the three helpers in `report_summary.py`**

Insert immediately after the `H2_RE = re.compile(r"^##\s+(.+)$")` line (currently line 43) and before `def find_latest_dated_file`:

```python
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
    status_summary.py, no atomic-write dance."""
    config_path.write_text(json.dumps(data, indent=2))


def is_unread(viewed_entry: dict, instance_id: str | None = None, mtime: float | None = None) -> bool:
    """True if the given instance (by dated id for archive sources, by
    mtime for running-log sources) is newer than the source's last-viewed
    watermark - or if there's no watermark at all yet (never viewed, so
    everything is unread). Pass exactly one of instance_id/mtime; which
    one a source uses is a property of that source's own shape (archive
    vs running-log), not a per-call choice."""
    if instance_id is not None:
        last_viewed_id = viewed_entry.get("last_viewed_id")
        return last_viewed_id is None or instance_id > last_viewed_id
    if mtime is not None:
        last_viewed_mtime = viewed_entry.get("last_viewed_mtime")
        return last_viewed_mtime is None or mtime > last_viewed_mtime
    raise ValueError("is_unread requires exactly one of instance_id or mtime")
```

- [ ] **Step 4: Create `scripts/mark_report_viewed.py`**

```python
#!/usr/bin/env python3
"""
mark_report_viewed.py — Reports Tray v2 (2026-08-08). Updates one source's
entry in config/reports_viewed.json when the owner clicks open a hex in the
Reports Tray. Called by the widget itself via Übersicht's `run()` shell-out
(same mechanism claudespace-status/index.jsx's own copyPrompt already uses
for copy-to-clipboard - this isn't a new interaction pattern for this
codebase, just a new use of one that already works).

Two modes, matching the two watermark shapes reports_viewed.json holds:
  --id <date>   for archive sources (ianlogger, usage-scheduler, dependency-audit)
  --mtime       for running-log sources (skill-auditor, automation-scout) -
                stamps the CURRENT wall-clock time as the new watermark,
                since running-log sources are tracked by "has the file
                changed since I last looked," not by a specific instance id

Both modes are monotonic - never regress a source's watermark backward,
even if called with an older id/an earlier mtime than what's already
stored (defensive; in practice the widget only ever calls this with the
instance actually being opened, but a stray double-click or race between
two quick clicks should never make the tray un-read something).
"""
import argparse
import sys
import time
from pathlib import Path

from report_summary import load_reports_viewed, save_reports_viewed


def main() -> int:
    parser = argparse.ArgumentParser(description="Mark a Reports Tray source as viewed.")
    parser.add_argument("--config", required=True, type=Path, help="Path to config/reports_viewed.json")
    parser.add_argument("--source", required=True, help="Source key, e.g. ianlogger, usage_scheduler")
    parser.add_argument("--id", help="Archive-source instance id (date), e.g. 2026-08-06")
    parser.add_argument("--mtime", action="store_true", help="Running-log source - stamp current time")
    args = parser.parse_args()

    if bool(args.id) == bool(args.mtime):
        print("exactly one of --id or --mtime is required", file=sys.stderr)
        return 1

    data = load_reports_viewed(args.config)
    entry = data.get(args.source, {})

    if args.id:
        current = entry.get("last_viewed_id")
        if current is None or args.id > current:
            entry["last_viewed_id"] = args.id
    else:
        current = entry.get("last_viewed_mtime")
        now = time.time()
        if current is None or now > current:
            entry["last_viewed_mtime"] = now

    data[args.source] = entry
    save_reports_viewed(args.config, data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run the Step 1 test again, confirm it passes**

```bash
python3 /tmp/test_reports_viewed.py
```

Expected: `OK`

- [ ] **Step 6: Run the existing end-to-end check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==` (this task doesn't touch `status_summary.py`/`index.jsx` yet, so this mainly confirms nothing else broke).

- [ ] **Step 7: Delete the scratch test file and commit**

```bash
rm /tmp/test_reports_viewed.py
git add scripts/report_summary.py scripts/mark_report_viewed.py
git commit -m "Add reports_viewed.json read/write helpers and mark_report_viewed.py CLI"
```

---

### Task 2: Generalize dated-file listing; enumerate archive instances

**Files:**
- Modify: `scripts/report_summary.py:46-60` (`find_latest_dated_file` → generalized `list_dated_files` + thin wrapper)
- Modify: `scripts/report_summary.py:62-88` (`load_latest_log` → extract `load_log_entry`)
- Modify: `scripts/report_summary.py:113-157` (`load_latest_usage_report` → extract `load_usage_report_entry`)
- Modify: `scripts/report_summary.py` (add `list_archive_instances`, `load_dependency_audit_entry`)

**Interfaces:**
- Consumes: `load_reports_viewed`, `is_unread` (Task 1).
- Produces: `list_dated_files(root: Path) -> list[Path]` (oldest to newest), `load_log_entry(path: Path) -> dict`, `load_usage_report_entry(path: Path) -> dict`, `load_dependency_audit_entry(path: Path) -> dict`, `list_archive_instances(archive_dir: Path, viewed_entry: dict, load_content) -> list[dict]` (each dict has at least `{"id": str, "viewed": bool, ...content}`).

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test_archive_instances.py`:

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, "scripts")
from report_summary import (
    list_dated_files, load_log_entry, load_usage_report_entry,
    load_dependency_audit_entry, list_archive_instances,
)

with tempfile.TemporaryDirectory() as tmp:
    archive = Path(tmp) / "logs"
    archive.mkdir()
    (archive / "2026-08-04.md").write_text("# 2026-08-04\n\nFirst entry.\n")
    (archive / "2026-08-05.md").write_text("# 2026-08-05\n\nSecond entry.\n")
    (archive / "2026-08-06.md").write_text("# 2026-08-06\n\nThird entry.\n")
    (archive / "not-dated.md").write_text("should be ignored\n")

    # list_dated_files: sorted oldest to newest, non-dated files excluded
    files = list_dated_files(archive)
    assert [p.stem for p in files] == ["2026-08-04", "2026-08-05", "2026-08-06"]

    # load_log_entry: parses one file directly (no searching)
    entry = load_log_entry(archive / "2026-08-05.md")
    assert entry["date"] == "2026-08-05"
    assert "Second entry." in entry["text"]
    assert entry["hours_ago"] is not None

    # list_archive_instances: nothing viewed yet -> every instance is unread,
    # oldest first
    instances = list_archive_instances(archive, {}, load_log_entry)
    assert [i["id"] for i in instances] == ["2026-08-04", "2026-08-05", "2026-08-06"]
    assert all(i["viewed"] is False for i in instances)
    assert instances[0]["text"] == "First entry."

    # list_archive_instances: middle one viewed (watermark = 2026-08-05) ->
    # 2026-08-04 and 2026-08-05 both read (watermark covers everything up
    # to and including itself), only 2026-08-06 unread, but the newest
    # instance is ALWAYS included even when read, so both 05 and 06 show
    viewed_entry = {"last_viewed_id": "2026-08-05"}
    instances = list_archive_instances(archive, viewed_entry, load_log_entry)
    ids = [i["id"] for i in instances]
    assert "2026-08-04" not in ids  # older than watermark, not newest -> dropped
    assert "2026-08-06" in ids
    by_id = {i["id"]: i for i in instances}
    assert by_id["2026-08-06"]["viewed"] is False

    # list_archive_instances: everything viewed (watermark = newest) ->
    # only the single newest instance shows, marked viewed
    viewed_entry = {"last_viewed_id": "2026-08-06"}
    instances = list_archive_instances(archive, viewed_entry, load_log_entry)
    assert len(instances) == 1
    assert instances[0]["id"] == "2026-08-06"
    assert instances[0]["viewed"] is True

    # list_archive_instances: empty archive -> []
    empty = Path(tmp) / "empty"
    empty.mkdir()
    assert list_archive_instances(empty, {}, load_log_entry) == []

    # load_usage_report_entry: parses one file directly
    report_path = Path(tmp) / "report.md"
    report_path.write_text(
        "# 🌙 Morning Report — for 2026-08-06\n\n## Completed tonight\n- Did a thing\n"
    )
    report_entry = load_usage_report_entry(report_path)
    assert report_entry["title"] == "🌙 Morning Report — for 2026-08-06"
    assert report_entry["sections"]["Completed tonight"] == ["Did a thing"]
    assert report_entry["hours_ago"] is not None

    # load_dependency_audit_entry: title + path only (no excerpt parsing - v1 scope)
    audit_path = Path(tmp) / "audit.md"
    audit_path.write_text("# Claude Dependency Audit — ClaudeSpace & Projects\n\nBody text.\n")
    audit_entry = load_dependency_audit_entry(audit_path)
    assert audit_entry["title"] == "Claude Dependency Audit — ClaudeSpace & Projects"
    assert audit_entry["path"] == str(audit_path)

    # load_dependency_audit_entry: no H1 -> falls back to a generic title, doesn't crash
    no_title_path = Path(tmp) / "no-title.md"
    no_title_path.write_text("Just body text, no heading.\n")
    fallback_entry = load_dependency_audit_entry(no_title_path)
    assert fallback_entry["title"] == "Dependency Audit"

print("OK")
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
python3 /tmp/test_archive_instances.py
```

Expected: `ImportError: cannot import name 'list_dated_files' from 'report_summary'`

- [ ] **Step 3: Generalize `find_latest_dated_file` into `list_dated_files`**

Replace (currently lines 46-60):

```python
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
```

with:

```python
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
```

- [ ] **Step 4: Extract `load_log_entry` from `load_latest_log`**

Replace (currently lines 62-88):

```python
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
```

with:

```python
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
```

- [ ] **Step 5: Extract `load_usage_report_entry` from `load_latest_usage_report`**

Replace (currently lines 113-157, the part after `parse_report_sections` — leave `parse_report_sections` itself untouched):

```python
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
```

with:

```python
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
```

- [ ] **Step 6: Add `load_dependency_audit_entry` and `list_archive_instances`**

Add after `load_persona_nuggets` (before `build_summary`):

```python
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
    single newest instance even when it's already viewed, so a source
    with an archive never fully disappears from the tray once it's
    produced anything at all. `load_content(path) -> dict` is the
    per-source content loader (load_log_entry, load_usage_report_entry,
    load_dependency_audit_entry, ...); its returned dict is merged with
    `id`/`viewed` on each instance. Read state is a single watermark, not
    a per-instance flag - see is_unread's own docstring."""
    files = list_dated_files(archive_dir)
    if not files:
        return []
    newest = files[-1]
    instances = []
    for path in files:
        instance_id = path.stem
        unread = is_unread(viewed_entry, instance_id=instance_id)
        if unread or path == newest:
            content = load_content(path)
            instances.append({"id": instance_id, "viewed": not unread, **content})
    return instances
```

- [ ] **Step 7: Run the Step 1 test again, confirm it passes**

```bash
python3 /tmp/test_archive_instances.py
```

Expected: `OK`

- [ ] **Step 8: Run the existing end-to-end check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==` (this also re-confirms `load_latest_log`/`load_latest_usage_report` still behave identically for the existing "current log/report" display, since they now delegate to the extracted functions rather than duplicating logic).

- [ ] **Step 9: Delete the scratch test file and commit**

```bash
rm /tmp/test_archive_instances.py
git add scripts/report_summary.py
git commit -m "Generalize dated-file listing and extract per-instance loaders for archive enumeration"
```

---

### Task 3: Wire three sources into `status_summary.py`'s `"reports"` payload

**Files:**
- Modify: `scripts/status_summary.py` (import additions, new `build_reports_payload` helper, `build_summary`'s return dict)

**Interfaces:**
- Consumes: `load_reports_viewed`, `list_archive_instances`, `load_log_entry`, `load_usage_report_entry`, `load_dependency_audit_entry` (Tasks 1-2, all from `report_summary.py`).
- Produces: `build_summary`'s return dict gains a `"reports"` key: `{"ianlogger": {"instances": [...]}, "usage_scheduler": {"instances": [...]}, "dependency_audit": {"instances": [...]}}`.

- [ ] **Step 1: Write the failing test**

Save as `/tmp/test_reports_payload.py`:

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, "scripts")
from status_summary import build_summary

with tempfile.TemporaryDirectory() as tmp:
    claude_space = Path(tmp)
    (claude_space / "ianlogger" / "logs").mkdir(parents=True)
    (claude_space / "ianlogger" / "logs" / "2026-08-06.md").write_text("# 2026-08-06\n\nDid stuff.\n")

    (claude_space / "usage-scheduler" / "reports").mkdir(parents=True)
    (claude_space / "usage-scheduler" / "reports" / "2026-08-06.md").write_text(
        "# Morning Report — for 2026-08-06\n\n## Completed tonight\n- A thing\n"
    )
    (claude_space / "usage-scheduler" / "latest-report.md").write_text(
        "# Morning Report — for 2026-08-06\n\n## Completed tonight\n- A thing\n"
    )

    (claude_space / "dependency-audit" / "reports").mkdir(parents=True)
    (claude_space / "dependency-audit" / "reports" / "2026-08-04.md").write_text(
        "# Claude Dependency Audit\n\nBody.\n"
    )

    # script_dir only feeds config paths (reports_viewed.json included) that
    # this test doesn't assert on - build_reports_payload's own
    # load_reports_viewed call handles a missing file by returning {}
    # (every instance unread), so no config directory needs to exist for
    # this test. Same reasoning as Reports Tray v1's own Task 1 test.
    script_dir = claude_space

    result = build_summary(claude_space, script_dir)

    assert "reports" in result
    reports = result["reports"]

    assert "ianlogger" in reports
    ianlogger_ids = [i["id"] for i in reports["ianlogger"]["instances"]]
    assert ianlogger_ids == ["2026-08-06"]
    assert reports["ianlogger"]["instances"][0]["viewed"] is False  # never viewed -> unread

    assert "usage_scheduler" in reports
    assert [i["id"] for i in reports["usage_scheduler"]["instances"]] == ["2026-08-06"]

    assert "dependency_audit" in reports
    assert [i["id"] for i in reports["dependency_audit"]["instances"]] == ["2026-08-04"]

print("OK")
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
python3 /tmp/test_reports_payload.py
```

Expected: `AssertionError: assert 'reports' in result` (or a `KeyError` - the key doesn't exist yet).

- [ ] **Step 3: Add the import**

In `scripts/status_summary.py`, extend the existing `report_summary` import (currently around line 74):

```python
from report_summary import load_latest_log, load_latest_usage_report, load_persona_nuggets
```

to:

```python
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
```

- [ ] **Step 4: Add `build_reports_payload`**

Add this function immediately before `build_summary`:

```python
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
```

- [ ] **Step 5: Wire it into `build_summary`'s return dict**

Change (currently the end of `build_summary`, the three lines added for Reports Tray v1):

```python
        "log": load_latest_log(claude_space),
        "report": load_latest_usage_report(claude_space),
        "nuggets": load_persona_nuggets(claude_space),
    }
```

to:

```python
        "log": load_latest_log(claude_space),
        "report": load_latest_usage_report(claude_space),
        "nuggets": load_persona_nuggets(claude_space),
        "reports": build_reports_payload(claude_space, script_dir),
    }
```

(`"log"`/`"report"`/`"nuggets"` stay exactly as they are today — Task 5 of this plan removes the JSX code that reads them, but that's a JS-side cleanup, not something this Python task needs to touch.)

- [ ] **Step 6: Run the Step 1 test again, confirm it passes**

```bash
python3 /tmp/test_reports_payload.py
```

Expected: `OK`

- [ ] **Step 7: Run the existing end-to-end check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==` (exercises `build_reports_payload` for real against your actual ClaudeSpace + dashboard-visualizer folders).

- [ ] **Step 8: Delete the scratch test file and commit**

```bash
rm /tmp/test_reports_payload.py
git add scripts/status_summary.py
git commit -m "Wire ianlogger/usage-scheduler/dependency-audit into a uniform reports payload"
```

---

### Task 4: Extend `HexTile`/`HexGrid` with optional `onTileSelect`

**Files:**
- Modify: `widgets/claudespace-status/index.jsx:1303-1311` (`toggleHexSelection`)
- Modify: `widgets/claudespace-status/index.jsx:2204-2237` (`HexTile`, `HexGrid`)

**Interfaces:**
- Produces: `toggleHexSelection(e) -> boolean` (now returns whether the tile is open/active AFTER the toggle - previously returned nothing). `HexTile`/`HexGrid` both gain an optional `onTileSelect` prop, `(item) => void`, called only on the transition INTO the open state, never on close, never when not passed.
- Consumes: nothing new.

- [ ] **Step 1: Make `toggleHexSelection` return whether the tile is now open**

Change (currently lines 1303-1311):

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
```

to:

```js
// Returns whether the tile is open/active AFTER the toggle (2026-08-08,
// Reports Tray v2) - previously returned nothing, since no caller needed
// to know. HexTile's own onClick wrapper (below) uses this to fire
// onTileSelect only on the transition INTO the open state, never on
// close - existing callers of toggleHexSelection (there's only the one,
// HexTile's onClick) never used a return value, so this is a safe,
// backward-compatible addition.
const toggleHexSelection = (e) => {
  e.stopPropagation()
  const cell = e.currentTarget
  const wrapEl = cell.closest(".tray-wrap")
  if (!wrapEl) return false
  const wasActive = cell.classList.contains("is-active")
  wrapEl.querySelectorAll(".hex-cell.is-active").forEach((el) => el.classList.remove("is-active"))
  if (!wasActive) cell.classList.add("is-active")
  return !wasActive
}
```

- [ ] **Step 2: Add `onTileSelect` to `HexTile` and `HexGrid`**

Change (currently lines 2204-2237):

```jsx
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

to:

```jsx
// onTileSelect (2026-08-08, Reports Tray v2) - optional, defaults to
// undefined so Skill Tray/Script Tray's existing call sites (which don't
// pass it) are completely unaffected. Fires only when a tile transitions
// INTO the open state (per toggleHexSelection's own new return value),
// never on close - Reports Tray uses this to mark a hex read the moment
// its overlay is actually opened, matching how notification-style UIs
// typically clear on open rather than needing a separate action.
const HexTile = ({ item, accentColor, filled, renderOverlayBody, onTileSelect }) => (
  <div
    className={`hex-cell ${hexCell}`}
    onClick={(e) => {
      const isNowOpen = toggleHexSelection(e)
      if (isNowOpen && onTileSelect) onTileSelect(item)
    }}
  >
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

const HexGrid = ({ items, accentColor, fillPredicate, renderOverlayBody, onTileSelect }) => (
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
              onTileSelect={onTileSelect}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
)
```

- [ ] **Step 3: Automated check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==`

- [ ] **Step 4: Self-review (no live-GUI access in this environment)**

Confirm by reading the diff: every existing `<HexGrid ...>` call site (Skill Tray, Script Tray) does NOT pass `onTileSelect`, so `onTileSelect` is `undefined` at those call sites, `if (isNowOpen && onTileSelect)` short-circuits to false, and `toggleHexSelection`'s own DOM-class behavior is completely unchanged from before this task - trace through one open and one close click by hand for a Skill Tray hex and confirm no observable behavior differs from before this task.

This step also requires a human with the real desktop widget open to confirm visually — write in your report that it needs a human check: open Skill Tray and Script Tray, click hexes open and closed exactly as before, confirm nothing about their look or behavior changed.

- [ ] **Step 5: Commit**

```bash
git add widgets/claudespace-status/index.jsx
git commit -m "Add optional onTileSelect to HexTile/HexGrid, no-op for existing trays"
```

---

### Task 5: Rewrite Reports Tray's JSX for the uniform payload, wire mark-as-read, fix titles

**Files:**
- Modify: `widgets/claudespace-status/index.jsx` (`reportsItems`, `renderReportOverlayBody`, `reportsPillLabel`, `render(state)` destructure and render tree)

**Interfaces:**
- Consumes: `HexTile`/`HexGrid`'s new `onTileSelect` prop (Task 4); `status_summary.py`'s new `"reports"` payload shape, `{source: {"instances": [{"id", "viewed", ...content}]}}` (Task 3).
- Produces: `markReportViewed(item) -> void` (the `onTileSelect` handler Reports Tray passes to `HexGrid`).

- [ ] **Step 1: Replace `reportsItems` to consume the uniform `reports` payload**

Find the current `reportsItems` function (search for `const reportsItems = (log, report, nuggets) =>`) and replace it entirely with:

```js
// REPORT_SOURCE_LABELS (2026-08-08, Reports Tray v2) - short, fixed hex-face
// labels replacing the old full-title-truncates-mid-word approach. The
// real title/date still shows in the overlay (renderReportOverlayBody
// below), same as every other hex in this tray system already does.
const REPORT_SOURCE_LABELS = {
  ianlogger: "IANLOGGER",
  usage_scheduler: "MORNING REPORT",
  dependency_audit: "DEPENDENCY AUDIT",
}

// reportsItems (2026-08-08, rebuilt for Reports Tray v2's uniform payload)
// - flattens every source's `instances` list into one flat hex-item array.
// Each item carries `reportSource` (the key mark_report_viewed.py needs)
// and `id` (the instance's own date) alongside the usual `key`/`kind`/
// `name`/`data` shape every other hex item in this file already uses.
const reportsItems = (reports) => {
  const items = []
  Object.keys(REPORT_SOURCE_LABELS).forEach((source) => {
    const instances = (reports && reports[source] && reports[source].instances) || []
    instances.forEach((instance) => {
      items.push({
        key: `${source}-${instance.id}`,
        kind: source,
        reportSource: source,
        id: instance.id,
        name: REPORT_SOURCE_LABELS[source],
        viewed: instance.viewed,
        data: instance,
      })
    })
  })
  return items
}
```

- [ ] **Step 2: Replace `renderReportOverlayBody` to dispatch on the three source kinds**

Find the current `renderReportOverlayBody` function and replace its body (keep the function signature `(item, accentColor) => {`) with:

```js
const renderReportOverlayBody = (item, accentColor) => {
  const instance = item.data

  if (item.kind === "ianlogger") {
    return (
      <div>
        <div className={skillRowName} style={{ fontSize: 13 }}>{item.name}</div>
        <div className={skillOverlaySection}>
          <div className={overlayLabelStyles(accentColor)}>{instance.date} · {formatReportHoursAgo(instance.hours_ago)}</div>
          <div className={skillOverlayBody}>{instance.text}</div>
        </div>
      </div>
    )
  }

  if (item.kind === "usage_scheduler") {
    const completed = findSection(instance.sections, [/completed/i])
    const needsYou = findSection(instance.sections, [/still needs you/i, /needs you/i])
    return (
      <div>
        <div className={skillRowName} style={{ fontSize: 13 }}>{cleanReportTitle(instance.title)}</div>
        <div className={skillOverlaySection}>
          <div className={overlayLabelStyles(accentColor)}>{item.id} · {formatReportHoursAgo(instance.hours_ago)}</div>
        </div>
        {completed && (
          <div className={skillOverlaySection}>
            <div className={overlayLabelStyles(accentColor)}>Completed</div>
            <ul className={reportsBulletList}>
              {completed.slice(0, REPORTS_BULLET_CAP).map((line, i) => (
                <li className={reportsBulletItem} key={i}>{line}</li>
              ))}
            </ul>
            {completed.length > REPORTS_BULLET_CAP && (
              <div className={reportsMoreNote}>+{completed.length - REPORTS_BULLET_CAP} more completed</div>
            )}
          </div>
        )}
        {needsYou && (
          <div className={skillOverlaySection}>
            <div className={overlayLabelStyles(accentColor)}>Needs you</div>
            <ul className={reportsBulletList}>
              {needsYou.slice(0, REPORTS_BULLET_CAP).map((line, i) => (
                <li className={reportsAttentionBulletItem} key={i}>{line}</li>
              ))}
            </ul>
            {needsYou.length > REPORTS_BULLET_CAP && (
              <div className={reportsMoreNote}>+{needsYou.length - REPORTS_BULLET_CAP} more needs you</div>
            )}
          </div>
        )}
        {!completed && !needsYou && <div className={skillOverlayBody}>nothing to report</div>}
      </div>
    )
  }

  // dependency_audit
  return (
    <div>
      <div className={skillRowName} style={{ fontSize: 13 }}>{item.name}</div>
      <div className={skillOverlaySection}>
        <div className={overlayLabelStyles(accentColor)}>{instance.title}</div>
        <div className={skillOverlayBody}>{item.id}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add `markReportViewed`**

Add immediately after `renderReportOverlayBody`:

```js
// markReportViewed (2026-08-08, Reports Tray v2) - HexGrid's onTileSelect
// handler for this tray. Shells out via Übersicht's run() the same way
// copyPrompt already does for copy-to-clipboard - not a new interaction
// pattern for this file. No-ops for an already-viewed item (nothing to
// mark). Absolute paths, same convention CLAUDE_SPACE_FOLDER and this
// widget's own `command` export already use throughout this file - this
// is a personal, single-user widget, not meant to be portable.
const REPORTS_VIEWED_CONFIG_PATH = "~/Desktop/Projects/dashboard-visualizer/config/reports_viewed.json"
const MARK_REPORT_VIEWED_SCRIPT_PATH = "~/Desktop/Projects/dashboard-visualizer/scripts/mark_report_viewed.py"

const markReportViewed = (item) => {
  if (item.viewed) return
  run(
    `python3 '${MARK_REPORT_VIEWED_SCRIPT_PATH}' --config '${REPORTS_VIEWED_CONFIG_PATH}' --source '${item.reportSource}' --id '${item.id}'`
  ).catch(() => {})
}
```

- [ ] **Step 4: Remove the old `reportsPillLabel(log, report, nuggets)` in favor of a payload-based version**

Find the current `reportsPillLabel` function and replace it entirely with:

```js
// reportsPillLabel (2026-08-08, rebuilt for Reports Tray v2) - counts
// unread instances across all three sources instead of computing a
// freshness token. An item COUNT fits this tray's new shape better than
// v1's "hours since freshest" did, now that there can genuinely be more
// than one hex per source (the backlog stacking case) - "3" unread is a
// more useful glance-signal here than which one is freshest. Tray's
// existing `if (!count) return null` gate works unchanged: 0 unread
// hides the tray only when there's also nothing to show at all - but the
// tray should still show once a source has ANY instance (even fully
// read), same as Skill/Script Tray never hide just because nothing's
// "new". So this counts TOTAL instances, not just unread ones - matches
// Tray's existing count semantics (an item count, not a badge count).
const reportsPillLabel = (reports) => reportsItems(reports).length
```

- [ ] **Step 5: Update `render(state)`'s destructure**

Change (currently destructures `log, report, nuggets,` alongside `skills, scripts,`):

```js
    skills,
    scripts,
    log,
    report,
    nuggets,
  } = state
```

to:

```js
    skills,
    scripts,
    reports,
  } = state
```

(`log`/`report`/`nuggets` are no longer read anywhere in the JSX after this task - `status_summary.py`'s payload still includes them for now, that's fine, unused JSON fields are harmless and Task 3 of this plan deliberately left them in place.)

- [ ] **Step 6: Update the render tree**

Change the `<Tray id="reports" ...>` block:

```jsx
        <Tray id="reports" accentColor={STATUS_PURPLE} label="REPORTS TRAY" count={reportsPillLabel(log, report, nuggets)}>
          <HexGrid
            items={reportsItems(log, report, nuggets)}
            accentColor={STATUS_PURPLE}
            fillPredicate={(item) => item.available}
            renderOverlayBody={renderReportOverlayBody}
          />
        </Tray>
```

to:

```jsx
        <Tray id="reports" accentColor={STATUS_PURPLE} label="REPORTS TRAY" count={reportsPillLabel(reports)}>
          <HexGrid
            items={reportsItems(reports)}
            accentColor={STATUS_PURPLE}
            fillPredicate={(item) => !item.viewed}
            renderOverlayBody={renderReportOverlayBody}
            onTileSelect={markReportViewed}
          />
        </Tray>
```

- [ ] **Step 7: Automated check**

```bash
bash scripts/verify_widget.sh
```

Expected: `== all checks passed ==`

- [ ] **Step 8: Self-review (no live-GUI access in this environment)**

Confirm by reading the diff:
- `reportsItems(reports)` reads `reports.ianlogger.instances`/`reports.usage_scheduler.instances`/`reports.dependency_audit.instances` - field names match exactly what Task 3's `build_reports_payload` produces.
- `renderReportOverlayBody`'s three branches read `instance.date`/`instance.text`/`instance.hours_ago` (ianlogger), `instance.title`/`instance.sections`/`instance.hours_ago` (usage_scheduler), `instance.title` (dependency_audit) - match `load_log_entry`/`load_usage_report_entry`/`load_dependency_audit_entry`'s own return shapes exactly (Task 2).
- No dangling references to the removed `ReportsPanels`-era `log`/`report`/`nuggets` parameters anywhere in `reportsItems`/`renderReportOverlayBody`/`reportsPillLabel` - `grep -n "reportsItems(log\|renderReportOverlayBody.*nuggets\|reportsPillLabel(log" widgets/claudespace-status/index.jsx` should return nothing.
- `markReportViewed` only fires for unread items (`if (item.viewed) return`), and only on open (via `onTileSelect`'s own contract from Task 4), never on close.

This step also requires a human with the real desktop widget open. Write in your report that it needs a human check, and list exactly what to look for:
1. Reports Tray pill shows a plain count (not the old "Xh"/"<1h" token).
2. Opening it shows one hex per unread instance for ianlogger/usage-scheduler/dependency-audit, plus each source's current instance even if already read - hex faces read "IANLOGGER"/"MORNING REPORT"/"DEPENDENCY AUDIT", not a truncated title.
3. Clicking an unread hex opens its overlay AND the hex itself visibly changes from filled to outline within a refresh cycle (confirms the shell-out actually updated `config/reports_viewed.json` and the widget picked it up on its next 20s poll) - use `cat config/reports_viewed.json` in a terminal to confirm the watermark actually moved if the visual change is hard to catch.
4. If a source currently has more than one dated file that predates ever being viewed, confirm multiple hexes stack for that source, oldest at the top of its column.

- [ ] **Step 9: Commit**

```bash
git add widgets/claudespace-status/index.jsx
git commit -m "Rewrite Reports Tray for uniform payload: unread hexes, backlog stacking, mark-as-read"
```

---

## Spec coverage check

- `reports_viewed.json` watermark + `mark_report_viewed.py`: Task 1.
- Generalized archive-instance enumeration, applies to ianlogger/usage-scheduler/dependency-audit: Task 2.
- Uniform `"reports"` payload wired into `status_summary.py`: Task 3.
- `fillPredicate` now means "unread," backlog stacking (oldest unread on top, current instance always included): Task 5 (`reportsItems`, `fillPredicate={(item) => !item.viewed}`).
- Click-to-mark-read via existing `run()` shell-out pattern, opening (not closing) fires it: Task 4 (`onTileSelect` contract) + Task 5 (`markReportViewed`).
- Title fix (short fixed labels, real title/date in overlay): Task 5 (`REPORT_SOURCE_LABELS`, overlay bodies).
- Explicit single-watermark-not-per-instance simplification: documented in Global Constraints, implemented via `is_unread`'s single-comparison design (Task 1) with no per-instance flag structure anywhere in the payload.
- Deferred to Plan B (not in this plan): `system-healthcheck`'s new report-writing step, `skill-auditor`/`automation-scout` as mtime-based sources, `tip-of-day`.

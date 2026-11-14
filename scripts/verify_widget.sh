#!/usr/bin/env bash
# verify_widget.sh — automation-scout finding (2026-07-31, no-risk tier).
#
# What this replaces: every round of live widget iteration this session
# ended with the same two manual checks, run by hand via ad-hoc one-off
# commands each time — (1) does the widget's index.jsx still parse as valid
# JS/JSX (the same class of syntax bug that crashed the widget mid-session
# lived here), and (2) does scripts/status_summary.py still run clean
# against a real ClaudeSpace folder. Re-deriving both commands by hand each
# round is exactly the "keep having to re-run this" pattern automation-scout
# looks for — genuinely repeated, genuinely low-risk (this script only
# reads and reports, it never writes to anything), so it's set up directly
# rather than just flagged.
#
# Generalized to every widget (2026-08-04), real gap found live: this only
# ever checked widgets/claudespace-status/index.jsx by hardcoded path, so
# tip-of-day/index.jsx had never actually been parse-checked by this script
# at all since it was built - a broken import in it would have passed
# "all checks passed" the whole time. Now loops over every widgets/*/index.jsx
# (excluding widgets/src/, the shared theme folder, which isn't a widget -
# see theme.config.js's own comment on why Übersicht itself already skips
# it) so a new widget gets covered automatically, no separate wiring needed
# per widget added.
#
# Usage: scripts/verify_widget.sh [path-to-ClaudeSpace]
# Exits non-zero if any check fails, so it's also usable as a quick
# pass/fail gate, not just human-readable output.
#
# Requires a JS parser capable of JSX on PATH (this repo doesn't vendor
# one) — pass its location via VERIFY_JSX_PARSER_DIR if it's not already
# discoverable, e.g. a sibling project's node_modules that happens to have
# @babel/parser installed (see this repo's own README for how this was
# first run, from Projects/recast/node_modules).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_SPACE="${1:-$HOME/Desktop/ClaudeSpace}"

echo "== verify_widget.sh =="

# --- 1. Every widget's JSX/JS parses cleanly ---
PARSER_DIR="${VERIFY_JSX_PARSER_DIR:-}"
if [ -z "$PARSER_DIR" ]; then
  for candidate in "$REPO_DIR/../recast" "$REPO_DIR/node_modules/.."; do
    if [ -d "$candidate/node_modules/@babel/parser" ]; then
      PARSER_DIR="$candidate"
      break
    fi
  done
fi

OVERALL_OK=0
for WIDGET_JSX in "$REPO_DIR"/widgets/*/index.jsx; do
  [ -e "$WIDGET_JSX" ] || continue
  WIDGET_NAME="$(basename "$(dirname "$WIDGET_JSX")")"
  if [ -n "$PARSER_DIR" ] && [ -d "$PARSER_DIR/node_modules/@babel/parser" ]; then
    (cd "$PARSER_DIR" && node -e "
      const parser = require('@babel/parser');
      const fs = require('fs');
      const src = fs.readFileSync('$WIDGET_JSX', 'utf8');
      try {
        parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
        console.log('[ok] $WIDGET_NAME/index.jsx parses cleanly');
      } catch (e) {
        console.error('[FAIL] $WIDGET_NAME/index.jsx parse error:', e.message);
        process.exit(1);
      }
    ") || OVERALL_OK=1
  else
    echo "[skip] no @babel/parser found nearby (set VERIFY_JSX_PARSER_DIR) - falling back to a plain backtick/brace balance check for $WIDGET_NAME"
    python3 - "$WIDGET_JSX" "$WIDGET_NAME" << 'EOF' || OVERALL_OK=1
import sys
src = open(sys.argv[1]).read()
name = sys.argv[2]
checks = [("backticks", src.count(chr(96)) % 2 == 0), ("braces", src.count("{") == src.count("}"))]
ok = True
for check_name, passed in checks:
    print(f"[{'ok' if passed else 'FAIL'}] {name}: {check_name} balanced")
    ok = ok and passed
sys.exit(0 if ok else 1)
EOF
  fi
done

# --- 1.5. No JSX fragment shorthand (2026-08-04, real bug found live) ---
# `<>...</>` parses as valid JS/JSX (step 1 above wouldn't catch this - it's
# a RUNTIME failure, not a syntax error) but crashes this environment at
# render time with "Can't find variable: React" - fragments desugar to
# React.Fragment, which needs a React global Übersicht doesn't inject here
# (every other element in these widgets compiles to plain function calls
# that don't need one). Found live when SkillsTab needed a second top-level
# sibling next to `card` - use a plain wrapper <div> instead (see
# claudespace-status/index.jsx's own comment where this happened).
for WIDGET_JSX in "$REPO_DIR"/widgets/*/index.jsx; do
  [ -e "$WIDGET_JSX" ] || continue
  WIDGET_NAME="$(basename "$(dirname "$WIDGET_JSX")")"
  if grep -qE '<>|</>' "$WIDGET_JSX"; then
    echo "[FAIL] $WIDGET_NAME/index.jsx uses JSX fragment shorthand (<>...</>) - known broken in this environment, use a plain wrapper div instead"
    OVERALL_OK=1
  else
    echo "[ok] $WIDGET_NAME/index.jsx has no JSX fragment shorthand"
  fi
done

# --- 1.6. No literal backticks inside /* ... */ CSS comments living
# INSIDE a css`...` template literal (2026-08-04, real bug hit TWICE
# live) - this file's `css` blocks are JS template literals; a
# `/* ... */` CSS comment written inside one is still literal
# template-literal source, so any backtick character inside it (e.g.
# writing `${NERV_BG}` as inline-code styling in prose) gets parsed as a
# real template-literal interpolation/terminator, not comment text -
# breaks the file with a confusing "Missing semicolon" error nowhere near
# the real cause. Babel's parser (step 1) DOES catch the resulting syntax
# error, but only after burning a round confused about why - this check
# points straight at the actual line instead.
#
# Scoped by JSX-comment shape, not css`...` boundary-matching (2026-08-04,
# fixed a SECOND time same day - the previous version, itself a same-day
# fix of an even earlier too-broad version, still missed a real instance
# live). That version scanned text between each `css\`` and its "own"
# closing backtick via `css\`(.*?)\``, found by regex - but a stray
# backtick INSIDE the offending comment IS, from the regex's own point of
# view, indistinguishable from that block's real closing backtick: it
# matched there first, silently truncating its own search window right
# before the bug it was supposed to catch. Caught by babel (step 1) with a
# useless "Unexpected token" error nowhere near line 1381, not by this
# check - the exact failure mode this check exists to prevent.
#
# New approach: don't try to locate css` bodies at all. Every legitimate
# `/* ... */` block in this file is EITHER a real CSS comment inside a
# css`...` template (no `{` before it) OR a JSX comment in the render tree,
# which is always written as `{/* ... */}` (curly-brace wrapped - true for
# every JSX comment in this file, checked live). So: find every `/* ... */`
# block in the whole file, skip the ones immediately preceded by `{`
# (real JSX comments, backticks there are harmless plain-JS prose), and
# flag a backtick in anything left over. Doesn't need to find matching
# template-literal boundaries at all, so a broken backtick can't hide from
# it the way it hid from the boundary-matching version.
for WIDGET_JSX in "$REPO_DIR"/widgets/*/index.jsx; do
  [ -e "$WIDGET_JSX" ] || continue
  WIDGET_NAME="$(basename "$(dirname "$WIDGET_JSX")")"
  python3 - "$WIDGET_JSX" "$WIDGET_NAME" << 'EOF' || OVERALL_OK=1
import re, sys
path, name = sys.argv[1], sys.argv[2]
src = open(path).read()
bad = False
for comment_match in re.finditer(r"/\*.*?\*/", src, re.DOTALL):
    start = comment_match.start()
    preceding = src[:start].rstrip()
    if preceding.endswith("{"):
        continue  # JSX comment ({/* ... */}) - plain JS, backticks harmless
    if chr(96) in comment_match.group(0):
        line_no = src.count("\n", 0, start) + 1
        print(f"[FAIL] {name}/index.jsx has a backtick inside a /* */ CSS comment starting near line {line_no} - breaks template-literal parsing, reword without backticks")
        bad = True
if not bad:
    print(f"[ok] {name}/index.jsx has no backticks inside CSS-template comments")
sys.exit(1 if bad else 0)
EOF
done

# --- 1.7. Skill Tray hex grid never computes wider than its own real
# boundary (2026-08-05, real bug found live via screenshot) - per the owner: "if
# something ever gets added and style or spacing makes it ever move past
# like a hard boundary where some of it gets cut off can we make a check
# for styling to make sure that never happens or is avoided?" The 4th hex
# column (10 skills, 3-per-column chunking) visibly bled past
# `skillsTrayBox`'s real right edge - fixed by capping the column COUNT
# instead of letting it grow unbounded (see claudespace-status/index.jsx's
# own `SKILL_HEX_COLUMNS` comment), but that fix is only as good as
# whoever edits `HEX_W`/`SKILL_HEX_COLUMNS` next remembering to re-check
# the math by hand. This check does that arithmetic for them: reads
# `SKILLS_TRAY_HEX_ROW_MAX_WIDTH`, `HEX_W`, and `SKILL_HEX_COLUMNS`
# straight out of the widget source (single source of truth stays in the
# JS file, not duplicated here) and fails loud if the same flat-top tiling
# formula the widget's own comments use (`HEX_W * (1 + 0.75 * (columns -
# 1))`) would ever produce a row wider than the boundary - same live-parity
# spirit as the backtick check above, just for a layout invariant instead
# of a syntax one.
CLAUDESPACE_WIDGET_JSX="$REPO_DIR/widgets/claudespace-status/index.jsx"
if [ -f "$CLAUDESPACE_WIDGET_JSX" ]; then
  python3 - "$CLAUDESPACE_WIDGET_JSX" << 'EOF' || OVERALL_OK=1
import re, sys
src = open(sys.argv[1]).read()

def read_const(name):
    m = re.search(rf"const {name}\s*=\s*(\d+)", src)
    return int(m.group(1)) if m else None

max_width = read_const("SKILLS_TRAY_HEX_ROW_MAX_WIDTH")
hex_w = read_const("HEX_W")
columns = read_const("SKILL_HEX_COLUMNS")

if max_width is None or hex_w is None or columns is None:
    print("[skip] Skill Tray hex boundary check - one of SKILLS_TRAY_HEX_ROW_MAX_WIDTH/HEX_W/SKILL_HEX_COLUMNS not found (widget may have been restructured)")
    sys.exit(0)

row_width = hex_w * (1 + 0.75 * (columns - 1))
if row_width > max_width:
    print(f"[FAIL] claudespace-status: hex grid row width ({row_width:.0f}px, HEX_W={hex_w} x {columns} columns) exceeds SKILLS_TRAY_HEX_ROW_MAX_WIDTH ({max_width}px) - hexes will visibly clip past the tray's edge; shrink HEX_W or reduce SKILL_HEX_COLUMNS")
    sys.exit(1)
print(f"[ok] claudespace-status: hex grid row width ({row_width:.0f}px) fits within its {max_width}px boundary")
EOF
fi

# --- 2. status_summary.py runs clean ---
if python3 "$REPO_DIR/scripts/status_summary.py" "$CLAUDE_SPACE" > /dev/null; then
  echo "[ok] status_summary.py runs clean against $CLAUDE_SPACE"
else
  echo "[FAIL] status_summary.py errored against $CLAUDE_SPACE"
  OVERALL_OK=1
fi

# --- 3. report_summary.py runs clean, if it exists (added 2026-08-04 for the
# now-retired report-viewer widget; now the only automated proof that
# report_summary.py still runs standalone, since status_summary.py just
# imports read-only loaders from it rather than exercising it directly) ---
if [ -f "$REPO_DIR/scripts/report_summary.py" ]; then
  if python3 "$REPO_DIR/scripts/report_summary.py" "$CLAUDE_SPACE" > /dev/null; then
    echo "[ok] report_summary.py runs clean against $CLAUDE_SPACE"
  else
    echo "[FAIL] report_summary.py errored against $CLAUDE_SPACE"
    OVERALL_OK=1
  fi
fi

if [ "$OVERALL_OK" -eq 0 ]; then
  echo "== all checks passed =="
else
  echo "== one or more checks FAILED =="
fi
exit "$OVERALL_OK"

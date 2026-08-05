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
# Scoped specifically to css`...` bodies (2026-08-04, fixed same day a
# first, too-broad version of this check shipped) - a first pass grepped
# EVERY /* */ block in the whole file, which false-positived on ordinary
# JSX comments (`{/* ... */}`) elsewhere that happen to mention a
# backtick-wrapped CSS selector in prose (e.g. "beats tinyStat's own
# `& strong` rule") - those live in plain JS, not inside a template
# literal, so a backtick there is completely harmless. This version only
# scans the text between each `css\`` and its OWN closing backtick (none
# of these css blocks use nested template literals, so the next literal
# backtick after `css\`` reliably is that block's own close).
for WIDGET_JSX in "$REPO_DIR"/widgets/*/index.jsx; do
  [ -e "$WIDGET_JSX" ] || continue
  WIDGET_NAME="$(basename "$(dirname "$WIDGET_JSX")")"
  python3 - "$WIDGET_JSX" "$WIDGET_NAME" << 'EOF' || OVERALL_OK=1
import re, sys
path, name = sys.argv[1], sys.argv[2]
src = open(path).read()
bad = False
for css_match in re.finditer(r"css`(.*?)`", src, re.DOTALL):
    body = css_match.group(1)
    body_start = css_match.start(1)
    for comment_match in re.finditer(r"/\*.*?\*/", body, re.DOTALL):
        if chr(96) in comment_match.group(0):
            line_no = src.count("\n", 0, body_start + comment_match.start()) + 1
            print(f"[FAIL] {name}/index.jsx has a backtick inside a /* */ comment inside a css` block, starting near line {line_no} - breaks template-literal parsing, reword without backticks")
            bad = True
if not bad:
    print(f"[ok] {name}/index.jsx has no backticks inside CSS-template comments")
sys.exit(1 if bad else 0)
EOF
done

# --- 2. status_summary.py runs clean ---
if python3 "$REPO_DIR/scripts/status_summary.py" "$CLAUDE_SPACE" > /dev/null; then
  echo "[ok] status_summary.py runs clean against $CLAUDE_SPACE"
else
  echo "[FAIL] status_summary.py errored against $CLAUDE_SPACE"
  OVERALL_OK=1
fi

# --- 3. report_summary.py runs clean, if it exists (2026-08-04, report-viewer) ---
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

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

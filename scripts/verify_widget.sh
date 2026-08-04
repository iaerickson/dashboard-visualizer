#!/usr/bin/env bash
# verify_widget.sh — automation-scout finding (2026-07-31, no-risk tier).
#
# What this replaces: every round of live widget iteration this session
# ended with the same two manual checks, run by hand via ad-hoc one-off
# commands each time — (1) does widgets/claudespace-status/index.jsx still
# parse as valid JS/JSX (the same class of syntax bug that crashed the
# widget mid-session lived here), and (2) does scripts/status_summary.py
# still run clean against a real ClaudeSpace folder. Re-deriving both
# commands by hand each round is exactly the "keep having to re-run this"
# pattern automation-scout looks for — genuinely repeated, genuinely
# low-risk (this script only reads and reports, it never writes to either
# file), so it's set up directly rather than just flagged.
#
# Usage: scripts/verify_widget.sh [path-to-ClaudeSpace]
# Exits non-zero if either check fails, so it's also usable as a quick
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
WIDGET_JSX="$REPO_DIR/widgets/claudespace-status/index.jsx"
CLAUDE_SPACE="${1:-$HOME/Desktop/ClaudeSpace}"

echo "== verify_widget.sh =="

# --- 1. JSX/JS parses cleanly ---
PARSER_DIR="${VERIFY_JSX_PARSER_DIR:-}"
if [ -z "$PARSER_DIR" ]; then
  for candidate in "$REPO_DIR/../recast" "$REPO_DIR/node_modules/.."; do
    if [ -d "$candidate/node_modules/@babel/parser" ]; then
      PARSER_DIR="$candidate"
      break
    fi
  done
fi

if [ -n "$PARSER_DIR" ] && [ -d "$PARSER_DIR/node_modules/@babel/parser" ]; then
  (cd "$PARSER_DIR" && node -e "
    const parser = require('@babel/parser');
    const fs = require('fs');
    const src = fs.readFileSync('$WIDGET_JSX', 'utf8');
    try {
      parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
      console.log('[ok] index.jsx parses cleanly');
    } catch (e) {
      console.error('[FAIL] index.jsx parse error:', e.message);
      process.exit(1);
    }
  ")
else
  echo "[skip] no @babel/parser found nearby (set VERIFY_JSX_PARSER_DIR) - falling back to a plain backtick/brace balance check"
  python3 - "$WIDGET_JSX" << 'EOF'
import sys
src = open(sys.argv[1]).read()
checks = [("backticks", src.count(chr(96)) % 2 == 0), ("braces", src.count("{") == src.count("}")), ("parens is not checked (unreliable - prose in comments)", True)]
ok = True
for name, passed in checks:
    if name.startswith("parens"):
        continue
    print(f"[{'ok' if passed else 'FAIL'}] {name} balanced")
    ok = ok and passed
sys.exit(0 if ok else 1)
EOF
fi

# --- 2. status_summary.py runs clean ---
if python3 "$REPO_DIR/scripts/status_summary.py" "$CLAUDE_SPACE" > /dev/null; then
  echo "[ok] status_summary.py runs clean against $CLAUDE_SPACE"
else
  echo "[FAIL] status_summary.py errored against $CLAUDE_SPACE"
  exit 1
fi

echo "== all checks passed =="

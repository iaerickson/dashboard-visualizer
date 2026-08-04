#!/usr/bin/env python3
"""
lifecycle_resort.py — Mechanically promotes quiet 🟢 Active projects to
🔵 Backlog in ClaudeSpace's INDEX.md, per Ian's confirmed threshold
(2026-08-04): "if an idea hasn't been touched or worked on in... 3 days
maybe we move it to the backlog." Part of the lifecycle re-design first
proposed 2026-07-31 (see ClaudeSpace/NEEDS-IAN.md's dashboard-visualizer
entry) - this implements the one piece that got a real, confirmed number
(Active -> Backlog). The Backlog -> Dormant 2-week-specific threshold and
the rest of that proposal are still open, NOT touched here.

UNLIKE status_summary.py/report_summary.py (this project's other two
scripts, both read-only against ClaudeSpace): this script WRITES to
ClaudeSpace's INDEX.md (flips the status emoji) and to the promoted
project's own README.md (appends a one-line dated Notes entry, same
"touch the README when the status changes" convention PROCESS.md's Review
step already calls for on a manual Pause). Flagging that difference
clearly since it's a real, deliberate exception to this project's normal
read-only posture - not an oversight.

Safety: defaults to DRY RUN (reports what it WOULD change, touches
nothing). Pass --apply to actually write. Every promotion is a single
emoji-character edit to one INDEX.md line plus one appended README line -
fully reversible via git (ClaudeSpace is a tracked local repo) or by
manually flipping the emoji back.

Usage:
    python3 lifecycle_resort.py <ClaudeSpace path>              # dry run
    python3 lifecycle_resort.py <ClaudeSpace path> --apply       # writes
"""
import re
import sys
from datetime import datetime
from pathlib import Path

ACTIVE_TO_BACKLOG_DAYS = 3

# Same line shape status_summary.py's parse_index_projects already knows -
# duplicated rather than imported (these two scripts are meant to stay
# independently runnable/testable, same reasoning report_summary.py's own
# small format-parsing helpers don't import from status_summary.py either).
PROJECT_LINE_RE = re.compile(r"^-\s+(🟢|🟡|⏸️|🔵|✅)\s+\[([^\]]+)\]\(([^)]+)\)")


def find_active_projects(index_text: str) -> list[dict]:
    projects = []
    for i, line in enumerate(index_text.splitlines()):
        m = PROJECT_LINE_RE.match(line.strip())
        if not m:
            continue
        emoji, name, link = m.groups()
        if emoji == "🟢":
            projects.append({"name": name, "link": link, "line_index": i, "line": line})
    return projects


def resolve_readme(claude_space: Path, link: str) -> Path | None:
    candidate = (claude_space / link).resolve() / "README.md"
    return candidate if candidate.exists() else None


def plan_promotions(claude_space: Path) -> list[dict]:
    index_path = claude_space / "INDEX.md"
    if not index_path.exists():
        return []
    index_text = index_path.read_text(errors="ignore")
    now_ts = datetime.now().timestamp()
    promotions = []
    for project in find_active_projects(index_text):
        readme_path = resolve_readme(claude_space, project["link"])
        if readme_path is None:
            # No folder/README (a bare idea-stage line tagged 🟢 by mistake,
            # or a broken link) - nothing to measure staleness against, skip
            # rather than guess.
            continue
        age_days = (now_ts - readme_path.stat().st_mtime) / 86400
        if age_days >= ACTIVE_TO_BACKLOG_DAYS:
            promotions.append(
                {
                    "name": project["name"],
                    "link": project["link"],
                    "readme_path": readme_path,
                    "age_days": round(age_days, 1),
                    "old_line": project["line"],
                    "new_line": project["line"].replace("🟢", "🔵", 1),
                }
            )
    return promotions


def apply_promotions(claude_space: Path, promotions: list[dict]) -> None:
    index_path = claude_space / "INDEX.md"
    index_text = index_path.read_text(errors="ignore")
    today = datetime.now().strftime("%Y-%m-%d")
    for promo in promotions:
        index_text = index_text.replace(promo["old_line"], promo["new_line"], 1)
        note = (
            f"\n- {today} — Auto-moved 🟢 Active → 🔵 Backlog by `lifecycle_resort.py` "
            f"— no README activity for {promo['age_days']} days (3-day threshold, per Ian 2026-08-04).\n"
        )
        readme_text = promo["readme_path"].read_text(errors="ignore")
        if "## Notes" in readme_text:
            readme_text = readme_text.replace("## Notes", "## Notes" + note, 1)
        else:
            readme_text = readme_text.rstrip() + "\n\n## Notes\n" + note
        promo["readme_path"].write_text(readme_text)
    index_path.write_text(index_text)


def main() -> int:
    args = sys.argv[1:]
    apply = "--apply" in args
    positional = [a for a in args if a != "--apply"]
    claude_space = Path(positional[0]) if positional else Path.home() / "Desktop" / "ClaudeSpace"

    if not claude_space.exists():
        print(f"ClaudeSpace folder not found at {claude_space}")
        return 1

    promotions = plan_promotions(claude_space)

    if not promotions:
        print("Nothing to promote - no Active project has gone 3+ days without a README touch.")
        return 0

    print(f"{'Applying' if apply else 'DRY RUN — would apply'} {len(promotions)} promotion(s):")
    for promo in promotions:
        print(f"  - {promo['name']} ({promo['age_days']}d untouched) -> Backlog")

    if apply:
        apply_promotions(claude_space, promotions)
        print("Done - INDEX.md and each project's README.md updated.")
    else:
        print("\nRe-run with --apply to actually write these changes.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
Tests for project_needs_ian_status (and its _goal_match_tokens helper) in
status_summary.py.

Covers the 2026-08-06 fix: a project with only ONE NEEDS-IAN.md entry
should behave exactly as before (that entry's own status, no matching
needed). A project with MULTIPLE entries should pick the entry that
actually matches the goal's own title+detail text, not just aggregate
"any open entry wins" - the real bug this fix closes (system-healthcheck's
signed-off stale-definition goal wouldn't cross off because two other,
unrelated open system-healthcheck entries existed).

Standard-library `unittest` on purpose (no pytest dependency), same
convention as Projects/dj-library-manager/tests/test_find_duplicates.py -
this environment doesn't have network access to install packages, and this
module only needs the standard library to run. Run with:
    python3 -m unittest discover tests
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from status_summary import (  # noqa: E402
    _goal_match_tokens,
    project_needs_ian_status,
)


def needs_ian_doc(*bullets: str) -> str:
    """Builds a minimal NEEDS-IAN.md-shaped string (just the '## List'
    section, which is all project_needs_ian_status actually reads) from a
    list of already-formatted '- 🤔/🚧/✅ ...' bullet lines."""
    return "# Needs Ian\n\n## List\n\n" + "\n".join(bullets) + "\n"


class GoalMatchTokensTests(unittest.TestCase):
    def test_strips_stopwords_and_excluded_project_name(self):
        tokens = _goal_match_tokens(
            "Sign off on `system-healthcheck`'s stale-project definition",
            exclude={"system-healthcheck", "system", "healthcheck"},
        )
        self.assertIn("stale-project", tokens)
        self.assertNotIn("system-healthcheck", tokens)
        self.assertNotIn("the", tokens)
        self.assertNotIn("sign", tokens)  # generic goal-phrasing stopword

    def test_short_tokens_dropped(self):
        tokens = _goal_match_tokens("a of to is it", exclude=set())
        self.assertEqual(tokens, set())


class ProjectNeedsIanStatusTests(unittest.TestCase):
    def test_no_entries_is_unknown(self):
        doc = needs_ian_doc("- 🤔 **`other-project`** — something unrelated.")
        self.assertEqual(project_needs_ian_status(doc, "system-healthcheck"), "unknown")

    def test_single_open_entry_ignores_goal_text(self):
        doc = needs_ian_doc("- 🤔 **`protoman`** — format not signed off yet.")
        # No goal_text passed at all - single-entry case never needed it before
        # this fix and still shouldn't.
        self.assertEqual(project_needs_ian_status(doc, "protoman"), "open")

    def test_single_resolved_entry_ignores_goal_text(self):
        doc = needs_ian_doc("- ✅ **Resolved** — `protoman` — format signed off.")
        self.assertEqual(project_needs_ian_status(doc, "protoman"), "resolved")

    def test_multiple_entries_picks_the_matching_one_resolved(self):
        """The real bug: system-healthcheck has one resolved entry (the
        signed-off stale-definition goal) and two unrelated open entries.
        The goal's own text should match the resolved entry specifically."""
        doc = needs_ian_doc(
            "- ✅ **Resolved (2026-08-06)** — `system-healthcheck` — stale "
            "definition + safe-to-delete convention, signed off. 30 days, "
            "no Notes, no checked sub-projects, `🗑️ Flagged stale` write-up "
            "built via `--write-flags`.",
            "- 🤔 **`system-healthcheck`** — report surface + recurring-"
            "schedule decisions. Where the health report actually lands.",
            "- 🚧 **`system-healthcheck` dependency-health pass** — blocked "
            "by sandbox network policy, not a decision.",
        )
        goal_text = (
            "Sign off on `system-healthcheck`'s stale-project definition "
            "30+ days untouched, no Notes, no checked sub-projects -> "
            "flagged '🗑️ Flagged stale'."
        )
        self.assertEqual(
            project_needs_ian_status(doc, "system-healthcheck", goal_text),
            "resolved",
        )

    def test_multiple_entries_picks_the_matching_one_open(self):
        """Same project, but this time the goal is actually about the
        still-open report-surface decision - should read open, not resolved,
        even though a resolved entry for the same project also exists."""
        doc = needs_ian_doc(
            "- ✅ **Resolved (2026-08-06)** — `system-healthcheck` — stale "
            "definition + safe-to-delete convention, signed off. 30 days, "
            "no Notes, no checked sub-projects.",
            "- 🤔 **`system-healthcheck`** — report surface + recurring-"
            "schedule decisions. Where the health report actually lands, "
            "likely dashboard-visualizer or daily-pull, and whether the "
            "consistency sweep gets its own recurring schedule.",
        )
        goal_text = (
            "Decide `system-healthcheck`'s report surface and recurring "
            "schedule - where should the health report actually land?"
        )
        self.assertEqual(
            project_needs_ian_status(doc, "system-healthcheck", goal_text),
            "open",
        )

    def test_multiple_entries_weak_match_falls_back_to_unknown(self):
        """No goal_text given at all, and a project with multiple entries -
        can't confidently pick one, so this must NOT silently guess."""
        doc = needs_ian_doc(
            "- ✅ **Resolved** — `system-healthcheck` — thing one done.",
            "- 🤔 **`system-healthcheck`** — thing two still open.",
        )
        self.assertEqual(project_needs_ian_status(doc, "system-healthcheck"), "unknown")

    def test_multiple_entries_unrelated_goal_text_falls_back_to_unknown(self):
        """goal_text is provided but shares nothing meaningful with either
        entry - should stay honest rather than pick one at random."""
        doc = needs_ian_doc(
            "- ✅ **Resolved** — `system-healthcheck` — stale definition signed off.",
            "- 🤔 **`system-healthcheck`** — report surface undecided.",
        )
        goal_text = "Pick a color scheme for the widget"
        self.assertEqual(
            project_needs_ian_status(doc, "system-healthcheck", goal_text),
            "unknown",
        )


if __name__ == "__main__":
    unittest.main()

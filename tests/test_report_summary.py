"""
Tests for report_summary.py's Reports Tray v2 (2026-08-08) functions -
the read/unread watermark helpers, the generic dated-archive enumeration,
and the three per-source content loaders.

Added 2026-08-08 for the final whole-branch review's Finding 3: every test
written during Plan A's implementation was a scratch file in /tmp, deleted
per this repo's previously-stated "no test convention" - which was
factually outdated by the time tests/test_status_summary.py landed
(added independently, unrelated to this branch). This file ports real
coverage for that gap, following test_status_summary.py's own convention:
standard-library `unittest`, no pytest dependency, run with:
    python3 -m unittest discover tests
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from report_summary import (  # noqa: E402
    is_unread,
    list_archive_instances,
    list_dated_files,
    load_dependency_audit_entry,
    load_log_entry,
    load_reports_viewed,
    load_usage_report_entry,
    save_reports_viewed,
)


class ReportsViewedRoundTripTests(unittest.TestCase):
    def test_missing_file_fails_open_to_empty_dict(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "reports_viewed.json"
            self.assertEqual(load_reports_viewed(config_path), {})

    def test_malformed_json_fails_open_to_empty_dict(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "reports_viewed.json"
            config_path.write_text("{not valid json")
            self.assertEqual(load_reports_viewed(config_path), {})

    def test_non_dict_json_fails_open_to_empty_dict(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "reports_viewed.json"
            config_path.write_text("[1, 2, 3]")
            self.assertEqual(load_reports_viewed(config_path), {})

    def test_save_then_load_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "reports_viewed.json"
            data = {"ianlogger": {"last_viewed_mtime": 123.456}}
            save_reports_viewed(config_path, data)
            self.assertEqual(load_reports_viewed(config_path), data)

    def test_save_creates_missing_parent_directory(self):
        """Finding 5 - save_reports_viewed used to crash with
        FileNotFoundError if config_path's parent dir didn't exist yet
        (e.g. a fresh checkout with no config/ directory)."""
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "nested" / "does" / "not" / "exist" / "reports_viewed.json"
            save_reports_viewed(config_path, {"a": 1})
            self.assertTrue(config_path.exists())
            self.assertEqual(json.loads(config_path.read_text()), {"a": 1})


class IsUnreadTests(unittest.TestCase):
    def test_id_based_no_watermark_is_unread(self):
        self.assertTrue(is_unread({}, instance_id="2026-08-05"))

    def test_id_based_newer_than_watermark_is_unread(self):
        self.assertTrue(is_unread({"last_viewed_id": "2026-08-04"}, instance_id="2026-08-05"))

    def test_id_based_at_or_before_watermark_is_read(self):
        viewed_entry = {"last_viewed_id": "2026-08-05"}
        self.assertFalse(is_unread(viewed_entry, instance_id="2026-08-05"))
        self.assertFalse(is_unread(viewed_entry, instance_id="2026-08-04"))

    def test_mtime_based_no_watermark_is_unread(self):
        self.assertTrue(is_unread({}, mtime=100.0))

    def test_mtime_based_newer_than_watermark_is_unread(self):
        self.assertTrue(is_unread({"last_viewed_mtime": 100.0}, mtime=200.0))

    def test_mtime_based_at_or_before_watermark_is_read(self):
        viewed_entry = {"last_viewed_mtime": 200.0}
        self.assertFalse(is_unread(viewed_entry, mtime=200.0))
        self.assertFalse(is_unread(viewed_entry, mtime=100.0))

    def test_both_args_raises_value_error(self):
        with self.assertRaises(ValueError):
            is_unread({}, instance_id="2026-08-05", mtime=100.0)

    def test_neither_arg_raises_value_error(self):
        with self.assertRaises(ValueError):
            is_unread({})


class ListDatedFilesTests(unittest.TestCase):
    def test_sorts_oldest_to_newest_by_filename(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for stem in ["2026-08-06", "2026-08-04", "2026-08-05"]:
                (root / f"{stem}.md").write_text(f"# {stem}\n")
            files = list_dated_files(root)
            self.assertEqual([p.stem for p in files], ["2026-08-04", "2026-08-05", "2026-08-06"])

    def test_finds_archived_month_and_year_subdirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "2026-08-07.md").write_text("# 2026-08-07\n")
            (root / "2026-07").mkdir()
            (root / "2026-07" / "2026-07-15.md").write_text("# 2026-07-15\n")
            (root / "2025" / "2025-12").mkdir(parents=True)
            (root / "2025" / "2025-12" / "2025-12-31.md").write_text("# 2025-12-31\n")
            files = list_dated_files(root)
            self.assertEqual(
                [p.stem for p in files],
                ["2025-12-31", "2026-07-15", "2026-08-07"],
            )

    def test_ignores_non_dated_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "2026-08-07.md").write_text("# 2026-08-07\n")
            (root / "README.md").write_text("not a dated file\n")
            files = list_dated_files(root)
            self.assertEqual([p.stem for p in files], ["2026-08-07"])

    def test_empty_dir_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(list_dated_files(Path(tmp)), [])


def _content_loader(path):
    return {"path": str(path)}


class ListArchiveInstancesTests(unittest.TestCase):
    def _make_archive(self, root, stems):
        for stem in stems:
            (root / f"{stem}.md").write_text(f"# {stem}\n\nbody\n")

    def test_empty_archive_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(list_archive_instances(Path(tmp), {}, _content_loader), [])

    def test_nothing_viewed_returns_all_instances_unread(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_archive(root, ["2026-08-04", "2026-08-05", "2026-08-06"])
            instances = list_archive_instances(root, {}, _content_loader)
            self.assertEqual([i["id"] for i in instances], ["2026-08-04", "2026-08-05", "2026-08-06"])
            self.assertTrue(all(i["viewed"] is False for i in instances))

    def test_fully_read_retains_only_newest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_archive(root, ["2026-08-04", "2026-08-05", "2026-08-06"])
            viewed_entry = {"last_viewed_id": "2026-08-06"}
            instances = list_archive_instances(root, viewed_entry, _content_loader)
            self.assertEqual([i["id"] for i in instances], ["2026-08-06"])
            self.assertTrue(instances[0]["viewed"])

    def test_mid_watermark_retains_unread_plus_newest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_archive(root, ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"])
            # watermark at 05: 04 and 05 are read, 06/07 unread. Newest
            # (07) is unread anyway here, so this exercises the "unread"
            # branch and the general mid-watermark shape.
            viewed_entry = {"last_viewed_id": "2026-08-05"}
            instances = list_archive_instances(root, viewed_entry, _content_loader)
            by_id = {i["id"]: i for i in instances}
            self.assertNotIn("2026-08-04", by_id)
            self.assertIn("2026-08-05", by_id)
            self.assertTrue(by_id["2026-08-05"]["viewed"])
            self.assertIn("2026-08-06", by_id)
            self.assertFalse(by_id["2026-08-06"]["viewed"])
            self.assertIn("2026-08-07", by_id)
            self.assertFalse(by_id["2026-08-07"]["viewed"])

    def test_watermark_equal_instance_retained_even_when_not_newest(self):
        """Finding 1 fix: the instance whose id exactly equals the current
        watermark must stay in the returned list even when it's neither
        unread nor the newest - otherwise a just-read backlog hex vanishes
        on the very next poll while its overlay might still be open."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_archive(root, ["2026-08-04", "2026-08-05", "2026-08-06"])

            # click 04 -> watermark becomes 04. 04 is read but IS the
            # watermark, so it must be retained; 05/06 still unread.
            viewed_entry = {"last_viewed_id": "2026-08-04"}
            instances = list_archive_instances(root, viewed_entry, _content_loader)
            by_id = {i["id"]: i for i in instances}
            self.assertEqual(set(by_id), {"2026-08-04", "2026-08-05", "2026-08-06"})
            self.assertTrue(by_id["2026-08-04"]["viewed"])
            self.assertFalse(by_id["2026-08-05"]["viewed"])
            self.assertFalse(by_id["2026-08-06"]["viewed"])

            # click 05 -> watermark becomes 05. 04 is now read AND not the
            # watermark, so it correctly drops away; 05 is read but IS the
            # new watermark, so it's retained; 06 still unread.
            viewed_entry = {"last_viewed_id": "2026-08-05"}
            instances = list_archive_instances(root, viewed_entry, _content_loader)
            by_id = {i["id"]: i for i in instances}
            self.assertNotIn("2026-08-04", by_id)
            self.assertIn("2026-08-05", by_id)
            self.assertTrue(by_id["2026-08-05"]["viewed"])
            self.assertIn("2026-08-06", by_id)
            self.assertFalse(by_id["2026-08-06"]["viewed"])

    def test_content_is_merged_onto_each_instance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_archive(root, ["2026-08-04"])
            instances = list_archive_instances(root, {}, _content_loader)
            self.assertEqual(instances[0]["path"], str(root / "2026-08-04.md"))


class LoadLogEntryTests(unittest.TestCase):
    def test_parses_date_and_strips_heading(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "2026-08-04.md"
            path.write_text("# 2026-08-04\n\nDid some real work today.\n\nSecond paragraph.\n")
            entry = load_log_entry(path)
            self.assertEqual(entry["date"], "2026-08-04")
            self.assertIn("Did some real work today.", entry["text"])
            self.assertIn("Second paragraph.", entry["text"])
            self.assertNotIn("# 2026-08-04", entry["text"])
            self.assertIsInstance(entry["hours_ago"], float)

    def test_non_dated_filename_yields_none_hours_ago(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "not-a-date.md"
            path.write_text("# not-a-date\n\nbody\n")
            entry = load_log_entry(path)
            self.assertIsNone(entry["hours_ago"])
            self.assertEqual(entry["date"], "not-a-date")


class LoadUsageReportEntryTests(unittest.TestCase):
    def test_parses_title_and_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "2026-08-04.md"
            path.write_text(
                "# \U0001f319 Morning Report — for 2026-08-04\n\n"
                "## Completed tonight\n\n"
                "- **First** thing done.\n"
                "- Second thing done.\n\n"
                "## Still needs you\n\n"
                "- Something pending.\n"
                "not a bullet, should be ignored\n"
            )
            entry = load_usage_report_entry(path)
            self.assertEqual(entry["title"], "\U0001f319 Morning Report — for 2026-08-04")
            self.assertEqual(
                entry["sections"]["Completed tonight"],
                ["First thing done.", "Second thing done."],
            )
            self.assertEqual(entry["sections"]["Still needs you"], ["Something pending."])
            self.assertIsInstance(entry["hours_ago"], float)
            self.assertGreaterEqual(entry["hours_ago"], 0)

    def test_missing_title_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "2026-08-04.md"
            path.write_text("## Completed tonight\n\n- A thing.\n")
            entry = load_usage_report_entry(path)
            self.assertIsNone(entry["title"])


class LoadDependencyAuditEntryTests(unittest.TestCase):
    def test_parses_title(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "2026-08-04.md"
            path.write_text("# Dependency Audit — 2026-08-04\n\n## The short version\n\nSome prose.\n")
            entry = load_dependency_audit_entry(path)
            self.assertEqual(entry["title"], "Dependency Audit — 2026-08-04")
            self.assertEqual(entry["path"], str(path))

    def test_missing_title_falls_back_to_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "2026-08-04.md"
            path.write_text("no heading here, just prose.\n")
            entry = load_dependency_audit_entry(path)
            self.assertEqual(entry["title"], "Dependency Audit")


if __name__ == "__main__":
    unittest.main()

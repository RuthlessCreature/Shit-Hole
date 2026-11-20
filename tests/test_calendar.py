import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from logic_b_work.fetch_history_window import read_calendar_json, select_sessions


class CalendarTest(unittest.TestCase):
    def test_nontrading_weekday_is_not_inferred(self):
        sessions = select_sessions(date(2026, 11, 20), 3, [
            '2026-11-16', '2026-11-17', '2026-11-19'])
        self.assertEqual(sessions, ['2026-11-16', '2026-11-17', '2026-11-19'])

    def test_incomplete_calendar_is_failure(self):
        with self.assertRaisesRegex(RuntimeError, 'CALENDAR_INCOMPLETE'):
            select_sessions(date(2026, 11, 20), 20, ['2026-11-18'])

    def test_source_is_required_in_offline_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'calendar.json'
            file.write_text(json.dumps({'trade_dates': ['2026-11-18']}))
            with self.assertRaisesRegex(RuntimeError, 'CALENDAR_UNVERIFIED'):
                read_calendar_json(file)


if __name__ == '__main__':
    unittest.main()

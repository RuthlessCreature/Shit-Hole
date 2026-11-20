"""Fetch actual trading sessions, not an approximation of Monday-Friday.

  TOP369_API_KEY=... python logic_b_work/fetch_history_window.py --end 2026-11-20
  python logic_b_work/fetch_history_window.py --end 2026-11-18 \
      --calendar-json /path/to/verified_trading_calendar.json

Offline calendar schema: {"source": "BaoStock", "trade_dates": ["YYYY-MM-DD", ...]}.
Never assume a weekday is a trading session when the calendar is unavailable.
"""
import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    from .ingest_369_snapshot import request, rows_of
except ImportError:
    from ingest_369_snapshot import request, rows_of

ROOT = Path(__file__).resolve().parent / 'verified_snapshots'


def baostock_trade_days(end, sessions):
    try:
        import baostock as bs
    except ImportError as exc:
        raise RuntimeError('NO_BAOSTOCK: pip install baostock or pass --calendar-json') from exc
    begin = (end - timedelta(days=max(60, sessions * 5))).isoformat()
    login = bs.login()
    if login.error_code != '0':
        raise RuntimeError('BAOSTOCK_LOGIN_FAILED: ' + login.error_msg)
    try:
        rs = bs.query_trade_dates(start_date=begin, end_date=end.isoformat())
        if rs.error_code != '0':
            raise RuntimeError('BAOSTOCK_CALENDAR_FAILED: ' + rs.error_msg)
        result = []
        while rs.next():
            row = dict(zip(rs.fields, rs.get_row_data()))
            if row.get('is_trading_day') == '1':
                result.append(row['calendar_date'])
        return result
    finally:
        bs.logout()


def select_sessions(end, sessions, trading_dates):
    if sessions <= 0:
        raise ValueError('sessions must be positive')
    parsed = sorted({date.fromisoformat(str(d)) for d in trading_dates})
    days = [d.isoformat() for d in parsed if d <= end]
    if len(days) < sessions:
        raise RuntimeError(f'CALENDAR_INCOMPLETE: need {sessions} sessions <= {end}, got {len(days)}')
    return days[-sessions:]


def read_calendar_json(path):
    payload = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(payload, dict) or not payload.get('source'):
        raise RuntimeError('CALENDAR_UNVERIFIED: file needs source and trade_dates')
    if not isinstance(payload.get('trade_dates'), list):
        raise RuntimeError('CALENDAR_UNVERIFIED: trade_dates must be a date array')
    return payload['trade_dates'], payload['source']


def run(end, sessions=20, calendar_json=None, output_dir=ROOT):
    end_day = date.fromisoformat(end)
    if calendar_json:
        calendar, origin = read_calendar_json(calendar_json)
    else:
        calendar, origin = baostock_trade_days(end_day, sessions), 'BaoStock query_trade_dates'
    days = select_sessions(end_day, sessions, calendar)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    complete, errors = [], []
    for i, d in enumerate(days, 1):
        dest = output_dir / (d.replace('-', '') + '_provider.json')
        try:
            if dest.exists():
                payload = json.loads(dest.read_text(encoding='utf-8'))
                cached = True
            else:
                payload = request(d, os.getenv('TOP369_API_KEY'))
                cached = False
            rows = rows_of(payload)
            if len(rows) < 3000:
                raise RuntimeError('unexpected low coverage ' + str(len(rows)))
            if not cached:
                dest.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
            complete.append({'date': d, 'rows': len(rows), 'cached': cached})
            print('HISTORY', i, '/', len(days), d, 'CACHED' if cached else 'OK', len(rows), flush=True)
        except Exception as exc:
            errors.append({'date': d, 'error': str(exc)[:300]})
            print('HISTORY_STOP', d, str(exc)[:300], flush=True)
            break  # No authorization/rate-limit bypass or retries.
    manifest = {'requested_days': days, 'calendar_source': origin,
                'tested_utc': datetime.now(timezone.utc).isoformat(),
                'complete': complete, 'errors': errors}
    (output_dir / 'history_manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('SUMMARY', len(complete), '/', len(days), 'errors', len(errors), flush=True)
    return 0 if not errors and len(complete) == len(days) else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--end', default=date.today().isoformat())
    parser.add_argument('--sessions', type=int, default=20)
    parser.add_argument('--calendar-json', type=Path)
    parser.add_argument('--output-dir', type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        return run(args.end, args.sessions, args.calendar_json, args.output_dir)
    except (RuntimeError, ValueError) as exc:
        print('HISTORY_NOT_STARTED:', str(exc))
        return 3


if __name__ == '__main__':
    raise SystemExit(main())

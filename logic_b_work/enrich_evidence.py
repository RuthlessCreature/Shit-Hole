"""Logic B evidence ingestion, independent of Radar/双喜.

Commands:
  python enrich_evidence.py status
  TOP369_API_KEY=... python enrich_evidence.py financial --limit 10
  python enrich_evidence.py announcements --input source_announcements.json
  python enrich_evidence.py bonds --input exchange_bonds.csv

No screening gates. Missing sources stay missing, not inferred. Writes are atomic.
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = ROOT / 'verified_snapshots'
OUT = BASE / 'evidence'
OUT.mkdir(parents=True, exist_ok=True)
ASOF = '2026-11-18'


def atomic_json(path, obj):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)


def stock_codes():
    p = BASE / 'logic_b_all_instruments.json'
    if p.exists():
        obj = json.loads(p.read_text(encoding='utf-8'))
        for container in ('rows', 'instruments', 'all'):
            if isinstance(obj.get(container), list):
                return sorted({r['code'] for r in obj[container] if r.get('asset') == 'A股'})
    with (BASE / '20261118_normalized.csv').open(encoding='utf-8-sig') as f:
        return sorted({r['code'] for r in csv.DictReader(f) if r['asset'] == 'A股'})


def fetch_financial(code, key, report_date=None):
    qs = {'code': code}
    if report_date:
        qs['report_date'] = report_date
    url = 'https://api.369.top/api/a/stock/financial?' + urllib.parse.urlencode(qs)
    req = urllib.request.Request(url, headers={'X-API-Key': key, 'Accept': 'application/json',
                                               'User-Agent': 'logic-b-evidence/1.0'})
    with urllib.request.urlopen(req, timeout=30) as res:
        obj = json.load(res)
    if not isinstance(obj, dict) or obj.get('code') not in (None, 0, 200):
        raise ValueError('provider error envelope')
    payload = obj.get('data', obj)
    if not isinstance(payload, dict) or not isinstance(payload.get('fields'), dict):
        raise ValueError('financial response missing fields dictionary')
    return payload


def fetch_st_list(key, date):
    url = 'https://api.369.top/api/a/stock/st_list?' + urllib.parse.urlencode(
        {'date': date, 'sec_type': 'stock'})
    req = urllib.request.Request(url, headers={'X-API-Key': key, 'Accept': 'application/json',
                                               'User-Agent': 'logic-b-evidence/1.0'})
    with urllib.request.urlopen(req, timeout=30) as res:
        obj = json.load(res)
    if not isinstance(obj, dict) or obj.get('code') not in (None, 0, 200):
        raise ValueError('provider error envelope')
    payload = obj.get('data', obj)
    if not isinstance(payload, dict) or not isinstance(payload.get('rows'), list):
        raise ValueError('ST response has no rows')
    if not str(payload.get('date', ''))[:10] <= date:
        raise ValueError('ST snapshot is from the future')
    if int(payload.get('total', len(payload['rows']))) != len(payload['rows']):
        raise ValueError('ST total does not match row count')
    return payload


def historical_st(args):
    key = os.environ.get('TOP369_API_KEY')
    if not key:
        print('NO_API_KEY: TOP369_API_KEY is not set; historical ST status unavailable')
        return 3
    try:
        payload = fetch_st_list(key, args.date)
    except urllib.error.HTTPError as e:
        print(f'HTTP_{e.code}: ST list not retrieved')
        return 3
    # A single date-wide call replaces name-based as-of approximation.
    codes = set(stock_codes())
    seen = set()
    rows = []
    for r in payload['rows']:
        code = str(r.get('code', '')).lower()
        if code in seen or code not in codes:
            raise ValueError('ST list contains unknown/duplicate A share code: ' + code)
        seen.add(code)
        rows.append({'code': code, 'name_asof': r.get('name', ''), 'is_st_asof': True})
    atomic_json(OUT / f'st_{args.date.replace("-", "")}.json',
                {'requested_date': args.date, 'actual_snapshot_date': payload['date'],
                 'source': '369:/api/a/stock/st_list', 'records': rows,
                 'a_share_universe_size': len(codes), 'asof_verified': True})
    print(json.dumps({'asof': args.date, 'snapshot_date': payload['date'],
                      'st_count': len(rows), 'a_share_universe': len(codes)}, ensure_ascii=False))
    return 0


def financial(args):
    key = os.environ.get('TOP369_API_KEY')
    if not key:
        print('NO_API_KEY: TOP369_API_KEY is not set; no financial values fabricated')
        return 3
    codes = stock_codes()
    if args.limit:
        codes = codes[:args.limit]
    records = {}
    failures = {}
    period_suffix = (args.report_date or 'latest').replace('-', '')
    target = OUT / f'financial_{ASOF.replace("-", "")}_{period_suffix}.json'
    if target.exists():
        old = json.loads(target.read_text(encoding='utf-8'))
        if old.get('reported_period_requested') != args.report_date:
            raise ValueError('financial resume period mismatch')
        records = old.get('records', {})
        failures = old.get('failures', {})
    aborted_reason = None
    attempted = 0
    for code in codes:
        if code in records:
            continue
        attempted += 1
        try:
            x = fetch_financial(code, key, args.report_date)
            # The API advertises report-period snapshots, not the initial public disclosure
            # timestamp. Therefore these fields cannot yet be called PIT verified.
            records[code] = {'fields': x['fields'], 'reported_period_requested': args.report_date,
                             'source': '369:/api/a/stock/financial', 'pit_verified': False,
                             'retrieved_utc': datetime.now(timezone.utc).isoformat()}
        except urllib.error.HTTPError as e:
            failures[code] = f'HTTP_{e.code}'
            if e.code in (401, 403, 429):
                aborted_reason = f'HTTP_{e.code}_PERMISSION_OR_RATE_LIMIT'
                break  # Stop on permission/rate limit. No retry evasion.
        except (TimeoutError, urllib.error.URLError):
            failures[code] = 'NETWORK_UNAVAILABLE'
            aborted_reason = 'NETWORK_UNAVAILABLE'
            break  # No 5,580 consecutive waits if environment has no route.
        except Exception as e:
            failures[code] = type(e).__name__
        if attempted % args.checkpoint_every == 0:
            atomic_json(target, {'asof': ASOF, 'reported_period_requested': args.report_date,
                                 'records': records, 'failures': failures, 'not_pit_verified': True})
        if args.interval:
            time.sleep(args.interval)
    atomic_json(target, {'asof': ASOF, 'reported_period_requested': args.report_date,
                         'records': records, 'failures': failures,
                         'attempted_this_run': attempted, 'aborted_reason': aborted_reason,
                         'not_pit_verified': True,
                         'warning': 'Cannot join 2026-11-18 prices until report publication timestamp is verified'})
    print(json.dumps({'requested': len(codes), 'stored': len(records),
                      'failed_count': len(failures), 'aborted_reason': aborted_reason}, ensure_ascii=False))
    return 0 if len(records) == len(codes) else 2


def announcements(args):
    # Ingest a provider-exported JSON array with explicit announcement date and source URL.
    # This method makes no undocumented claim that a private endpoint is stable.
    rows = json.loads(args.input.read_text(encoding='utf-8'))
    if not isinstance(rows, list):
        raise ValueError('announcement input must be JSON array')
    clean, rejected = [], []
    for i, r in enumerate(rows):
        try:
            code = str(r['code']).lower()
            published = str(r['published_at'])
            url = str(r['source_url'])
            if not (len(code) == 8 and code[:2] in ('sh', 'sz', 'bj')
                    and code[2:].isdigit() and published[:10] <= ASOF
                    and url.startswith('https://')):
                raise ValueError('invalid or after as-of')
            clean.append({'code': code, 'published_at': published, 'title': str(r['title']),
                          'source_url': url, 'event_type': str(r.get('event_type', '未分类')),
                          'source_provider': str(r.get('source_provider', '用户导入'))})
        except (KeyError, ValueError, TypeError):
            rejected.append(i)
    atomic_json(OUT / 'announcements_20261118.json',
                {'asof': ASOF, 'records': clean, 'rejected_input_indices': rejected})
    print(json.dumps({'accepted': len(clean), 'rejected': len(rejected)}, ensure_ascii=False))
    return 0 if not rejected else 2


def bonds(args):
    # CSV adapter accepts exchange/issuer/bond master. No price or yield invented.
    required = {'exchange', 'bond_code', 'bond_name', 'issuer', 'source_url', 'retrieved_at'}
    records, rejected = [], []
    with args.input.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not required.issubset(reader.fieldnames or []):
            raise ValueError('missing required columns: ' + ','.join(sorted(required - set(reader.fieldnames or []))))
        for i, r in enumerate(reader, start=2):
            if (r['exchange'] not in ('SSE', 'SZSE', 'IB') or not r['bond_code']
                    or not r['source_url'].startswith('https://')):
                rejected.append(i)
            else:
                records.append(r)
    atomic_json(OUT / 'credit_bonds_20261118.json',
                {'asof': ASOF, 'records': records, 'rejected_csv_lines': rejected,
                 'coverage_verified': False,
                 'note': 'Data import is not proof of exchange-wide completeness; prices, liquidity and recovery rates not inferred'})
    print(json.dumps({'imported': len(records), 'rejected': len(rejected)}, ensure_ascii=False))
    return 0 if not rejected else 2


def status(_args):
    print(json.dumps({'asof': ASOF, 'a_share_codes': len(stock_codes()),
                      'financial_api': 'documented; requires professional tier and key',
                      'financial_key_available': bool(os.environ.get('TOP369_API_KEY')),
                      'announcement_feed': 'official CNINFO and exchanges identified; full extraction not verified',
                      'credit_bond_feed': 'SSE/SZSE public catalogs identified; full bond master and daily pricing not verified',
                      'artifacts': [p.name for p in sorted(OUT.glob('*.json'))]}, ensure_ascii=False, indent=2))
    return 0


def coverage(_args):
    """Zero-gate outer join: every A-share survives even if evidence is missing."""
    codes = stock_codes()
    stock_set = set(codes)
    st_file = OUT / f'st_{ASOF.replace("-", "")}.json'
    st = json.loads(st_file.read_text(encoding='utf-8')) if st_file.exists() else None
    st_codes = {r['code'] for r in st['records']} if st else set()
    fin_files = sorted(OUT.glob(f'financial_{ASOF.replace("-", "")}_*.json'))
    financial_by_code = {}
    for p in fin_files:
        obj = json.loads(p.read_text(encoding='utf-8'))
        for code, r in obj.get('records', {}).items():
            financial_by_code.setdefault(code, []).append({'source_file': p.name,
                                                             'pit_verified': r.get('pit_verified', False)})
    event_file = OUT / f'announcements_{ASOF.replace("-", "")}.json'
    event = json.loads(event_file.read_text(encoding='utf-8')) if event_file.exists() else None
    events_by_code = {}
    if event:
        for r in event.get('records', []):
            events_by_code[r['code']] = events_by_code.get(r['code'], 0) + 1
    data = []
    for code in codes:
        fin = financial_by_code.get(code, [])
        data.append({'code': code,
                     'historical_st': (code in st_codes) if st else None,
                     'historical_st_source_present': bool(st),
                     'financial_snapshots': len(fin),
                     'financial_point_in_time_verified': any(r['pit_verified'] for r in fin),
                     'announcement_count': events_by_code.get(code) if event else None,
                     'announcements_source_present': bool(event)})
    summary = {'asof': ASOF, 'a_share_count': len(codes),
               'st_snapshot_available': bool(st),
               'st_count': len(st_codes) if st else None,
               'financial_codes_with_snapshot': len(stock_set & set(financial_by_code)),
               'financial_codes_pit_verified': sum(r['financial_point_in_time_verified'] for r in data),
               'announcements_source_present': bool(event),
               'codes_with_announcements': sum(bool(r['announcement_count']) for r in data),
               'credit_bond_full_coverage': False}
    atomic_json(OUT / 'coverage_20261118.json', {'summary': summary, 'rows': data})
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='command', required=True)
    sp = sub.add_parser('financial')
    sp.add_argument('--limit', type=int, default=0)
    sp.add_argument('--report-date')
    sp.add_argument('--interval', type=float, default=0.1)
    sp.add_argument('--checkpoint-every', type=int, default=25)
    sp = sub.add_parser('st')
    sp.add_argument('--date', default=ASOF)
    for name in ('announcements', 'bonds'):
        sub.add_parser(name).add_argument('--input', type=Path, required=True)
    sub.add_parser('status')
    sub.add_parser('coverage')
    args = p.parse_args()
    try:
        return {'financial': financial, 'st': historical_st, 'announcements': announcements,
                'bonds': bonds, 'status': status, 'coverage': coverage}[args.command](args)
    except Exception as e:
        print(type(e).__name__ + ': ' + str(e), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())

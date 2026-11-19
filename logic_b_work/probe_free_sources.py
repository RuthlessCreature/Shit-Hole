"""Low-volume, public/free-data connectivity probe for local Codex.

Optional dependencies: `pip install baostock akshare pandas`.
No credentials; no scraping bypass; each probe makes one small request.
Only probe results are saved; NOT a claim of full-market coverage.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent


def baostock_probe(day):
    import baostock as bs
    login = bs.login()
    if login.error_code != '0':
        raise RuntimeError('baostock login: ' + login.error_msg)
    try:
        rs = bs.query_history_k_data_plus(
            'sh.600567', 'date,code,open,high,low,close,volume,amount',
            start_date=day, end_date=day, frequency='d', adjustflag='3')
        if rs.error_code != '0':
            raise RuntimeError('baostock query: ' + rs.error_msg)
        data = []
        while rs.next():
            data.append(dict(zip(rs.fields, rs.get_row_data())))
        return {'underlying_origin': 'BaoStock', 'probe_code': 'sh600567',
                'returned_rows': len(data), 'sample': data[:2]}
    finally:
        bs.logout()


def ak_financial_probe():
    import akshare as ak
    # Public Eastmoney data. Signature/availability may change with AKShare version.
    df = ak.stock_balance_sheet_by_report_em(symbol='SH600567')
    return {'underlying_origin': '东方财富 via AKShare',
            'probe_code': 'sh600567', 'returned_rows': len(df),
            'columns': list(map(str, df.columns)),
            'sample': json.loads(df.head(1).to_json(orient='records', force_ascii=False))}


def ak_bond_probe():
    import akshare as ak
    # One page only: DO NOT interpret as the full bond market.
    df = ak.bond_zh_hs_spot(start_page='1', end_page='1')
    return {'underlying_origin': '新浪财经 via AKShare',
            'probe_pages': 1, 'returned_rows': len(df),
            'columns': list(map(str, df.columns)),
            'sample': json.loads(df.head(2).to_json(orient='records', force_ascii=False))}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--asof', default='2026-11-18')
    p.add_argument('--source', choices=['baostock', 'ak-financial', 'ak-bond', 'all'], default='all')
    p.add_argument('--output', type=Path)
    args = p.parse_args()
    funcs = {'baostock': lambda: baostock_probe(args.asof),
             'ak-financial': ak_financial_probe, 'ak-bond': ak_bond_probe}
    report = {'asof_requested': args.asof,
              'tested_utc': datetime.now(timezone.utc).isoformat(),
              'kind': 'single-symbol-or-single-page-connectivity_probe_NOT_full_market',
              'results': {}}
    for name, fn in funcs.items():
        if args.source not in ('all', name):
            continue
        try:
            x = fn()
            x['status'] = 'PROBE_SUCCEEDED_NOT_FULL_COVERAGE'
            report['results'][name] = x
        except Exception as e:
            report['results'][name] = {'status': 'PROBE_FAILED',
                                       'error_type': type(e).__name__,
                                       'error': str(e)[:400]}
    output = args.output or HERE / 'verified_snapshots' / 'free_source_probe.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: {'status': x['status'], 'rows': x.get('returned_rows')}
                      for k, x in report['results'].items()}, ensure_ascii=False))
    return 0 if all(x['status'] != 'PROBE_FAILED' for x in report['results'].values()) else 2


if __name__ == '__main__':
    sys.exit(main())

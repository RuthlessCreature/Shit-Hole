"""Independent Logic B one-day OHLCV ingestor (not connected to Radar).

Usage:
  TOP369_API_KEY=sk-... python ingest_369_snapshot.py --date 2026-11-18
  python ingest_369_snapshot.py --date 2026-11-18 --input-json ./downloaded.json

Never prints keys; no rate-limit or authorization circumvention. One date, one call.
"""
import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'verified_snapshots'
OUT.mkdir(parents=True,exist_ok=True)

def request(date,key):
    if not key:raise RuntimeError('NO_API_KEY: set TOP369_API_KEY; registration required by provider')
    endpoint='https://api.369.top/api/a/stock/day_kline?'+urllib.parse.urlencode({'date':date})
    req=urllib.request.Request(endpoint,headers={'X-API-Key':key,'Accept':'application/json','User-Agent':'logic-b-data-verifier/1.0'})
    try:
        with urllib.request.urlopen(req,timeout=35) as response:
            if response.status!=200:raise RuntimeError(f'HTTP_{response.status}')
            return json.load(response)
    except urllib.error.HTTPError as e:
        if e.code in (401,403):raise RuntimeError(f'HTTP_{e.code}_AUTH: invalid or insufficient provider access') from None
        if e.code==429:raise RuntimeError('HTTP_429_STOP: provider rate limit, no retry') from None
        raise RuntimeError(f'HTTP_{e.code}: source error') from None

def rows_of(payload):
    if isinstance(payload,list):return payload
    if not isinstance(payload,dict):raise ValueError('unexpected JSON envelope')
    if payload.get('code') not in (None,0,200) and payload.get('success') not in (True,):
        raise ValueError('provider returned error envelope')
    content=payload.get('data',payload)
    if isinstance(content,list):return content
    if isinstance(content,dict):
        for key in ('rows','items','data','list'):
            if isinstance(content.get(key),list):return content[key]
    raise ValueError('provider JSON contains no row array')

def normalize(raw,day):
    out=[];errors=[];seen=set()
    for i,x in enumerate(raw):
        if not isinstance(x,dict):errors.append({'row':i,'error':'not_object'});continue
        sym=str(x.get('code') or x.get('symbol') or '').lower().strip()
        if not sym or len(sym)<8:
            errors.append({'row':i,'error':'missing_symbol'});continue
        # day API also returns indices/ETFs/CB; retain separate asset classes.
        if sym.startswith(('sh','sz','bj')):
            market,code=sym[:2],sym[2:]
        else:
            errors.append({'row':i,'error':'bad_market_prefix','symbol':sym});continue
        if len(code)!=6 or not code.isdigit():
            errors.append({'row':i,'error':'bad_code','symbol':sym});continue
        d=str(x.get('date') or x.get('trade_date') or day)[:10]
        if d!=day:errors.append({'row':i,'error':'wrong_date','symbol':sym});continue
        if sym in seen:errors.append({'row':i,'error':'duplicate','symbol':sym});continue
        seen.add(sym)
        try:
            v={k:float(x[k]) if x.get(k) not in (None,'','-') else None for k in ('open','high','low','close','volume','amount','turnover')}
        except (ValueError,TypeError,KeyError):
            errors.append({'row':i,'error':'invalid_price_quantity','symbol':sym});continue
        if v['close'] is not None and v['close']<=0:
            errors.append({'row':i,'error':'nonpositive_close','symbol':sym});continue
        if all(v[z] is not None for z in ('open','high','low','close')):
            if v['high']<max(v['open'],v['close']) or v['low']>min(v['open'],v['close']):
                errors.append({'row':i,'error':'invalid_ohlc','symbol':sym});continue
        if v['volume'] is not None and v['volume']<0:
            errors.append({'row':i,'error':'negative_volume','symbol':sym});continue
        if ((market=='sh' and code.startswith(('60','68')))
            or (market=='sz' and code.startswith(('00','30')))
            or (market=='bj' and code.startswith(('92','83','87','43')))):
            asset='A股'
        elif code.startswith(('11','12','13')):asset='可转债候选'
        elif code.startswith(('51','15','56','58')):asset='ETF/基金候选'
        else:asset='其他证券'
        out.append({'code':sym,'name':x.get('name') or '', 'asset':asset,'trade_date':d,**v})
    return out,errors

def audit_price(rows,day):
    if day!='2026-11-18':return []
    quote_file=ROOT/'tencent_full_quotes.json'
    if not quote_file.exists():return []
    qs=json.loads(quote_file.read_text())['quotes']
    issues=[]
    for r in rows:
        if r['asset']!='A股' or r['close'] is None:continue
        q=qs.get(r['code'][2:]);
        if q and q.get('quote_time','').startswith('20261119'):
            prev=float(q['prev_close'])
            if abs(prev-r['close'])>0.011:
                issues.append({'code':r['code'],'snapshot_close':r['close'],'tencent_19_prev':prev,'gap':round(r['close']-prev,4)})
    return issues

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--date',default='2026-11-18');ap.add_argument('--input-json',type=Path);ap.add_argument('--min-a',type=int,default=5000);args=ap.parse_args()
    try:datetime.strptime(args.date,'%Y-%m-%d')
    except ValueError:raise SystemExit('DATE_FORMAT: YYYY-MM-DD required')
    try:
        payload=json.loads(args.input_json.read_text()) if args.input_json else request(args.date,os.getenv('TOP369_API_KEY'))
        raw=rows_of(payload)
        normalized,errors=normalize(raw,args.date)
        stats=Counter(x['asset'] for x in normalized)
        mismatches=audit_price(normalized,args.date)
        verdict='PASS' if stats['A股']>=args.min_a and len(errors)<100 else 'PARTIAL_OR_FAILED'
        stamp=args.date.replace('-','')
        # Preserve both provider response and normalized output for audit.
        (OUT/f'{stamp}_provider.json').write_text(json.dumps(payload,ensure_ascii=False))
        fields=['code','name','asset','trade_date','open','high','low','close','volume','amount','turnover']
        with (OUT/f'{stamp}_normalized.csv').open('w',newline='',encoding='utf-8-sig') as f:
            w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(normalized)
        report={'date':args.date,'retrieved_at':datetime.now(timezone.utc).isoformat(),
            'verdict':verdict,'provider_rows':len(raw),'normalized_rows':len(normalized),'assets':dict(stats),
            'errors':errors[:100],'price_crosscheck_mismatches':mismatches[:100],
            'mismatch_count':len(mismatches),'required_a_count':args.min_a,
            'notes':['zero screening gates: all asset rows retained',
                'asset class inferred by prefix: review issuer/classification before live use',
                'no 11/18 delisting/suspension list until separately ingested']}
        (OUT/f'{stamp}_audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({k:v for k,v in report.items() if k not in ('errors','price_crosscheck_mismatches','notes')},ensure_ascii=False))
        return 0 if verdict=='PASS' else 2
    except Exception as e:
        print('SOURCE_BLOCKED_OR_INVALID:',str(e),file=sys.stderr)
        return 3

if __name__=='__main__':sys.exit(main())

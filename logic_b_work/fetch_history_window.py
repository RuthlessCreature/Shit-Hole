"""Retrieve 20 complete trading-day cross-sections, one authorized request/date.
Usage: TOP369_API_KEY=... python3 fetch_history_window.py --end 2026-11-18 --sessions 20
"""
import argparse
import json
import os
from datetime import date,timedelta
from pathlib import Path
from ingest_369_snapshot import request,rows_of

ROOT=Path(__file__).resolve().parent/'verified_snapshots'
ROOT.mkdir(exist_ok=True)
ap=argparse.ArgumentParser();ap.add_argument('--end',default='2026-11-18');ap.add_argument('--sessions',type=int,default=20);args=ap.parse_args()
end=date.fromisoformat(args.end)
days=[];p=end
while len(days)<args.sessions:
    if p.weekday()<5:days.append(p.isoformat())
    p-=timedelta(days=1)
days.reverse()
complete=[];errors=[]
for i,d in enumerate(days,1):
    dest=ROOT/(d.replace('-','')+'_provider.json')
    if dest.exists():
        j=json.loads(dest.read_text());complete.append({'date':d,'rows':len(rows_of(j)),'cached':True})
        print('HISTORY',i,'/',len(days),d,'CACHED',len(rows_of(j)),flush=True)
        continue
    try:
        j=request(d,os.getenv('TOP369_API_KEY'))
        rows=rows_of(j)
        if len(rows)<3000:raise RuntimeError('unexpected low coverage '+str(len(rows)))
        dest.write_text(json.dumps(j,ensure_ascii=False))
        complete.append({'date':d,'rows':len(rows),'cached':False})
        print('HISTORY',i,'/',len(days),d,'OK',len(rows),flush=True)
    except Exception as e:
        errors.append({'date':d,'error':str(e)})
        print('HISTORY_STOP',d,str(e),flush=True)
        break
(ROOT/'history_manifest.json').write_text(json.dumps({'requested_days':days,'complete':complete,'errors':errors},ensure_ascii=False,indent=2))
print('SUMMARY',len(complete),'/',len(days),'errors',len(errors),flush=True)

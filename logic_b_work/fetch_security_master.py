"""Authorized 369 market security master, 100 entries/page, cache & stop on 429.
Names/types are current-day; historical status remains a separate data dimension.
"""
import concurrent.futures
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path(__file__).parent/'verified_snapshots'
PAGES=ROOT/'security_master_pages';PAGES.mkdir(exist_ok=True)
KEY=os.getenv('TOP369_API_KEY')
if not KEY:raise SystemExit('TOP369_API_KEY missing')

def load_page(i):
    p=PAGES/f'p{i:03}.json'
    if p.exists():return json.loads(p.read_text())
    req=urllib.request.Request(f'https://api.369.top/api/a/stock/list?page={i}&page_size=100',headers={'X-API-Key':KEY})
    try:
        with urllib.request.urlopen(req,timeout=35) as r:j=json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP_{e.code}_STOP' if e.code==429 else f'HTTP_{e.code}') from None
    if not isinstance(j.get('data',{}).get('list'),list):raise RuntimeError('BAD_LIST_ENVELOPE')
    p.write_text(json.dumps(j,ensure_ascii=False))
    return j

first=load_page(1)
total=first['data']['total'];pages=(total+99)//100
errors=[]
for start in range(2,pages+1,9):
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        tasks={ex.submit(load_page,i):i for i in range(start,min(pages+1,start+9))}
        for f in concurrent.futures.as_completed(tasks):
            try:f.result()
            except Exception as e:errors.append({'page':tasks[f],'error':str(e)})
    done=len(list(PAGES.glob('p*.json')))
    print('SECURITY_MASTER',done,'/',pages,'errors',len(errors),flush=True)
    if errors:break

master={}
for p in PAGES.glob('p*.json'):
    for x in json.loads(p.read_text())['data']['list']:
        market=x.get('market','').lower();code=x.get('code','')
        if market in ('sh','sz','bj') and len(code)==6:
            master[market+code]=x
report={'reported_total':total,'pages_required':pages,'pages_obtained':len(list(PAGES.glob('p*.json'))),
        'distinct_symbols':len(master),'errors':errors,'securities':master}
(ROOT/'security_master.json').write_text(json.dumps(report,ensure_ascii=False,indent=1))
print('MASTER_DONE',len(master),'/',total,'failed',len(errors),flush=True)

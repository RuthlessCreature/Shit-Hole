"""Logic B 2026-11-18: zero-gate, all instruments, evidence-level diagnostics.
Never imputes a valuation or classifies an observed loss as mispricing.
"""
import collections
import csv
import json
import statistics
from pathlib import Path

ROOT=Path(__file__).parent
SRC=ROOT/'verified_snapshots'
DATE='2026-11-18'
raw=list(csv.DictReader((SRC/'20261118_normalized.csv').open(encoding='utf-8-sig')))
masterfile=SRC/'security_master.json'
master=json.loads(masterfile.read_text()) if masterfile.exists() else {'securities':{},'pages_obtained':0,'pages_required':None}
names=json.loads((ROOT/'security_name_map.json').read_text()) if (ROOT/'security_name_map.json').exists() else {}
oldq=json.loads((ROOT/'tencent_full_quotes.json').read_text()).get('quotes',{}) if (ROOT/'tencent_full_quotes.json').exists() else {}
events=json.loads((ROOT/'event_snapshot_20261118.json').read_text()).get('rows',[]) if (ROOT/'event_snapshot_20261118.json').exists() else []
ev_by={e['code']:e for e in events}
hist=collections.defaultdict(dict)
dates=[]
for p in sorted(SRC.glob('2026????_provider.json')):
    d=p.stem[:8];date=f'{d[:4]}-{d[4:6]}-{d[6:]}'
    if date>DATE:continue
    try:
        x=json.loads(p.read_text())
        rr=x['data']['rows']
        dates.append(date)
        for r in rr:hist[r['code']][date]=r
    except Exception as e:print('INVALID_HISTORY',p.name,str(e)[:80],flush=True)
dates=sorted(set(dates))

def ratio(a,b):return a/b if b and a is not None else None
def num(x):
    try:return float(x) if x not in (None,'','-') else None
    except:return None

out=[]
for r in raw:
    sym=r['code'];code=sym[2:];m=master['securities'].get(sym,{})
    name=m.get('name') or names.get(sym,{}).get('name') or oldq.get(code,{}).get('name_quote') or ''
    typ=m.get('type') or r['asset']
    asset={'股票':'A股','可转债':'可转债','转债':'可转债','ETF':'ETF/基金','基金':'ETF/基金','指数':'指数'}.get(typ,r['asset'])
    if r['asset']=='可转债候选':asset='可转债'
    if r['asset']=='A股':asset='A股'
    if r['asset']=='其他证券':asset='指数' if sym.startswith(('sh00','sh88','sz39','bj89')) else '其他'
    if r['asset']=='ETF/基金候选':asset='ETF/基金'
    close=num(r['close']);vol=num(r['volume']);amount=num(r['amount']);turn=num(r['turnover']);
    series=hist.get(sym,{})
    prev_dates=[d for d in dates if d<DATE and d in series]
    prev=series[prev_dates[-1]] if prev_dates else None
    prevclose=num(prev.get('close')) if prev else None
    pct=ratio(close,prevclose)-1 if prevclose and close else None
    p5=prev_dates[-5:]
    mean_vol=statistics.mean(num(series[d].get('volume')) or 0 for d in p5) if p5 else None
    vr=ratio(vol,mean_vol)
    d5=prev_dates[-5] if len(prev_dates)>=5 else None
    pct5=ratio(close,num(series[d5].get('close')))-1 if d5 and close else None
    anchor=[num(series[d].get('close')) for d in dates[-20:] if d in series]
    drawdown=close/max(anchor)-1 if anchor and close else None
    count1=0
    for d in reversed(dates):
        row=series.get(d)
        if not row:break
        if (num(row.get('volume')) or 0)<=0:break
        if (num(row.get('close')) or 999)>=1:break
        count1+=1
    st=('ST' in name.upper());suspended=(vol or 0)==0
    # Zero-volume prices are carried/reference marks, not executable daily closes.
    # In particular, some directional convertibles change marked prices with no trades.
    if suspended:
        pct=None
        pct5=None
        drawdown=None
    e=ev_by.get(code)
    tags=[]
    if asset=='A股':
        if st:tags.append('ST风险警示')
        if close and close<1:tags.append('低于1元')
        elif close and close<=1.2:tags.append('1—1.2元面值观察')
        if suspended:tags.append('11/18无成交/停牌')
        if pct is not None and pct<=-0.07:tags.append('单日跌幅≥7%')
        if pct5 is not None and pct5<=-0.20:tags.append('5日回撤≥20%')
        if vr is not None and vr>=2:tags.append('成交量≥5日均量2倍')
        if turn is not None and turn>=20:tags.append('换手率≥20%')
        if e and e.get('event') in ('跌停','涨停'):tags.append('18日'+e['event']+'事件')
    elif asset=='可转债':
        if close and close<90:tags.append('债价低于90')
        elif close and close<100:tags.append('债价低于100')
        if pct is not None and pct<=-0.05:tags.append('单日跌幅≥5%')
        if vr is not None and vr>=2:tags.append('成交量≥5日均量2倍')
        if suspended:tags.append('11/18无成交')
    # Price anomalies are only prompts for further research; valuation is unknown.
    score=(3 if asset=='A股' and close and close<1 else 0)+\
          (1 if st else 0)+(2 if pct is not None and pct<=-0.07 else 0)+\
          (2 if pct5 is not None and pct5<=-0.2 else 0)+\
          (1 if vr is not None and vr>=2 else 0)+\
          (1 if asset=='可转债' and close and close<90 else 0)
    out.append({'code':sym,'name':name,'asset':asset,'asset_source':typ,'date':DATE,
        'open':num(r['open']),'high':num(r['high']),'low':num(r['low']),'close':close,
        'volume_shares':vol,'amount_yuan':amount,'turnover_pct':turn,
        'prev_close':prevclose,'return_1d':pct,'return_5d':pct5,'drawdown_20d':drawdown,
        'volume_ratio_5d':vr,'below_one_consecutive_observed':count1,'is_st_name':st,
        'zero_volume':suspended,'event':e.get('event') if e else None,
        'signals':tags,'attention_score_not_value':score,
        'fair_value':None,'mispricing_pct':None,'mispricing_evidence':'未计算：缺企业权益价值/债券清偿价值及概率条件',
        'source':'369数据 2026-11-18 原始日K'} )

stats=collections.Counter(x['asset'] for x in out)
stock=[x for x in out if x['asset']=='A股'];cb=[x for x in out if x['asset']=='可转债']
summary={'date':DATE,'days_obtained':len(dates),'historical_dates':dates,
         'security_master_pages':master['pages_obtained'],'security_master_required':master['pages_required'],
         'asset_counts':dict(stats),'a_traded':sum(not x['zero_volume'] for x in stock),
         'a_zero_volume':sum(x['zero_volume'] for x in stock),
         'a_under1':sum(x['close']<1 for x in stock if x['close'] is not None),
         'a_under1_traded':sum(x['close']<1 and not x['zero_volume'] for x in stock if x['close'] is not None),
         'a_st_name':sum(x['is_st_name'] for x in stock),
         'a_down7':sum(x['return_1d'] is not None and x['return_1d']<=-0.07 for x in stock),
         'a_volume_shock':sum(x['volume_ratio_5d'] is not None and x['volume_ratio_5d']>=2 for x in stock),
         'a_below1_20sessions':sum(x['below_one_consecutive_observed']>=20 for x in stock),
         'a_observation_codes':sum(bool(x['signals']) for x in stock),
         'cb_observation_codes':sum(bool(x['signals']) for x in cb),
         'missing_names':sum(not x['name'] for x in out),
         'note':'无门禁；所有证券保留。观察标签不等于实际低估。连续低于1元是样本观察，不是交易所官方退市计数。'}
(SRC/'logic_b_all_instruments.json').write_text(json.dumps({'summary':summary,'rows':out},ensure_ascii=False))
print(json.dumps(summary,ensure_ascii=False,indent=1))

import { chinaToday } from './core.mjs';

export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Shit-Hole 逻辑B · 数据控制台</title>
<link rel="stylesheet" href="/assets/dashboard.css">
<script src="/assets/dashboard.js?v=20261123e" defer></script>
</head><body><div class="shell">
  <header class="masthead">
    <div><p class="eyebrow">SHIT-HOLE / LOGIC B</p><h1>市场错价研究 · 数据控制台</h1>
      <p class="subtitle">全量研究样本 · 沪深股票与可转债优先 · 人工决定实盘</p></div>
    <div class="live"><span class="pulse"></span><span id="connection">正在连接</span><small id="clock">--</small></div>
  </header>
  <main>
    <div class="notice"><strong>数据诚实声明</strong>：抓取成功 ≠ 独立全市场对账通过；历史行情 ≠ 合理估值。ST、停牌、零成交及高风险证券均不设研究排除门槛。</div>
    <section class="card-grid" aria-label="关键指标">
      <article class="card metric"><p>当日行情</p><strong id="daily-status">--</strong><span id="daily-sub">等待读取</span></article>
      <article class="card metric"><p>当日标准化记录</p><strong id="daily-rows">--</strong><span id="daily-assets">A股 / 可转债 待核实</span></article>
      <article class="card metric"><p>历史已存档</p><strong id="history-done">--</strong><span id="history-total">交易日分母待获取</span></article>
      <article class="card metric"><p>历史任务</p><strong id="history-state">--</strong><span id="history-attempts">运行模式待获取</span></article>
    </section>
    <section class="panel-grid">
      <article class="card detail">
        <div class="section-head"><h2>2020年以来历史回填</h2><span class="chip" id="history-chip">待初始化</span></div>
        <p class="muted" id="history-range">2020-01-01 — 2026-11-20</p>
        <div class="progress"><div id="history-bar" class="progress-fill"></div></div>
        <div class="stat-line"><span id="history-percent">0%</span><span id="history-breakdown">历史队列待创建</span></div>
        <div class="information"><div><span>调度</span><b>云端队列 · 一日完成立即接下一日</b></div><div><span>归档</span><b>R2原始JSON + 标准化JSONL</b></div><div><span>热数据</span><b>最近45自然日额外写D1</b></div><div><span>回填模式</span><b id="history-strategy">正在获取</b></div></div>
        <p class="footnote" id="history-error">暂无历史任务异常。</p>
      </article>
      <article class="card detail">
        <div class="section-head"><h2>当日增量采集</h2><span class="chip" id="daily-chip">尚无批次</span></div>
        <p class="muted">工作日北京时间18:20 · 不等于交易日历</p>
        <div class="information"><div><span>交易日期</span><b id="daily-date">--</b></div><div><span>数据源</span><b id="daily-source">--</b></div><div><span>最近批次</span><b id="daily-time">--</b></div><div><span>质量判定</span><b id="daily-quality">未验证</b></div></div>
        <p class="footnote" id="daily-message">未抓取的日期不会被前一天数据冒名顶替。</p>
      </article>
    </section>
    <section class="panel-grid">
      <article class="card detail"><div class="section-head"><h2>历史最近任务</h2><span class="chip" id="history-last">--</span></div>
        <div class="list" id="history-list"><p class="muted">正在查询历史运行记录…</p></div></article>
      <article class="card detail"><div class="section-head"><h2>来源探针</h2><span class="chip">只验证联通性</span></div>
        <div class="list" id="source-list"><p class="muted">正在查询数据源状态…</p></div>
        <p class="footnote">上交所、深交所、巨潮首页返回200不代表公告或财报接口可采集。</p></article>
    </section>
  </main>
  <footer><span>Shit-Hole · 逻辑B 独立研究系统</span><span id="refresh-time">每30秒自动刷新</span><span>行情、估值与可执行交易严格区分</span></footer>
</div></body></html>`;

export const DASHBOARD_CSS = `:root{font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#e9eef8;background:#0b1220;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 10% 0%,#172841 0%,#0b1220 42%,#090e19 100%)}.shell{max-width:1330px;margin:0 auto;padding:32px 24px 22px}.masthead{display:flex;justify-content:space-between;align-items:center;gap:28px;padding:7px 0 27px;border-bottom:1px solid #27364a}.eyebrow{font-size:12px;font-weight:800;color:#69b4ff;letter-spacing:.25em;margin:0 0 9px}.masthead h1{font-size:30px;line-height:1.35;letter-spacing:.01em;margin:0}.subtitle,.muted,.footnote{color:#91a2b8}.subtitle{font-size:14px;margin:10px 0 0}.live{display:flex;align-items:center;gap:9px;padding:11px 16px;background:#162337;border:1px solid #29415c;border-radius:12px;font-size:13px;white-space:nowrap}.live small{display:block;color:#91a2b8}.pulse{width:9px;height:9px;border-radius:50%;background:#49d1a5;box-shadow:0 0 0 4px #49d1a51e}.notice{margin:22px 0;padding:14px 18px;border-radius:12px;border:1px solid #354867;background:#16263a;color:#b7c8db;line-height:1.65;font-size:13px}.notice strong{color:#e6bd73}.card-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card{border:1px solid #25364e;background:linear-gradient(145deg,#152238,#101a2a);border-radius:15px;box-shadow:0 16px 38px #05091233}.metric{padding:22px 24px;min-height:152px;display:flex;flex-direction:column;justify-content:space-between}.metric p{font-size:13px;color:#a8bbd0;margin:0}.metric strong{font-size:30px;line-height:1.2;letter-spacing:-.04em;overflow-wrap:anywhere}.metric span{color:#8fa3bc;font-size:12px}.panel-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.detail{padding:23px 24px;min-height:285px}.section-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.section-head h2{font-size:17px;margin:0;letter-spacing:.02em}.chip{font-size:11px;padding:6px 9px;background:#26394b;color:#a6c8e9;border-radius:7px;white-space:nowrap}.detail>.muted{font-size:13px;margin:13px 0 20px}.progress{height:10px;background:#26344a;border-radius:12px;overflow:hidden;margin:21px 0 10px}.progress-fill{height:100%;width:0;background:linear-gradient(90deg,#347ee8,#63d1d0);transition:width .4s}.stat-line{display:flex;align-items:center;justify-content:space-between;color:#94aac1;font-size:12px;gap:8px}.stat-line span:first-child{color:#d7e7f7;font-weight:800;font-size:17px}.information{margin-top:18px;border-top:1px solid #233248}.information>div{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #223146;padding:12px 0;font-size:12px}.information span{color:#8298b1}.information b{text-align:right;font-size:12px;font-weight:600;max-width:67%;overflow-wrap:anywhere}.footnote{font-size:12px;line-height:1.7;margin:15px 0 0}.list{margin-top:18px}.list-row{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 1px;border-bottom:1px solid #213047}.list-row:last-child{border-bottom:0}.list-name{font-size:13px;color:#dce8f6;font-weight:600}.list-sub{font-size:11px;color:#7991aa;margin-top:4px}.pill{font-size:11px;font-weight:700;border-radius:6px;padding:6px 8px;color:#f1c786;background:#4b3822;white-space:nowrap}.pill.good{color:#76e9c1;background:#17463c}.pill.bad{color:#ff9999;background:#4b2730}.pill.neutral{color:#bcd0e5;background:#2a3c51}footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:25px;padding-top:16px;border-top:1px solid #27364a;font-size:11px;color:#6e86a2}@media(max-width:850px){.card-grid{grid-template-columns:repeat(2,1fr)}.masthead h1{font-size:23px}.panel-grid{grid-template-columns:1fr}.detail{min-height:unset}}@media(max-width:520px){.shell{padding:20px 14px}.masthead{align-items:flex-start;flex-direction:column;gap:15px}.card-grid{gap:10px}.metric{padding:17px 14px;min-height:143px}.metric strong{font-size:24px}.detail{padding:20px 16px}.live{align-self:flex-start}.information>div{gap:8px}}`;

export const DASHBOARD_JS = `(()=>{'use strict';
const el=id=>document.getElementById(id);const fmt=n=>Number.isFinite(Number(n))?new Intl.NumberFormat('zh-CN').format(n):'--';
const moment=raw=>raw?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(raw)):'--';
const statusText={PROVISIONAL:'已采集·未对账',PARTIAL:'已采集·有缺口',RUNNING:'采集中',FAILED:'采集失败',BLOCKED:'源访问受限',STORED_UNVERIFIED:'已存档·未对账',PENDING:'待采集',PILOT:'试验批次',PILOT_COMPLETE:'试验完成·暂停',WAITING_QUOTA:'等次日额度恢复',BLOCKED_OR_FAILED:'暂停·需排错',FINISHED:'已完成',FINISHED_WITH_GAPS:'已结束·有缺失',PAUSED_OR_LOCKED:'已暂停',NOT_INITIALIZED:'未初始化'};
const label=v=>statusText[v]||v||'等待任务';
const escapeAll=node=>{while(node.firstChild)node.removeChild(node.firstChild)};
function item(target,name,sub,status){const row=document.createElement('div');row.className='list-row';const left=document.createElement('div');const a=document.createElement('div');a.className='list-name';a.textContent=name;const b=document.createElement('div');b.className='list-sub';b.textContent=sub;left.append(a,b);const right=document.createElement('span');const good=/PROVISIONAL|PARTIAL|STORED_UNVERIFIED|HTTP_REACHABLE/.test(status);const bad=/FAILED|BLOCKED|ERROR|ACCESS_/.test(status);right.className='pill '+(good?'good':bad?'bad':'neutral');right.textContent=label(status);row.append(left,right);target.append(row)}
function render(data){el('connection').textContent='在线 · 自动刷新';el('clock').textContent=moment(data.generated_at);
const d=data.daily||{};el('daily-status').textContent=d.status?label(d.status):'等待当日任务';el('daily-sub').textContent=d.status?'已记录云端批次':'计划北京时间16:20采集';el('daily-rows').textContent=d.normalized_rows==null?'--':fmt(d.normalized_rows);el('daily-date').textContent=d.trade_date||data.china_today;el('daily-time').textContent=moment(d.finished_at||d.started_at);el('daily-quality').textContent=d.universe_verified?'已独立对账':'未验证全市场覆盖';el('daily-chip').textContent=d.status?label(d.status):'尚无批次';el('daily-message').textContent=d.error_code?'采集异常：'+d.error_code:'行情与合理估值分离；没有证据时估值保持未知。';const assets=d.assets||{};el('daily-assets').textContent=d.status?'A股 '+fmt(assets['A股']||0)+' · 转债候选 '+fmt(assets['可转债候选']||0):'A股 / 可转债 待采集';
el('daily-source').textContent=d.source==='baostock_daily_AStock'?'BaoStock · 全A股':d.source==='369_day_kline'?'369 · 混合行情':data.primary_source==='baostock'?'BaoStock · 待首次采集':'369 · 待首次采集';el('daily-sub').textContent=d.status?'已记录云端批次':data.primary_source==='baostock'?'北京时间18:20采集':'北京时间16:20采集';
const h=data.history||{};const total=h.calendar_rows||0,done=h.stored_unverified||0,pct=total?Math.min(100,100*done/total):0;const unlimited=h.attempt_limit===0;el('history-done').textContent=fmt(done);el('history-total').textContent=total?'总交易日 '+fmt(total):'等待交易日历';el('history-state').textContent=label(h.state);el('history-attempts').textContent=unlimited?fmt(h.attempts||0)+' 次累计抓取 · 全量模式':fmt(h.attempts||0)+' / '+fmt(h.attempt_limit||0)+' 次试抓';el('history-chip').textContent=h.state==='WAITING_QUOTA'?'等次日额度恢复':h.enabled?(unlimited?'全量运行中':'运行中'):label(h.state);el('history-strategy').textContent=unlimited?'完整队列 · 抓完即续抓':'达到试抓次数后暂停';el('history-range').textContent=(h.start_date||'2020-01-01')+' — '+(h.end_date||'2026-11-20');el('history-bar').style.width=pct.toFixed(2)+'%';el('history-percent').textContent=pct.toFixed(1)+'%';el('history-breakdown').textContent=total?'待抓 '+fmt(h.pending||0)+' · 失败 '+fmt(h.failed||0)+' · 受限 '+fmt(h.blocked||0):'等待历史交易日历首次同步';el('history-error').textContent=h.last_error_code?'历史任务异常：'+h.last_error_code:'暂无历史任务异常。';
const historyList=el('history-list');escapeAll(historyList);const recent=h.recent||[];if(!recent.length)item(historyList,'等待首个2020年交易日','已创建任务后将在这里显示执行结果','PENDING');for(const r of recent)item(historyList,r.trade_date,'尝试 '+fmt(r.attempts)+' 次'+(r.run_id?' · 批次已记录':''),r.status);el('history-last').textContent=recent.length?moment(recent[0].updated_at):'暂无任务';
const sourceList=el('source-list');escapeAll(sourceList);const probes=data.probes||[];if(!probes.length)item(sourceList,'暂无探针结果','每日增量任务执行后会记录','PENDING');for(const p of probes)item(sourceList,p.source+' · '+p.endpoint_type,'HTTP '+(p.http_status??'--')+' · '+moment(p.checked_at),p.status);el('refresh-time').textContent='上次更新 '+moment(data.generated_at)+' · 每30秒刷新';}
async function tick(){try{const r=await fetch('/api/v1/public/overview',{cache:'no-store'});if(!r.ok)throw Error('HTTP_'+r.status);const payload=await r.json();render(payload)}catch(e){el('connection').textContent='状态读取失败';el('refresh-time').textContent='连接失败，将自动重试';}}tick();setInterval(tick,30000);
})();`;

function publicError(message) {
  return /^(HTTP_(401|403|429)_STOP|SOURCE_HTTP_\d{3}|CALENDAR_HTTP_\d{3}|TOP369_API_KEY_NOT_CONFIGURED)$/.test(message || '')
    ? message : message ? 'ERROR_REDACTED' : null;
}

export async function readPublicOverview(env) {
  const day = chinaToday();
  const [daily, control, stats, recent, probes] = await Promise.all([
    env.DB.prepare('SELECT trade_date,source,status,started_at,finished_at,normalized_rows,audit_json,error FROM market_runs WHERE trade_date=? ORDER BY started_at DESC LIMIT 1').bind(day).first(),
    env.DB.prepare('SELECT start_date,end_date,enabled,state,calendar_rows,attempts,attempt_limit,calendar_loaded_at,last_error FROM backfill_control WHERE id=1').first(),
    env.DB.prepare('SELECT status,COUNT(*) AS n FROM backfill_days GROUP BY status').all(),
    env.DB.prepare("SELECT trade_date,status,attempts,last_run_id,updated_at FROM backfill_days WHERE status!='PENDING' ORDER BY updated_at DESC LIMIT 6").all(),
    env.DB.prepare('SELECT source,endpoint_type,status,http_status,checked_at FROM source_probes ORDER BY checked_at DESC LIMIT 30').all(),
  ]);
  const counts = Object.fromEntries((stats.results || []).map(x => [x.status, x.n]));
  const unique = new Map();
  for (const probe of probes.results || []) if (!unique.has(probe.source)) unique.set(probe.source, probe);
  let audit;
  try { audit = daily?.audit_json ? JSON.parse(daily.audit_json) : null; } catch { audit = null; }
  return {
    service: 'logic-b-cloudflare', generated_at: new Date().toISOString(), china_today: day,
    primary_source: env.PRIMARY_MARKET_SOURCE === 'baostock' ? 'baostock' : '369',
    trading: 'manual_only',
    daily: daily ? { trade_date: day, source: daily.source, status: daily.status, started_at: daily.started_at,
      finished_at: daily.finished_at, normalized_rows: daily.normalized_rows,
      universe_verified: audit?.universe_verified === true, assets: audit?.assets || {},
      error_code: publicError(daily.error) } : null,
    history: {
      start_date: control?.start_date || null, end_date: control?.end_date || null,
      state: control?.state || 'NOT_INITIALIZED', enabled: control?.enabled === 1,
      attempts: control?.attempts ?? 0, attempt_limit: control?.attempt_limit ?? 0,
      last_error_code: publicError(control?.last_error),
      calendar_rows: control?.calendar_rows ?? 0,
      stored_unverified: counts.STORED_UNVERIFIED ?? 0, pending: counts.PENDING ?? 0,
      blocked: counts.BLOCKED ?? 0, failed: (counts.FAILED ?? 0) + (counts.BLOCKED_OR_FAILED ?? 0),
      recent: (recent.results || []).map(x => ({ trade_date: x.trade_date, status: x.status,
        attempts: x.attempts, run_id: x.last_run_id, updated_at: x.updated_at })),
    },
    probes: [...unique.values()].map(x => ({ source: x.source, endpoint_type: x.endpoint_type,
      checked_at: x.checked_at, status: x.status, http_status: x.http_status })),
  };
}

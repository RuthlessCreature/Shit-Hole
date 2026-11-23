# 逻辑B历史日线回填：2020-01-01起

## 真实边界

- 请求区间：2020-01-01 至 2026-11-20（最后一个已完整收市的交易周末尾）；2020-01-01是休市日，预计最早有效日为2020-01-02。
- 通过369交易日历API取得实际开市日期，禁止按周一到周五近似生成交易日。日历原始响应及SHA-256保存在私有R2。
- 每个交易日最多一次全市场 `day_kline?date=...` 请求；每条正常记录完整保存在R2（原始JSON、标准化JSONL、审计manifest）。缺失/ST/停牌/零量均不作为研究过滤条件。
- 历史日线以R2为全量事实库。超过当前日期45天的历史窗口**不再逐码写D1**：D1单库最大10GB，不能把整个七年市场灌爆。D1仍逐日记录抓取量、来源、状态及R2路径。最近45自然日的回填以及持续每日增量可同时写D1逐码明细。
- 历史数据源是单一369，并未与交易所独立证券主表对账；因此每个批次仍然最多 `PROVISIONAL` 或 `PARTIAL`，绝不称为 VERIFIED。2020年的A股数量远低于2026年，固定5000只异常基线自然会标成PARTIAL，**不能将其直接解释为真正缺失**。

## 首次生产实测：2026-11-23（北京时间）

- 16:15首次历史Cron已实际运行：369交易日历返回2020-01-01至2026-11-20区间内**1668个交易日**，D1历史日队列已生成。
- 首个交易日**2020-01-02**取回**5346条**，标准化保留**5346条**，无格式无效行；原始JSON、标准化JSONL和manifest已写R2。生产D1运行状态为 `PARTIAL / STORED_UNVERIFIED`。
- 该批按**旧版粗代码前缀**统计：A股3648、ETF/基金235、其他证券1453、可转债候选10。其中以`sz1318`开头的9个实际属于回购代码，不是可转债；故该批**有效转债候选最多约1个**，**369的历史单日截面远未证明可转债覆盖完整**。这一证据直接否定了“股票日线截面=股债全市场数据齐备”的假设。
- 发现后修订 `assetOf()`：不再把所有`13xxxx`归为转债，按市场限制转债代码段、保留其他证券。**首次2020-01-02归档仍为修订前的原始审计版本**；未来需要从R2原始文件重标准化或明确重跑，不能静默改写旧审计。
- 此外，369的`/api/a/cb/daily`文档明确注明日度因子截面从上线日起积累、历史不回补；不能拿它假设能直接补齐2020年全量历史转债。应另建可转债历史证券主表与行情来源，再做跨源对账。

## 自动回填调度

- 新增 `cloudflare/migrations/0002_backfill.sql`，表为 `backfill_control` 和 `backfill_days`；先迁移，再发布新版Worker。
- 每15分钟触发一次独立回填Cron（`*/15 * * * *`，UTC），**每次只尝试1个交易日**。现有北京时间16:20当日增量Cron保持不变。这样即使进度慢，也不会突然用尽上游配额。
- 第一批为**3个真实交易日试抓**（`attempt_limit=3`）。三次尝试后自动 `enabled=0,state=PILOT_COMPLETE`，暂停等待对2020年价格、证券数和文件体积的实际核验。
- 如果遇到401/403/429，当前日记为`BLOCKED`、回填立即暂停；其它异常记为失败，保留原因，不绕封锁、不无限重试。
- 后续大规模放行时，只调整 `backfill_control.attempt_limit/enabled/state`，保留原有交易日和已完成批次，不从头重复抓；必须根据实际供应商额度和存储费用来决定每轮规模。
- `backfill_days.status='STORED_UNVERIFIED'`意为原始/标准化日线已落私有R2，**不代表数据覆盖完全，更不等于有估值证据**。

## 云端验收SQL

用已授权Cloudflare插件在本项目D1中执行（无需本地常驻服务）：

```sql
SELECT state,enabled,start_date,end_date,calendar_rows,attempts,attempt_limit,
       last_error,calendar_loaded_at FROM backfill_control WHERE id=1;

SELECT trade_date,status,attempts,last_run_id,last_error
FROM backfill_days ORDER BY trade_date LIMIT 10;

SELECT trade_date,status,normalized_rows,raw_key,normalized_key,manifest_key,audit_json,error
FROM market_runs WHERE trade_date < '2026-01-01' ORDER BY trade_date LIMIT 5;
```

核实R2中的 `provider.json`、`normalized.jsonl` 与 `manifest.json` 实体存在、内容可解析、数量与数据库审计一致，并抽样跨源比对价格与交易日。

## 未实现事项（禁止误报）

完整历史回填尚未完成；单一369源无法单独验证全市场覆盖，**尤其可转债历史覆盖存在实测缺口**；没有逐码R2历史查询API、历史ST/公告、复权因子与PIT财务字段，也没有七年回测或自动估值。

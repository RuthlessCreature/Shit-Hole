## Cloudflare-only 采集基础设施（Paid Workers）

## 状态前端（2026-11-23已上线并实测）

现有独立Worker的 [状态控制台](https://shit-hole-logic-b.nostalgia-ho.workers.dev/) 位于 `/`（`/dashboard` 同样可用）。前端HTML、CSS与JS直接由Worker提供，不依赖本地机器、第三方站点和外部CDN；页面每30秒调用公开只读 `/api/v1/public/overview`。

页面展示：当日增量采集状态、标准化记录和股票/转债候选分布、2020年起历史回填进度与失败批次、来源探针、R2/D1冷热分层。**公开接口仅返回汇总与状态，不含API Secret、原始授权行情、R2路径及逐证券报价。** 北京时间16:04—16:07已在真实公网浏览器核验页面渲染与动态状态读取；当时回填尚未首跑，显示 `0/3` 属实。


## 2020-01-01起历史回填（新增）

用户将历史起点扩大到2020-01-01。历史实际交易日由369交易日历接口决定；首个预期交易日是2020-01-02，终点为2026-11-20。详情见 [`docs/HISTORICAL_BACKFILL.md`](../docs/HISTORICAL_BACKFILL.md)。

- 增量Cron仍为北京时间16:20；新增每15分钟运行的**独立历史Cron**，每次最多尝试1个交易日。首轮最多试抓3天，随后自动暂停等待真实源与容量审计。
- 2020等冷历史的**所有原始行和标准化行情存在私有R2**，D1存逐日运行元数据；仅近45日历史再额外写D1逐证券行情，避免单库10GB上限。
- 上线次序：先执行新增 `0002_backfill.sql` 迁移，检查 `backfill_control`，再上传三模块Worker并配置第二Cron。**未查询到实际抓取记录前不宣称历史已补。**


## 2026-11-23 实际部署记录

## 2026-11-23 15:47—15:55（北京时间）线上验收增补

- 已通过真实浏览器访问 [`https://shit-hole-logic-b.nostalgia-ho.workers.dev/health`](https://shit-hole-logic-b.nostalgia-ho.workers.dev/health)；返回 `service=logic-b-cloudflare`、`status=online`、`trading=manual_only`。因此 **Worker 公网 HTTP 健康接口已验收**，但不等于业务源数据已采集。
- 已在 Cloudflare 生产 Worker 开启并回读验证 `observability.enabled=true`、`logs.enabled=true`、`invocation_logs=true`、`traces.enabled=true`，日志采样 100%、追踪采样 10%；同时开启请求查询参数脱敏。复查绑定 `DB`、`RAW`、`TOP369_API_KEY` 和两项行情数量配置均未丢失。
- 2026-11-23 15:47 北京时间，D1 查询实测 `market_runs=0`、`market_quotes=0`、`source_probes=0`。这属于**首次16:20定时任务尚未触发**，不能归因为供应商故障，也不能宣称已采集。
- 下一次验收需在首次Cron之后，检查 `market_runs.status/error/audit_json`，按 `run_id` 统计 `market_quotes`，验证 `source_probes`，并与独立证券主数据比对。369真实接口的 Cloudflare 出口可达性、额度、字段口径尚未证实。

经用户指定，已在独立的 Cloudflare 个人账户中创建并上传：Worker `shit-hole-logic-b`、D1 `shit-hole-research`、R2 `shit-hole-research-raw`，以及工作日北京时间16:20的定时触发器。D1业务表已实查存在；`TOP369_API_KEY` 已获用户许可并仅保存在 Cloudflare Secret 中。**当前尚无真实采集运行记录，联网源响应与业务覆盖率仍未验收；仅公网健康接口已验收**。本仓库不保存账号密钥；其余查询认证密钥未配置，管理员REST路由默认关闭。

本目录是独立逻辑B的**云端采集与只读查询原型**。生产运行不依赖本地电脑、GitHub Actions 或任何其他交易项目；仅允许在开发环境执行离线测试与首次部署命令。

## 已实现的边界

1. Cloudflare Cron：工作日 UTC 08:20（北京时间16:20）尝试采集指定日期的369日线；**工作日不等于交易日**，遇休市、源延迟、缺数据保留异常状态，禁止回退昨天伪装当天。
2. 369授权日线：`TOP369_API_KEY` 是用户必须在 Cloudflare 设置的 Secret。未配置则写入 `BLOCKED` 运行记录；401/403/429直接停止，不绕过限制。**369不是免费无门槛数据源，授权档位和实际额度仍需用户核验。**
3. Source probes：上交所、深交所、巨潮首页的 HTTP连通性，以及配置密钥后的369证券列表小请求。返回200仅是 `HTTP_REACHABLE_NOT_DATA_VERIFIED`，**不是行情、财报或公告真实可用的证据**。
4. 数据：完整提供方响应、归一化JSONL和审计清单进私有 R2；每个有效证券的日线及独立 `run_id` 进 D1。**所有资产类别入库**，不因 ST、低价、停牌、零成交等特征过滤研究样本。结构不合规的原始行保存在 R2，错误原因进审计。
5. 审计：A股数量和可转债数量低于基线时标为 `PARTIAL`；达到基线也只能标 `PROVISIONAL`，**只有独立证券主数据对账完成后，才有资格称为全市场覆盖 VERIFIED**。无财务和公告时不得推断合理价值。
6. 查询：Bearer Token保护的分页行情、当日运行状态、源探针；后台手动触发与探针使用独立 `ADMIN_TOKEN`。当前是**REST V1**，尚未实现ChatGPT远程MCP协议，也没有自动订单。

## 首次部署（由账号管理员执行，不自动部署）

```bash
cd cloudflare
npm install
npx wrangler d1 create shit-hole-research
npx wrangler r2 bucket create shit-hole-research-raw
cp wrangler.jsonc.example wrangler.jsonc
# 编辑 wrangler.jsonc，填写 d1 create 返回的真实 database_id。
npx wrangler d1 migrations apply shit-hole-research --remote --config wrangler.jsonc
npx wrangler secret put TOP369_API_KEY --config wrangler.jsonc
npx wrangler secret put READ_TOKEN --config wrangler.jsonc
npx wrangler secret put ADMIN_TOKEN --config wrangler.jsonc
npx wrangler deploy --config wrangler.jsonc
```

`wrangler.jsonc` 被 `.gitignore` 排除：其中只有绑定信息；所有真正的秘钥仍必须作为 Cloudflare Secrets 管理，严禁粘贴进 GitHub 或页面。`READ_TOKEN`、`ADMIN_TOKEN` 必须使用独立高熵随机值，不能复用行情供应商密钥。2026年之前曾在会话或其他场合公开过的真实 API Key 应由用户考虑轮换。

## 连接与数据验证

```bash
# 将地址替换为 Worker 实际 https 地址；不要把 Token 放进 URL。
curl -fsS https://YOUR-WORKER.workers.dev/health

curl -fsS -X POST \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  https://YOUR-WORKER.workers.dev/api/v1/admin/probe

curl -fsS -X POST \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  'https://YOUR-WORKER.workers.dev/api/v1/admin/collect?date=2026-11-20'

curl -fsS -H 'Authorization: Bearer YOUR_READ_TOKEN' \
  'https://YOUR-WORKER.workers.dev/api/v1/market/status?date=2026-11-20'

curl -fsS -H 'Authorization: Bearer YOUR_READ_TOKEN' \
  'https://YOUR-WORKER.workers.dev/api/v1/market/quotes?date=2026-11-20&asset=A%E8%82%A1&limit=100'
```

返回值中务必检查 `status`、`assets`、`warnings`、`errors_sample` 与 `universe_verified`。不能因为 HTTP 200 就认为市场行情验收通过。Worker及存储已部署到用户指定Cloudflare账户，但截至北京时间2026-11-23 15:47，尚无真实行情抓取的运行记录；等待16:20首次定时任务及业务源验收。

## 后续迭代清单

1. **数据源实测**：把联通探针升级成可验证证券主数据、公告列表与财务字段的适配器；不能用首页可访问来代替业务API可访问。
2. **全量对账**：交易日历、证券主表、股票/转债逐项覆盖、日期与计量单位比对；主数据验收成功后才升级 `PROVISIONAL`。
3. **持久扫描计算**：将 `logic_b_work/analyze_full_snapshot.py` 的20日异常计算与 `trade_cards.py` 的证据规则移植/适配为 Cloudflare Workflows 任务。现有 V1 只有云端行情数据底座，**没有在云端自动生成交易卡**。
4. **复杂 Python 依赖**：尽量使用 Worker JS；确需 BaoStock / AKShare Python 原有运行时，再验证 Cloudflare Containers 是否可在现有 Paid 账户工作，单独评估价格，不启用其他云/本地机器。
5. **ChatGPT连接**：为只读接口实现标准远程MCP端点，经过 ChatGPT 应用权限配置后才能直接在对话里读取。REST 地址不能冒充已完成 MCP 连接。

## 离线测试

```bash
node --test cloudflare/tests/*.test.mjs  # 从仓库根目录执行
python -m unittest discover -s tests -v
```

生产前还需执行 `wrangler` 真正的构建、远程 D1 迁移和实测；离线测试不能代替 Cloudflare API 连通性或完整数据覆盖率。

# Cloudflare-only 采集基础设施（Paid Workers）

本目录是独立逻辑B的**已上线云端采集与只读状态系统**。生产运行不依赖本地电脑、GitHub Actions 或任何其他交易项目；开发环境仅用于代码维护与离线测试。

**生产地址：** https://shit-hole-logic-b.nostalgia-ho.workers.dev/ （`/dashboard` 同页；手机/桌面自适应）。页面每30秒读取公开聚合只读接口 `/api/v1/public/overview`，不暴露授权密钥和R2明细。已通过公网浏览器查看。

**生产基础设施：** Worker `shit-hole-logic-b`、D1 `shit-hole-research`、R2 `shit-hole-research-raw`，均处于用户授权的独立Cloudflare账号。`TOP369_API_KEY` 已以Secret绑定并实际通过鉴权。历史回填使用独立Queue `shit-hole-history-backfill`，当天行情仍由Cron `20 8 * * 1-5` 触发。最新状态证据见 [`docs/HISTORICAL_BACKFILL.md`](../docs/HISTORICAL_BACKFILL.md)。

## 已实现的边界

1. Cloudflare Cron：工作日 UTC 08:20（北京时间16:20）尝试采集指定日期的369日线；**工作日不等于交易日**，遇休市、源延迟、缺数据保留异常状态，禁止回退昨天伪装当天。
2. 369授权日线：`TOP369_API_KEY` 是用户必须在 Cloudflare 设置的 Secret。未配置则写入 `BLOCKED` 运行记录；401/403/429直接停止，不绕过限制。**369不是免费无门槛数据源，授权档位和实际额度仍需用户核验。**
3. Source probes：上交所、深交所、巨潮首页的 HTTP连通性，以及配置密钥后的369证券列表小请求。返回200仅是 `HTTP_REACHABLE_NOT_DATA_VERIFIED`，**不是行情、财报或公告真实可用的证据**。
4. 数据：完整提供方响应、归一化JSONL和审计清单进私有 R2；独立 `run_id` 和每日审计进 D1，**最近45自然日**的逐码日线额外进 D1。历史冷数据不逐码写D1，避免10GB单库上限。**所有资产类别保留于原始历史文件**，不因 ST、低价、停牌、零成交等特征过滤研究样本。结构不合规的原始行保存在 R2，错误原因进审计。
5. 审计：A股数量和可转债数量低于基线时标为 `PARTIAL`；达到基线也只能标 `PROVISIONAL`，**只有独立证券主数据对账完成后，才有资格称为全市场覆盖 VERIFIED**。无财务和公告时不得推断合理价值。
6. 查询：Bearer Token保护的分页行情、当日运行状态、源探针；后台手动触发与探针使用独立 `ADMIN_TOKEN`。当前是**REST V1**，尚未实现ChatGPT远程MCP协议，也没有自动订单。
7. 历史回填：Queue消费者每次处理1个真实交易日，R2/D1持久化完成后立即投递下一个消息，不再每5分钟等Cron。**`attempt_limit=0` 全量模式**不设置研究日数上限；369免费档日额度参考500次，Worker按北京时间单日最多450次369行情请求进行预算控制，额度用尽次日自动续跑。401/403停机；429暂停到次日后重试；其它暂时错误逐日最多3次。历史冷数据如被查询逐码D1接口，返回 `HISTORICAL_QUOTES_IN_PRIVATE_R2`；R2历史逐码查询尚未实现。

## 生产运行证据（2026-11-23，北京时间）

- **16:15历史Cron**：交易日历1668日；2020-01-02已归档5346条原始行情，R2实体读取已校验，0条格式错误。`PARTIAL`是未经独立对账且沿用现代静态数量基线的告警，不是数据已验全量。
- **16:20当日Cron**：2026-11-23采集9342条，D1逐证券计数精确一致：A股5581、可转债候选256、ETF/基金候选1830、其他证券1675，零成交259条，0条格式错误，`PROVISIONAL`（未独立对账）。
- **数据源探针**：369证券列表HTTP 200、上交所首页200、深交所首页200、巨潮首页446。首页探针不证明公告接口数据就绪。
- **覆盖缺口**：2020-01-02股票截面几乎未带历史可转债；旧版分类还误将9个深市回购代码计为转债，已修正未来采集代码。首次原始归档审计保持原样，待单独重新标准化与可转债独立源补齐。
- **最新回填模式**：2020-01-02、03、06三日共16047条已归档；随后用户连续要求取消试抓上限，并取消每5分钟一日等待，改成Cloudflare Queue逐日即时接力。队列消费者单并发、单条消息、D1占位去重，按日配额暂停，最终失败日不能冒称完成。
- **尚未配置的访问控制**：生产当前仅验证了行情源Secret；独立 `READ_TOKEN` 和 `ADMIN_TOKEN` 未在生产设置，故对应受保护REST端点暂不可用。公开状态控制台、Cron、D1、R2不受影响。用户授权并生成独立高熵密钥后才能启用这些端点。

## 从空环境复现部署（由账号管理员执行；当前生产已部署）

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

返回值中务必检查 `status`、`assets`、`warnings`、`errors_sample` 与 `universe_verified`。不能因为 HTTP 200 就认为市场行情验收通过。**以上curl受保护端点须先完成独立READ/ADMIN Secret配置**；目前生产已部署且实际抓取过2020和2026交易日。

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

生产D1迁移 `0001`、`0002` 均已执行；Cloudflare API模块上传、Cron调度与真实数据落库已验证。Queuing行为使用离线测试与生产消费记录分别验证。离线测试目前27项通过，但这不等于证券主数据独立覆盖验收。GitHub PR分支已有最新源码；后续本地Wrangler复现仍需跑目标Workers运行时测试。

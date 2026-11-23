# 逻辑B 数据源地图（免费优先）

更新时间：2026-11-23。此文件区分**文档确认**、**本项目真实验证**和**待测试**。数据免费获取不等于数据可公开再分发。优先使用公开披露和免费软件接口；付费方案仅在证实免费覆盖缺口后考虑。

## 一、分层与主次关系

| 数据层 | 免费优先主源 | 免费辅助/交叉核验 | 已有授权源/可选付费 | 当前真实状态 |
|---|---|---|---|---|
| A股交易日历 | BaoStock `query_trade_dates`；交易所日历 | AKShare交易日历 | 369 `/a/market/trade_calendar` 免费档 | **云端已抓2020-01-01至2026-11-20实际交易日1668天**；旧本地脚本仍待替换工作日近似 |
| 历史A股OHLCV | BaoStock `query_history_k_data_plus`、`query_daily_history_k_AStock` | AKShare `stock_zh_a_hist`（东方财富等） | 369 `/a/stock/day_kline?date=` 免费授权用例 | **云端2020-01-02/03/06三天实抓共16047条**；已授权全量历史自动回填，2026-11-23当日9342条进D1 |
| 证券代码/名称/上市状态 | BaoStock `query_stock_basic`、交易所列表 | AKShare股票列表 | 369 `/a/stock/list`（免费档） | 369实际完成 95/95 页、9,404条；**不是历史名称** |
| ST/*ST戴帽/摘帽 | 上交所/深交所公告、BaoStock历史名称交叉核对 | AKShare旧名/公告辅助 | 369 `/a/stock/st_list?date=` **基础版**；`name_history` **专业版** | 真实历史ST未取回；当前名称225不能代替 |
| 财务三表/比率 | BaoStock `query_profit_data` / `query_cash_flow_data` / `query_balance_data`（核对版本函数与字段） | AKShare `stock_financial_report_sina`、`stock_balance_sheet_by_report_em`、`stock_profit_sheet_by_report_em`、`stock_cash_flow_sheet_by_report_em` | 369 `/a/stock/financial` **专业版** | 尚未全量采集；关键需披露时点对齐 |
| 年报/临时公告/监管函/重整 | **巨潮资讯网**、上交所/深交所/北交所正式信息披露 | AKShare `stock_notice_report`（其底层为东财，需逐条复核） | 商业公告/司法数据库 | 尚未拉全量；重点取附件PDF和正式发布日期 |
| 股本/质押/回购/解禁 | 交易所、巨潮公告 | AKShare相关公开接口 | 369 `/a/stock/f10`、`dividend`、`restricted_release` 等专业版 | 未采集 |
| 可转债OHLCV | AKShare `bond_zh_hs_spot` / `bond_zh_hs_daily`（新浪源，逐券日线） | 交易所成交信息；转债募集说明书 | 369日K当前含256只候选 | **2020历史单日369截面仅见1条有效转债候选，覆盖缺口显著；2026-11-23有256条候选**，须单独补源与对账；未含债底/转股条款完整模型 |
| 沪深公司债/企业债 | **上交所债券列表与信息披露**、**深交所债券市场数据** | AKShare `bond_zh_hs_spot` / `bond_zh_hs_daily`（新浪，分类与覆盖待测） | Wind/Choice/中债估值等需独立授权 | **逐券全覆盖没有完成** |
| 银行间信用债 / MTN / 短融 | **中国货币网、交易商协会、上海清算所、中债信息网**公开资料 | AKShare个别银行间公开数据（需核验） | 商业估值/成交数据库 | **没有逐券价量与估值全覆盖** |
| 法院重整/裁判/拍卖 | 法院、全国企业破产重整案件信息网、法定公告 | 巨潮披露的法院裁定原件 | 司法商业数据库 | 案件粒度、可得性与时间戳待核实 |
| 评级/债务条款/担保 | 募集说明书、定期报告、评级机构公开报告、交易所债券公告 | 交易商协会与受托管理人报告 | 中债/商业数据库 | 未形成统一债券条款/偿付顺序库 |

### 核心路由原则

1. **一级事实：**官方公告/判决/交易所证券状态/法定文件；二级事实：免费行情/整理数据；三级事实：模型推断。
2. 不存在一个“万能免费全量接口”能同时覆盖所有公开/非公开信用债、银行间违约债权、实时有效成交价和清偿率。逐市场建池，分别披露覆盖率。
3. AKShare 是抓取适配层，不是数据交易所。每个接口应单独记录**实际底层提供者**、使用条款、变更与限流；不要把「AKShare免费」误当作「权利没有限制」。
4. 财报时间口径：`report_period` ≠ `first_public_at`；只有 `first_public_at <= asof_cutoff` 才可参与指定历史日期的估值。
5. 价量口径：**交易所原始收盘价**与除权后“次日昨收”可能不同，零成交日的价格可能只是参考标记。

## 二、优先要试的免费接口（本地 Codex 任务单）

### A. BaoStock：免费A股历史基线

- 官网：<https://www.baostock.com/>；季频盈利：<https://baostock.com/mainContent?file=seasonProfit.md>；单日A股K线：<https://baostock.com/mainContent?file=DailyUpdates.md>。
- 优先验证 `bs.login()`、`query_stock_basic`、`query_trade_dates`、`query_history_k_data_plus`、`query_daily_history_k_AStock`，以及财务的 `query_profit_data`、现金流、资产负债接口。
- 需要先用10个样本核验复权选项、量额单位、财务字段与报告期。覆盖差时保留空值并标记，不用虚假填充。
- **回退方向：**短线异常仍以已验证的369日K为基准；免费数据做并行对账，差异保留原始值和来源。

### B. AKShare：免费财务和沪深债券首选试验

- 官方项目：<https://github.com/akfamily/akshare>；财务接口目录：<https://xlxm.cn/document/akshare/document/tutorial.html>；官方债券文档：<https://github.com/akfamily/akshare/blob/main/docs/data/bond/bond.md>。
- 财务候选：`stock_financial_report_sina(symbol=..., statement=...)`、`stock_balance_sheet_by_report_em(symbol=...)`、`stock_profit_sheet_by_report_em(symbol=...)`、`stock_cash_flow_sheet_by_report_em(symbol=...)`。**先阅读安装版本的函数签名，不照抄网上旧参数**。
- 沪深债券候选：`bond_zh_hs_spot(start_page='1', end_page='N')`（新浪，文档每页80条）以及 `bond_zh_hs_daily(symbol='sh010107')`。**它涵盖的券种不等于全部信用债，也不等于违约债权；逐码对照交易所官方证券名单**。
- 官方项目对东财行情源警告：连续高频请求可能触发来源IP临时限制；被限制后停止等待/切其他数据源，不要高频重试。说明：<https://github.com/akfamily/akshare/blob/main/docs/faq.md>。

### C. 官方披露：免费但难做

- 巨潮公告：<https://www.cninfo.com.cn/new/commonUrl?url=disclosure%2Flist%2Fnotice>，覆盖沪深北及债券披露入口；查询页：<https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?lastPage=index&url=disclosure%2Flist%2Fsearch>。
- 上交所债券清单：<https://www.sse.com.cn/assortment/bonds/list/>；信息披露：<https://bond.sse.com.cn/disclosure/>；公开数据目录：<https://www.sse.com.cn/market/publicdata/>。
- 深交所债券市场数据：<https://www.szse.cn/www/bond/marketdata/>（包括现券汇总、逐笔、债券行情）。
- 自建索引字段：`exchange,code,title,announcement_id,first_public_at,pdf_url,download_hash,event_class,matched_company`。
- 不依赖未核实的私有接口，不绕验证码或付费接口。PDF链接是否需授权、是否受限，实测后记入来源登记。

### D. 369：已验证行情的补充渠道，不是免费万能钥匙

- 文档：<https://www.369.top/docs>。
- **免费档官方标注**：`/api/a/stock/day_kline`、`/api/a/stock/list`、`/api/a/market/trade_calendar`；存在额度限制，应依据当期定价页核对。
- **基础版**：`/api/a/stock/st_list?date=YYYY-MM-DD`；2026-09-01开始历史快照。
- **专业版**：`/api/a/stock/financial`、`/api/a/stock/name_history`、`/api/a/stock/f10`、`/api/a/stock/report_calendar` 等。单票接口做5,580只可能涉及大量配额；先测权限和余额，按批次 checkpoint。
- **已核验**：2026-11-18全证券9,330行、20个交易日日K与证券名单9,404条；**未核验**：专业版报表、历史ST、信用债全券价格。

## 三、数据源验收规范

每个适配器附一个 `source_manifest.json`，至少记录：

- `provider`, `underlying_origin`, `endpoint`, `license`, `account_tier`, `tested_utc`, `latest_data_day`, `asof_day`, `status`。
- `expected_universe_count`, `returned_count`, `distinct_codes`, `unknown_codes`, `missing`, `duplicate`, `zero_volume`, `quarantined`。
- 对账样本：至少沪市、深市、北交所、ST、停牌、退市边缘、可转债与信用债分别取样；价差逐项注明复权/除息/单位/时区原因。
- 源失败时保留审计状态和上次快照，不自动把“昨天数据”当今天成交。

## 四、容易把系统干废的坑

| 坑 | 后果 | 修复 |
|---|---|---|
| 当前简称含ST就当历史ST | 未来信息污染 | 历史ST快照、公告生效日独立判定 |
| 按周一至周五推20交易日 | 节假日窗口错误 | 使用交易日历，校验交易所休市 |
| 没成交的转债参考价当真实买入价 | 假便宜、无法成交 | 成交量、盘口、最后成交时间与参考估值分栏 |
| 100元债券低于面值就默认安全 | 不知道到期能收多少 | 票息、回售、抵押、清偿顺序、回收时间 |
| 追溯财报只按报告期 | 看到了未来才披露的信息 | 逐条匹配首次公开时间 |
| 把交易所公司债等同所有垃圾债 | 漏掉银行间、私募债、逾期债权 | 三大市场分层建池并报告缺口 |
| 仅有短期暴跌就打“错价”标签 | 没有价值锚、假阳性爆炸 | “异常观察”与“独立证实的错价”两套字段 |

## 五、状态解释

- **VERIFIED**：本项目真实取数、行数/字段/时间校验通过；不代表经济价值判断正确。
- **DOCUMENTED_ONLY**：官方或项目文档存在接口，尚无本地真实请求回执。
- **BLOCKED**：网络、权限或额度阻碍，记录明确错误，绝不把失败当空结果。
- **PARTIAL**：只有一部分证券/时间/市场，报告分母。
- **UNAVAILABLE**：没有取得可验证字段；值为`null`，不填零。

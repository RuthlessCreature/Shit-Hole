# Shit-Hole · 逻辑B / 屎坑找肉

中国境内困境资产与市场错价研究系统。覆盖 A 股、ST/*ST、面值退市风险、情绪错杀、重整、可转债、交易所/银行间信用债等。**研究池零门禁**：不因高风险而删行；数据缺失必须显式保留。

> 当前状态：**数据底座部分完成，真实错价判定尚未完成。** 不构成投资建议。

**2026-11-20已启动实盘研究流程（人工执行，非自动交易）：**

- 先做沪深股票与可转债全量研究卡，所有证券保留；交易仓位预算暂为空。
- `logic_b_work/trade_cards.py`可将已核验的历史价量扫描JSON转换为逐券研究卡、沪深优先研究队列与覆盖率报告（纯标准库）。
- `logic_b_work/run_daily.py`将指定日期已合法获取的标准化行情一键串起观察计算、交易卡、队列与审计；**当天文件缺失时直接报错，绝不拿旧行情代替**。
- 2026-11-18历史数据已经实际生成5,838张卡，其中5,482条沪深优先；**估值已证实数量为0，不是2026-11-20当日扫描**。
- 详情与实施排期见 [`docs/STARTUP_20261120.md`](docs/STARTUP_20261120.md)。

## 本地 Codex 从这里开始

1. **必读：[`HANDOFF.md`](HANDOFF.md)**——现状、验收、优先任务、陷阱、禁止事项。
2. **数据源地图：[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)**——免费优先、付费备选、官方核验、接口/限制。
3. **字段规范：[`docs/DATA_CONTRACTS.md`](docs/DATA_CONTRACTS.md)**——历史时点、来源、估值、质量标记。
4. **操作边界：[`AGENTS.md`](AGENTS.md)**——给本地 Codex 的直接指令。

## 现有脚本（`logic_b_work/`）

| 文件 | 用途 |
|---|---|
| `ingest_369_snapshot.py` | 369 单日全市场行情抓取、标准化、审计 |
| `fetch_history_window.py` | 历史逐日快照获取；**目前按工作日近似，需要换真实交易日历** |
| `fetch_security_master.py` | 分页取得最新证券名称与类型 |
| `analyze_full_snapshot.py` | 20日量价异常和零门禁观察标签；不产出估值结论 |
| `enrich_evidence.py` | 历史ST、财报、公告/信用债清单导入、缺失覆盖率 |
| `probe_free_sources.py` | BaoStock、AKShare免费财报、沪深债券行情单样本连通性探针 |
| `build_verified_market.mjs` | 可选 Excel 报告生成；需要 `@oai/artifact-tool`，非普通 npm 环境内建 |

历史源数据、旧版 Excel 及原始完整数据包位于原研究交付中；**此公开仓库不再分发第三方授权获得的全量原始行情**，请本地重新合法采集或使用授权的个人留存数据。

## 2026-11-18 已核行情基线

| 项目 | 核验数 |
|---|---:|
| 全证券单日记录 | 9,330 |
| A 股 | 5,580（有成交5,573） |
| 可转债 | 258 |
| ETF/基金 | 1,817 |
| 指数 | 1,675 |
| 近20交易日窗口 | 2026-10-22 至 2026-11-18，20/20 |
| 当前名含 ST | 225（**不等于历史ST正式名单**） |
| A股异常观察 | 793；可转债29（**不是低估数量**） |

`data/audits/` 只有不含个股完整价格的验收摘要；不能作为逐笔/逐券价格输入。

## 快速开始

```bash
python -m venv .venv
source .venv/bin/activate
python logic_b_work/enrich_evidence.py status  # 需要先有本地历史行情/代码清单

# 提供已授权的凭据，切勿写入仓库：
export TOP369_API_KEY='...'
python logic_b_work/ingest_369_snapshot.py --date 2026-11-18
python logic_b_work/fetch_security_master.py
python logic_b_work/enrich_evidence.py st --date 2026-11-18
python logic_b_work/enrich_evidence.py financial --report-date 2026-09-30 --checkpoint-every 25
python logic_b_work/enrich_evidence.py coverage
```

初次运行应先修复交易日历、凭证级别、网络可达性、以及财报真实披露时间。上面是入口示例，不代表已在其他电脑跑通。

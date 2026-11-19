# 数据契约：观察、证据和价值必须拆开

## 1. 统一主键

`instrument_id = <exchange>:<symbol>:<instrument_type>`；`asof_date`、`source_id`、`observed_at`/`published_at` 同时保留。A股 `sh600567`、可转债 `sh1100xx` 与公司债可能共享数字段，**不得只凭六位码做关联**。

证券类型：`A_SHARE`, `CB`, `EXCHANGE_CREDIT`, `INTERBANK_CREDIT`, `ETF`, `INDEX`, `OTHER`。数据覆盖率按类型分别报告。

## 2. 行情表（market_bar）

`instrument_id,trade_date,open,high,low,close,volume,volume_unit,amount,amount_currency,turnover_pct,adjustment,trade_count,last_trade_at,quote_type,source_id,retrieved_at,quality_flags`

- 量价单位不可跨市场沿用；可转债、信用债应额外标注净价/全价、应计利息、成交方式、最低交易单位。
- `quote_type`: `TRADE`, `INDICATIVE`, `VALUATION`, `CARRIED`。后两者不能直接作为可实现成交价。
- `volume=0` 不代表价格大跌或可交易；市场停牌/无交易/报价缺失分开。
- `adjustment`: `RAW`, `QFQ`, `HFQ`，不得把次日除权后的昨收价覆盖当日原始收盘价。

## 3. 公告/司法事件表（event）

`event_id,instrument_id,issuer_id,event_type,title,first_public_at,effective_at,source_url,document_sha256,raw_text,parsed_facts,confidence,source_id`

需要区分：**发布**、**生效**、**预告**、**完成**。例如“拟筹划重大事项”和“重整计划已获法院裁定并执行完毕”不是一个等级。

**历史截止时间**：2026-11-18收盘视角的数据截点应明确为当日15:00（北京时间）或其他预设时点。2026-11-18 16:00发布的公告**不能纳入当天15:00前可见因子**，只能作为盘后或下一交易日的信息。

## 4. 财务表（financial_statement）

`issuer_id,report_period,statement_type,scope,audit_status,first_public_at,restated_at,currency,unit,fields,source_url,retrieved_at`

建议先核现金及等价物、有息债务、受限资产、应收款、存货、净资产、经营现金流、利息支出、优先权利、稀释后股本；**银行、地产、制造业使用分行业会计映射**。

禁止仅按`report_period<=2026-09-30`判定2026-11-18可用；应按`first_public_at<=asof_cutoff`过滤。

## 5. 债券条款与债权表（bond_terms / recovery）

`bond_id,issuer_id,principal_outstanding,face_value,coupon_schedule,maturity_date,put_date,call_terms,convert_terms,secured_rank,collateral,guarantor,covenants,default_status,source_documents`

估值至少三段：

1. 现金流履约情景（票息、回售、到期本息）；
2. 展期/重整情景（调整时间、利率与本金）；
3. 破产清偿情景（同一债务主体、担保和优先顺序、净回收额、费用、回收时间）。

不能把“债券净价70”直接当“理论还有30%上涨空间”；不能忽略能否实际买入、报价深度与交易资格限制。

## 6. 观察表与估值表彻底分开

`observation`: `instrument_id,asof,signals,attention_score,reason_hypotheses,evidence_links,missing_fields`。

`valuation`: `instrument_id,asof,method,scenario_low,scenario_base,scenario_high,weights,fully_diluted_equity,seniority_assumption,liquidity_discount,mispricing_pct,evidence_grade,invalidating_conditions`。

没有充分验证的数据：`scenario_*`、`mispricing_pct` 保持 `null`。注意力评分不是价值评分，更不是收益预测。

## 7. 覆盖审计

每轮必须列：A股分母、可转债分母、沪市公司债分母、深市公司债分母、银行间信用债分母、有效成交券分母；分母缺失就写`UNKNOWN`，不能用0。

字段维度 `source_status ∈ {VERIFIED,DOCUMENTED_ONLY,PARTIAL,BLOCKED,UNAVAILABLE}`，以及 `pit_verified`、`license_restriction`。输出要能回答“谁付钱、谁优先受偿、什么证据证明价值”。

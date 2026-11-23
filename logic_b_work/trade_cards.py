"""Logic B daily research cards: zero research gates, never automatic orders.

Input is the existing `analyze_full_snapshot.py` JSON. No network, credentials,
broker integration, or third-party packages are required. Optional analyst
assumptions are explicitly marked as models, not externally verified values.

Usage:
  python logic_b_work/trade_cards.py \
    --input /path/to/logic_b_all_instruments.json --out outputs/20261118
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SHANGHAI = timezone(timedelta(hours=8))
ASSETS = {"A股", "可转债"}
CATEGORY_LABELS = {
    "B01": "面值／风险警示及退市博弈",
    "B02": "司法重整",
    "B03": "信用折价／违约债",
    "B04": "可转债条款与信用错价",
    "B05": "妖股退潮",
    "B06": "利空／短线情绪错杀",
    "B07": "行业周期",
    "B08": "财报／减值误判",
    "B09": "隐藏资产／资产处置",
    "B10": "回购增持／控制权",
    "B11": "被动抛售／流动性挤兑",
    "B12": "跨品种相对价值",
}


def as_number(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def observable_categories(row):
    """Only *research hypotheses* inferred from prices, not verified causes."""
    result = []
    signals = row.get("signals") or []
    if row["asset"] == "A股":
        if row.get("is_st_name") or "低于1元" in signals or "1—1.2元面值观察" in signals:
            result.append("B01")
        if "单日跌幅≥7%" in signals or "5日回撤≥20%" in signals:
            result.append("B06")
        if "成交量≥5日均量2倍" in signals and (as_number(row.get("return_1d")) or 0) < 0:
            result.append("B11")
    elif row["asset"] == "可转债":
        if "债价低于90" in signals or "债价低于100" in signals:
            result.append("B04")
    return result


def cutoff_datetime(day):
    return datetime.fromisoformat(day + "T15:00:00+08:00")


def evaluate_analyst_model(row, assumption, cutoff):
    """Compute arithmetic only from time-valid, sourced analyst assumptions.

    No statistical probabilities, valuations, or catalysts are inferred from
    OHLCV. A rejected input cannot leak future information into the card.
    """
    if not assumption:
        return None, ["no_documented_analyst_valuation"]
    flags = []
    sources = assumption.get("sources")
    if not isinstance(sources, list) or not sources:
        return None, ["valuation_without_source_documents"]
    for source in sources:
        if not isinstance(source, dict) or not str(source.get("url", "")).startswith(("https://", "http://")):
            flags.append("source_missing_url")
            continue
        try:
            published_at = datetime.fromisoformat(source["published_at"].replace("Z", "+00:00"))
            if published_at.tzinfo is None:
                flags.append("source_publication_timezone_unknown")
            elif published_at > cutoff:
                flags.append("source_published_after_decision_cutoff")
        except (KeyError, TypeError, ValueError):
            flags.append("source_missing_valid_publication_time")
    if flags:
        return None, flags
    scenarios = assumption.get("scenarios")
    if not isinstance(scenarios, list) or len(scenarios) < 2:
        return None, ["scenario_values_or_probabilities_missing"]
    if not all(isinstance(s, dict) for s in scenarios):
        return None, ["invalid_scenario_type"]
    prices = [as_number(s.get("exit_price")) for s in scenarios]
    probs = [as_number(s.get("probability")) for s in scenarios]
    if any(x is None or x < 0 for x in prices + probs) or abs(sum(probs) - 1.0) > 1e-6:
        return None, ["invalid_scenario_price_or_probabilities"]
    current = as_number(row.get("close"))
    if current is None or current <= 0 or row.get("zero_volume"):
        return None, ["no_executable_reference_price"]
    expected = sum(x * p for x, p in zip(prices, probs))
    low, high = min(prices), max(prices)
    base = as_number(assumption.get("base_value"))
    if base is not None and (base < low or base > high):
        return None, ["base_value_outside_scenarios"]
    discounted_gap = (expected / current - 1)
    targets = None
    if base is not None and base > current:
        targets = {"gap_closed_50pct": round(current + .5 * (base - current), 5),
                   "gap_closed_80pct": round(current + .8 * (base - current), 5),
                   "gap_closed_100pct": round(base, 5)}
    return {
        "classification": "ANALYST_ASSUMPTION_NOT_VERIFIED_FAIR_VALUE",
        "scenario_low": low, "scenario_base": base, "scenario_high": high,
        "weighted_exit_price": round(expected, 6),
        "gross_expected_return": round(discounted_gap, 8),
        "worst_scenario_return": round(low / current - 1, 8),
        "best_scenario_return": round(high / current - 1, 8),
        "profit_reference_prices_not_orders": targets,
        "scenarios": scenarios, "sources": sources,
        "catalyst": assumption.get("catalyst"),
        "catalyst_deadline": assumption.get("catalyst_deadline"),
        "invalidation": assumption.get("invalidation"),
        "stress_executable_price": as_number(assumption.get("stress_executable_price")),
        "estimated_costs": as_number(assumption.get("estimated_costs")),
    }, []


def build_cards(snapshot, assumptions=None):
    assumptions = assumptions or {}
    day = snapshot.get("summary", {}).get("date")
    if not day:
        raise ValueError("source snapshot lacks summary.date")
    date.fromisoformat(day)
    cutoff = cutoff_datetime(day)
    cards = []
    for row in snapshot["rows"]:
        if row.get("asset") not in ASSETS:
            continue  # Outside current requested asset scope; count in audit.
        if row.get("date") != day:
            raise ValueError(f"date mismatch for {row.get('code')}")
        code = row["code"]
        if not (code.startswith(("sh", "sz", "bj")) and len(code) == 8):
            raise ValueError(f"invalid instrument code: {code}")
        model, flags = evaluate_analyst_model(row, assumptions.get(code), cutoff)
        categories = observable_categories(row)
        card = {
            "code": code, "name": row.get("name"), "asset": row["asset"],
            "market": code[:2], "research_priority_market": code[:2] in ("sh", "sz"),
            "asof": day, "decision_cutoff": cutoff.isoformat(),
            "last_observed_close": as_number(row.get("close")),
            "zero_volume": bool(row.get("zero_volume")),
            "amount_yuan": as_number(row.get("amount_yuan")),
            "return_1d": as_number(row.get("return_1d")),
            "return_5d": as_number(row.get("return_5d")),
            "observation_signals": row.get("signals") or [],
            "hypothesis_categories_not_confirmed": categories,
            "attention_score_not_value": row.get("attention_score_not_value") or 0,
            "market_price_source": row.get("source"),
            "market_price_is_executable": False,  # A close is not an order-book quote.
            "valuation": model,
            "fair_value": None if model is None else model.get("weighted_exit_price"),
            "fair_value_verified": False,
            "mispricing_pct": None if model is None else model.get("gross_expected_return"),
            "missing_or_rejected": flags,
            "risk_budget_yuan": None,
            "planned_position_yuan": None,
            "buy_decision": "RESEARCH_ONLY_NO_AUTOMATIC_ORDER",
            "manual_decision_required": True,
            "exit_lines": {
                "thesis_invalidation": model.get("invalidation") if model else None,
                "risk_budget_exit": None,
                "time_exit_deadline": model.get("catalyst_deadline") if model else None,
                "take_profit_references": model.get("profit_reference_prices_not_orders") if model else None,
            },
        }
        cards.append(card)
    return cards


def read_assumptions(path):
    if path is None:
        return {}
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return {x["code"]: x for x in payload}
    if isinstance(payload, dict):
        return payload
    raise ValueError("assumptions must be code-indexed object or list")


def rank_observation(cards):
    """Attention order only. This must NEVER be displayed as a buy ranking."""
    return sorted((c for c in cards if c["research_priority_market"]),
                  key=lambda c: (-c["attention_score_not_value"], c["code"]))


def audit(snapshot, cards, source_hash):
    counter = collections.Counter(x["asset"] for x in cards)
    ranked = rank_observation(cards)
    return {
        "asof": snapshot["summary"]["date"],
        "original_source_rows": len(snapshot["rows"]),
        "source_sha256": source_hash,
        "scope_note": "A股与可转债全量保留；沪深优先；北交所观察行保留但不进入沪深优先榜",
        "research_card_rows": len(cards),
        "asset_counts": dict(counter),
        "research_market_counts": dict(collections.Counter(c["market"] for c in cards)),
        "sh_sz_priority_rows": len(ranked),
        "zero_volume_rows": sum(c["zero_volume"] for c in cards),
        "rows_with_attention_signals": sum(bool(c["observation_signals"]) for c in cards),
        "rows_with_sourced_analyst_scenarios": sum(c["valuation"] is not None for c in cards),
        "rows_with_independently_verified_fair_value": 0,
        "real_money_positions": 0,
        "note": "注意力排序不是预期收益/低估排序；缺失价值依据时估值及交易建议保持null。",
    }


def write_report(path, info, watch, limit):
    lines = [f"# 逻辑B研究扫描｜{info['asof']} 收盘快照", "",
             "**研究优先级，不是低估排行榜，更不是买入建议。**", "",
             f"- 原始市场记录：{info['original_source_rows']:,}；A股与可转债研究卡：{info['research_card_rows']:,}",
             f"- 沪深研究优先池：{info['sh_sz_priority_rows']:,}；零成交：{info['zero_volume_rows']:,}",
             f"- 有价量异常标签：{info['rows_with_attention_signals']:,}；有来源的分析师情景估值：{info['rows_with_sourced_analyst_scenarios']:,}",
             "- 当前无资金风险预算，因此所有仓位、可执行买卖价和下单决策为空。", "",
             "## 价格异常优先研究清单（不是错价结论）", "",
             "| 代码 | 名称 | 类型 | 收盘 | 注意力分 | 观察信号 | 候选逻辑 |",
             "|---|---|---|---:|---:|---|---|"]
    for c in watch[:limit]:
        esc = lambda x: str(x if x is not None else "—").replace("|", "／").replace("\n", " ")
        lines.append(f"| {c['code']} | {esc(c['name'])} | {c['asset']} | {esc(c['last_observed_close'])} | "
                     f"{c['attention_score_not_value']} | {esc('、'.join(c['observation_signals']))} | "
                     f"{esc('、'.join(c['hypothesis_categories_not_confirmed']))} |")
    lines.extend(["", "## 当前阻塞与数据事实", "",
                  "1. 本报告只使用输入快照对应的交易日，不把历史价格伪装成今日行情。",
                  "2. 尚无可追溯的逐券财务、法院裁定、债券条款与情景概率；不能判断真实合理估值。",
                  "3. 收盘价并非可执行成交价；跌停、停牌、信用事件需独立评估退出能力。",
                  "4. 全量交易卡在 `all_trade_cards.jsonl`；数据覆盖见 `daily_audit.json`。",
                  "5. `fair_value`、`mispricing_pct` 为空时不能排序成‘最值得买’。", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def run(input_path, out_dir, assumptions_path=None, top=20):
    path = Path(input_path)
    source_bytes = path.read_bytes()
    snapshot = json.loads(source_bytes)
    cards = build_cards(snapshot, read_assumptions(assumptions_path))
    ranked = rank_observation(cards)
    info = audit(snapshot, cards, hashlib.sha256(source_bytes).hexdigest())
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    with (output / "all_trade_cards.jsonl").open("w", encoding="utf-8") as f:
        for card in cards:
            f.write(json.dumps(card, ensure_ascii=False, separators=(",", ":")) + "\n")
    with (output / "priority_watchlist.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["code", "name", "asset", "date", "close", "attention_score_NOT_value", "signals", "candidate_B_categories", "fair_value", "mispricing_pct", "buy_decision"])
        for card in ranked:
            writer.writerow([card["code"], card["name"], card["asset"], card["asof"],
                             card["last_observed_close"], card["attention_score_not_value"],
                             ";".join(card["observation_signals"]), ";".join(card["hypothesis_categories_not_confirmed"]),
                             card["fair_value"], card["mispricing_pct"], card["buy_decision"]])
    (output / "daily_audit.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(output / "daily_report.md", info, ranked, top)
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="logic_b_all_instruments.json")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--assumptions", type=Path, help="Optional manually sourced scenario inputs")
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args()
    result = run(args.input, args.out, args.assumptions, args.top)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

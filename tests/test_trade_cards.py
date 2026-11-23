"""Offline tests; no remote source, secret or broker required."""
import json
import tempfile
import unittest
from pathlib import Path

from logic_b_work.trade_cards import build_cards, run


def row(code="sz000001", *, asset="A股", volume=100, signals=None, close=1.0):
    return {"code": code, "name": "示例证券", "asset": asset,
            "date": "2026-11-18", "close": close,
            "amount_yuan": volume * close, "zero_volume": volume == 0,
            "signals": signals or [], "attention_score_not_value": len(signals or []),
            "is_st_name": False, "return_1d": -.08,
            "return_5d": -.25, "source": "offline_test_fixture"}


def snapshot(rows):
    return {"summary": {"date": "2026-11-18"}, "rows": rows}


def sourced_assumption(published="2026-11-18T14:59:00+08:00"):
    return {"sources": [{"url": "https://example.org/disclosure.pdf", "published_at": published}],
            "scenarios": [{"name": "失败", "probability": .25, "exit_price": 0.2},
                          {"name": "中性", "probability": .5, "exit_price": 1.2},
                          {"name": "乐观", "probability": .25, "exit_price": 2.0}],
            "base_value": 1.2,
            "catalyst": "假设事件，非真实公告",
            "catalyst_deadline": "2026-12-01",
            "invalidation": "假设事件未兑现"}


class TradeCardTest(unittest.TestCase):
    def test_all_st_and_nontrading_rows_survive(self):
        rows = [row("sh600001", signals=["低于1元", "单日跌幅≥7%"]),
                row("sz123001", asset="可转债", volume=0, signals=["债价低于90"]),
                row("bj920001", signals=[])]
        cards = build_cards(snapshot(rows))
        self.assertEqual(len(cards), 3)
        self.assertEqual(cards[0]["hypothesis_categories_not_confirmed"], ["B01", "B06"])
        self.assertTrue(cards[1]["zero_volume"])
        self.assertFalse(cards[2]["research_priority_market"])
        self.assertTrue(all(c["fair_value"] is None for c in cards))
        self.assertTrue(all(c["planned_position_yuan"] is None for c in cards))

    def test_future_disclosure_must_not_be_used(self):
        cards = build_cards(snapshot([row()]), {
            "sz000001": sourced_assumption("2026-11-18T16:00:00+08:00")})
        self.assertIsNone(cards[0]["fair_value"])
        self.assertIn("source_published_after_decision_cutoff", cards[0]["missing_or_rejected"])

    def test_missing_publication_time_must_not_be_used(self):
        assumption = sourced_assumption()
        assumption["sources"][0].pop("published_at")
        card = build_cards(snapshot([row()]), {"sz000001": assumption})[0]
        self.assertIsNone(card["valuation"])
        self.assertIn("source_missing_valid_publication_time", card["missing_or_rejected"])

    def test_explicit_scenario_arithmetic_only(self):
        card = build_cards(snapshot([row()]), {"sz000001": sourced_assumption()})[0]
        model = card["valuation"]
        self.assertAlmostEqual(model["weighted_exit_price"], 1.15)
        self.assertAlmostEqual(model["gross_expected_return"], .15)
        self.assertEqual(model["profit_reference_prices_not_orders"], {
            "gap_closed_50pct": 1.1, "gap_closed_80pct": 1.16,
            "gap_closed_100pct": 1.2})
        self.assertFalse(card["fair_value_verified"])
        self.assertTrue(card["manual_decision_required"])

    def test_nonexecutable_price_must_not_generate_value(self):
        card = build_cards(snapshot([row(volume=0)]), {"sz000001": sourced_assumption()})[0]
        self.assertIsNone(card["valuation"])
        self.assertIn("no_executable_reference_price", card["missing_or_rejected"])

    def test_reject_invalid_probabilities(self):
        assumption = sourced_assumption()
        assumption["scenarios"][0]["probability"] = 1.25
        card = build_cards(snapshot([row()]), {"sz000001": assumption})[0]
        self.assertIsNone(card["valuation"])

    def test_scan_output_and_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "snapshot.json"
            src.write_text(json.dumps(snapshot([
                row("sh600001", signals=["低于1元"]),
                row("bj920001"),
                row("sh110001", asset="可转债", signals=["债价低于90"]),
                {"code": "sh000001", "date": "2026-11-18", "asset": "指数"},
            ]), ensure_ascii=False), encoding="utf-8")
            out = Path(tmp) / "outputs"
            report = run(src, out, top=2)
            self.assertEqual(report["research_card_rows"], 3)
            self.assertEqual(report["sh_sz_priority_rows"], 2)
            self.assertEqual(len((out / "all_trade_cards.jsonl").read_text().splitlines()), 3)
            self.assertTrue((out / "priority_watchlist.csv").exists())
            self.assertTrue((out / "daily_report.md").exists())


if __name__ == "__main__":
    unittest.main()

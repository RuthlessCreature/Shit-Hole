"""One-command daily *research* workflow. Does not fetch credentials or place orders.

  python logic_b_work/run_daily.py --date 2026-11-20

Requires that YYYYMMDD_normalized.csv and the historical per-day provider JSON
have already been lawfully imported into --snapshot-dir. Missing *today's* CSV
is a hard error, not a fallback to yesterday's prices.
"""
import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

try:
    from .trade_cards import run as run_cards
except ImportError:
    from trade_cards import run as run_cards

HERE = Path(__file__).resolve().parent


def run(day, snapshots, output, top=20, assumptions=None):
    date.fromisoformat(day)
    snapshots = Path(snapshots)
    stamp = day.replace('-', '')
    csv_path = snapshots / (stamp + '_normalized.csv')
    if not csv_path.exists():
        raise FileNotFoundError(
            f'CURRENT_SNAPSHOT_MISSING: {csv_path}; '
            'refusing to label older prices as requested day')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    analysis = output / 'observation_snapshot.json'
    subprocess.run([sys.executable, str(HERE / 'analyze_full_snapshot.py'),
                    '--date', day, '--snapshot-dir', str(snapshots),
                    '--input-csv', str(csv_path), '--output', str(analysis)],
                   check=True, stdout=subprocess.DEVNULL)
    summary = run_cards(analysis, output, assumptions, top)
    (output / 'run_receipt.json').write_text(json.dumps({
        'asof': day,
        'snapshot_input': str(csv_path.resolve()),
        'outputs': ['observation_snapshot.json', 'all_trade_cards.jsonl',
                    'priority_watchlist.csv', 'daily_audit.json', 'daily_report.md'],
        'execution': 'RESEARCH_ONLY_MANUAL_TRADING',
        'market_rows': summary['original_source_rows'],
        'card_rows': summary['research_card_rows'],
        'verified_fair_values': 0,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', default=date.today().isoformat())
    parser.add_argument('--snapshot-dir', type=Path, default=HERE / 'verified_snapshots')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--top', type=int, default=20)
    parser.add_argument('--assumptions', type=Path)
    args = parser.parse_args()
    output = args.out or (HERE.parent / 'outputs' / ('logic_b_' + args.date.replace('-', '')))
    try:
        result = run(args.date, args.snapshot_dir, output, args.top, args.assumptions)
    except (FileNotFoundError, ValueError, subprocess.CalledProcessError) as exc:
        print('DAILY_RESEARCH_NOT_COMPLETED:', str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

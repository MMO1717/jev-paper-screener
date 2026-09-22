#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from jev_screener.normalize import parse_bibtex_text, parse_candidates_text
from jev_screener.questions import DEFAULT_WEIGHTS, normalize_weights
from jev_screener.router import route_paper, weighted_score
from jev_screener.run import candidates_from_text, screen_papers, write_run

FIXTURES = ROOT.parent / "assets" / "fixtures.json"


def answers(topic, method, evidence, scores, role="method", confidence=0.8):
    payload = {
        "topic_match": {"type": "noul", "noul": topic},
        "method_transferable": {"type": "noul", "noul": method},
        "evidence_compatible": {"type": "noul", "noul": evidence},
        "role_in_paper": {"type": "choice", "choice": role, "confidence": confidence},
    }
    for key, value in scores.items():
        payload[key] = {"type": "score", "score": value, "confidence": confidence}
    return payload


def main() -> int:
    failures: list[str] = []
    fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
    papers, incomplete = candidates_from_text(json.dumps(fixtures["candidates"]), filename="fixtures.json")
    if len(papers) != 9:
        failures.append(f"expected 9 complete papers, got {len(papers)}")
    if not any(item.reason == "missing_abstract" for item in incomplete):
        failures.append("missing abstract was not marked incomplete")
    if not any(paper.language_risk for paper in papers):
        failures.append("Chinese abstract was not flagged language_risk")

    bib = parse_bibtex_text('@article{x, title={Hello}, abstract={World}, year={2024}, author={A},}')
    if bib[0]["title"] != "Hello":
        failures.append("bibtex parse failed")
    csv_rows = parse_candidates_text("title,abstract\nA,B\n", filename="x.csv")
    if csv_rows[0]["title"] != "A":
        failures.append("csv parse failed")

    keep_answers = answers(0.92, 0.88, 0.9, {"problem_overlap": 3, "method_reuse": 3, "experiment_transfer": 2.5, "citation_value": 2})
    drop_gate = answers(0.05, 0.9, 0.9, {"problem_overlap": 3, "method_reuse": 3, "experiment_transfer": 3, "citation_value": 3})
    review_gate = answers(0.42, 0.9, 0.9, {"problem_overlap": 2, "method_reuse": 2, "experiment_transfer": 2, "citation_value": 2})
    low_score = answers(0.9, 0.9, 0.9, {"problem_overlap": 0.2, "method_reuse": 0.2, "experiment_transfer": 0.2, "citation_value": 0.2})

    if route_paper(keep_answers).decision != "keep":
        failures.append("direct match should keep")
    dropped = route_paper(drop_gate)
    if dropped.decision != "drop" or dropped.reason != "hard_gate_reject":
        failures.append("hard-gate reject must drop even with high scores")
    if route_paper(review_gate).decision != "review":
        failures.append("uncertain hard gate should review")
    if route_paper(low_score).decision != "drop":
        failures.append("low weighted score should drop")
    if route_paper(keep_answers, flags=["language_risk"]).decision != "review":
        failures.append("language_risk should hold keep into review")

    default_total, raw_scores = weighted_score(keep_answers, DEFAULT_WEIGHTS)
    flipped = normalize_weights({"problem_overlap": 0.05, "method_reuse": 0.05, "experiment_transfer": 0.1, "citation_value": 0.8})
    flipped_total, flipped_scores = weighted_score(keep_answers, flipped)
    if raw_scores != flipped_scores:
        failures.append("weight changes must not alter raw scores")
    if default_total == flipped_total:
        failures.append("weight changes should alter ranking score")

    result = screen_papers(fixtures["project"], papers, incomplete, answers_by_id=fixtures["answers_by_id"])
    by_id = {row["paper"]["paper_id"]: row["decision"]["decision"] for row in result["decisions"]}
    for paper_id, decision in fixtures["expected_decisions"].items():
        if by_id.get(paper_id) != decision:
            failures.append(f"{paper_id} expected {decision}, got {by_id.get(paper_id)}")

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "offline-fixture"
        write_run(result, out)
        for name in ("inputs.json", "raw_jev.json", "ranked.csv", "decisions.json"):
            if not (out / name).exists():
                failures.append(f"missing {name}")

    if failures:
        print("FAIL")
        for item in failures:
            print("-", item)
        return 1
    print("PASS")
    print(json.dumps(result["counts"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

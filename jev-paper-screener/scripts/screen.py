#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from jev_screener.questions import MODEL_ID, normalize_weights
from jev_screener.run import candidates_from_path, load_project, score_with_client, screen_papers, write_run


def build_client():
    if not os.environ.get("TYPESAFE_API_KEY"):
        return None
    try:
        from typesafe_sdk import TypeSafeClient
    except ImportError as exc:
        raise SystemExit("typesafe-sdk is not installed. pip install typesafe-sdk") from exc
    return TypeSafeClient()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score candidate papers with Jev.")
    parser.add_argument("--project", required=True, help="JSON file with title/brief/constraints")
    parser.add_argument("--candidates", required=True, help="JSON, CSV, or BibTeX candidates")
    parser.add_argument("--out", default="", help="Run output directory")
    parser.add_argument("--answers", default="", help="Offline raw Jev answers keyed by paper_id")
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--weight-problem", type=float, default=0.35)
    parser.add_argument("--weight-method", type=float, default=0.30)
    parser.add_argument("--weight-experiment", type=float, default=0.20)
    parser.add_argument("--weight-citation", type=float, default=0.15)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project = load_project(args.project)
    papers, incomplete = candidates_from_path(args.candidates)
    weights = normalize_weights(
        {
            "problem_overlap": args.weight_problem,
            "method_reuse": args.weight_method,
            "experiment_transfer": args.weight_experiment,
            "citation_value": args.weight_citation,
        }
    )
    answers_by_id = json.loads(Path(args.answers).read_text(encoding="utf-8")) if args.answers else None
    client = None if answers_by_id is not None else build_client()
    scorer = None
    if client is not None:
        scorer = lambda project, paper: score_with_client(client, project, paper, model=args.model)
    result = screen_papers(
        project,
        papers,
        incomplete,
        scorer=scorer,
        answers_by_id=answers_by_id,
        weights=weights,
        model=args.model,
    )
    out_dir = Path(args.out) if args.out else Path.cwd() / "runs" / result["created_at"]
    write_run(result, out_dir)
    print(json.dumps({"out": str(out_dir), "counts": result["counts"], "errors": result["errors"]}, ensure_ascii=False, indent=2))
    return 0 if not result["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .normalize import IncompletePaper, NormalizedPaper, load_candidates, normalize_candidates, parse_candidates_text
from .questions import MODEL_ID, build_questions, build_state, normalize_weights
from .router import Decision, route_paper


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def answers_from_sdk(response: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    raw_answers = getattr(response, "answers", None) or {}
    for key, answer in raw_answers.items():
        item: dict[str, Any] = {"type": getattr(answer, "type", None)}
        for field in ("noul", "score", "choice", "confidence", "probabilities", "legend"):
            if hasattr(answer, field):
                value = getattr(answer, field)
                item[field] = dict(value) if hasattr(value, "items") else value
        payload[key] = item
    return payload


def score_with_client(client: Any, project: dict[str, Any], paper: NormalizedPaper, model: str = MODEL_ID, stage: str = "abstract") -> dict[str, Any]:
    response = client.system_one(
        state=build_state(project, paper.to_dict(), stage),
        questions=build_questions(stage),
        model=model,
    )
    return answers_from_sdk(response)


def _can_refine(paper: NormalizedPaper) -> bool:
    return bool((paper.introduction or "").strip() and (paper.method or "").strip())


def screen_papers(
    project: dict[str, Any],
    papers: list[NormalizedPaper],
    incomplete: list[IncompletePaper],
    scorer: Callable[[dict[str, Any], NormalizedPaper], dict[str, Any]] | None = None,
    answers_by_id: dict[str, dict[str, Any]] | None = None,
    refine_answers_by_id: dict[str, dict[str, Any]] | None = None,
    weights: dict[str, float] | None = None,
    model: str = MODEL_ID,
    refine_keep_review: bool = True,
) -> dict[str, Any]:
    weights = normalize_weights(weights)
    decisions: list[dict[str, Any]] = []
    raw: dict[str, Any] = {}
    errors: list[dict[str, Any]] = []

    first_pass: list[dict[str, Any]] = []
    for paper in papers:
        try:
            if answers_by_id and paper.paper_id in answers_by_id:
                answers = answers_by_id[paper.paper_id]
            elif scorer:
                answers = scorer(project, paper)
            else:
                raise RuntimeError("TYPESAFE_API_KEY is missing; scoring requires a live Jev client")
            raw[paper.paper_id] = answers
            routed = route_paper(answers, weights=weights, flags=paper.flags)
            payload = {"paper": paper, "decision": routed}
            first_pass.append(payload)
        except Exception as exc:
            errors.append({"paper_id": paper.paper_id, "title": paper.title, "error": str(exc)})

    for item in first_pass:
        paper = item["paper"]
        routed = item["decision"]
        if refine_keep_review and routed.decision in {"keep", "review"}:
            if not _can_refine(paper):
                routed.evidence_stage = "refine_incomplete"
                routed.refine_reason = "missing_intro_method"
                routed.flags = list(routed.flags) + ["refine_incomplete"]
                paper.evidence_stage = "refine_incomplete"
                paper.flags = list(paper.flags) + ["refine_incomplete"]
            else:
                try:
                    if refine_answers_by_id and paper.paper_id in refine_answers_by_id:
                        refine_answers = refine_answers_by_id[paper.paper_id]
                    elif scorer:
                        refine_answers = scorer(project, paper)
                    else:
                        raise RuntimeError("second-pass answers missing")
                    raw[f"{paper.paper_id}::intro_method"] = refine_answers
                    routed = route_paper(refine_answers, weights=weights, flags=paper.flags)
                    routed.evidence_stage = "intro_method"
                    routed.refined = True
                    routed.refine_reason = "intro_method_override"
                    paper.evidence_stage = "intro_method"
                except Exception as exc:
                    errors.append({"paper_id": paper.paper_id, "title": paper.title, "error": str(exc)})
                    routed.evidence_stage = "refine_incomplete"
                    routed.refine_reason = "refine_failed"
                    routed.flags = list(routed.flags) + ["refine_failed"]
        decisions.append({"paper": paper.to_dict(), "decision": routed.to_dict()})

    for item in incomplete:
        decisions.append(
            {
                "paper": {
                    "paper_id": item.paper_id,
                    "title": item.title,
                    "authors": "",
                    "year": "",
                    "venue": "",
                    "abstract": "",
                    "source": "",
                    "url": "",
                    "language_risk": False,
                    "flags": [item.reason],
                    "introduction": "",
                    "method": "",
                    "full_text": "",
                    "evidence_stage": "abstract",
                    "section_source": "",
                },
                "decision": Decision(
                    decision="incomplete",
                    reason=item.reason,
                    weighted_score=0.0,
                    gates=[],
                    scores={},
                    score_confidence={},
                    role="skip",
                    role_confidence=0.0,
                    flags=[item.reason],
                ).to_dict(),
            }
        )

    ranked = sorted(
        [row for row in decisions if row["decision"]["decision"] != "incomplete"],
        key=lambda row: row["decision"]["weighted_score"],
        reverse=True,
    )
    return {
        "model": model,
        "created_at": _now(),
        "project": project,
        "weights": weights,
        "counts": {
            "scored": len(papers),
            "incomplete": len(incomplete),
            "errors": len(errors),
            "keep": sum(1 for row in decisions if row["decision"]["decision"] == "keep"),
            "review": sum(1 for row in decisions if row["decision"]["decision"] == "review"),
            "drop": sum(1 for row in decisions if row["decision"]["decision"] == "drop"),
        },
        "decisions": decisions,
        "ranked": ranked,
        "raw_jev": raw,
        "errors": errors,
        "disclaimer": "Screening aid only. Not official related-work evidence.",
    }


def write_run(result: dict[str, Any], out_dir: str | Path) -> Path:
    path = Path(out_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / "inputs.json").write_text(
        json.dumps({"project": result["project"], "weights": result["weights"]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (path / "raw_jev.json").write_text(json.dumps(result["raw_jev"], ensure_ascii=False, indent=2), encoding="utf-8")
    (path / "decisions.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    fieldnames = [
        "decision", "reason", "weighted_score", "role", "paper_id", "title", "year", "venue",
        "source", "url", "problem_overlap", "method_reuse", "experiment_transfer", "citation_value",
        "topic_match", "method_transferable", "evidence_compatible", "evidence_stage", "refined", "flags",
    ]
    with (path / "ranked.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in result["decisions"]:
            paper = row["paper"]
            decision = row["decision"]
            gates = {gate["name"]: gate["noul"] for gate in decision.get("gates", [])}
            scores = decision.get("scores") or {}
            writer.writerow(
                {
                    "decision": decision.get("decision"),
                    "reason": decision.get("reason"),
                    "weighted_score": decision.get("weighted_score"),
                    "role": decision.get("role"),
                    "paper_id": paper.get("paper_id"),
                    "title": paper.get("title"),
                    "year": paper.get("year"),
                    "venue": paper.get("venue"),
                    "source": paper.get("source"),
                    "url": paper.get("url"),
                    "problem_overlap": scores.get("problem_overlap"),
                    "method_reuse": scores.get("method_reuse"),
                    "experiment_transfer": scores.get("experiment_transfer"),
                    "citation_value": scores.get("citation_value"),
                    "topic_match": gates.get("topic_match"),
                    "method_transferable": gates.get("method_transferable"),
                    "evidence_compatible": gates.get("evidence_compatible"),
                    "evidence_stage": decision.get("evidence_stage") or paper.get("evidence_stage") or "abstract",
                    "refined": decision.get("refined"),
                    "flags": ";".join(decision.get("flags") or paper.get("flags") or []),
                }
            )
    return path


def load_project(path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "project" in payload:
        payload = payload["project"]
    return {
        "title": payload.get("title") or "",
        "brief": payload.get("brief") or payload.get("description") or "",
        "method_constraints": payload.get("method_constraints") or "",
        "evidence_constraints": payload.get("evidence_constraints") or "",
    }


def candidates_from_text(text: str, filename: str = "", source_hint: str = "") -> tuple[list[NormalizedPaper], list[IncompletePaper]]:
    return normalize_candidates(parse_candidates_text(text, filename=filename), source_hint=source_hint)


def candidates_from_path(path: str | Path, source_hint: str = "") -> tuple[list[NormalizedPaper], list[IncompletePaper]]:
    return load_candidates(path, source_hint=source_hint)

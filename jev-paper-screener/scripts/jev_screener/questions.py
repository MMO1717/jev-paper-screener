from __future__ import annotations

from typing import Any

MODEL_ID = "jev-1.13.0"
MODEL_ALIAS = "jev-latest"
SCORE_DIMENSIONS = (
    "problem_overlap",
    "method_reuse",
    "experiment_transfer",
    "citation_value",
)
DEFAULT_WEIGHTS = {
    "problem_overlap": 0.35,
    "method_reuse": 0.30,
    "experiment_transfer": 0.20,
    "citation_value": 0.15,
}
HARD_GATES = ("topic_match", "method_transferable", "evidence_compatible")
ROLE_OPTIONS = {
    "baseline": "Use as a comparable baseline or competing method.",
    "method": "Reuse or adapt a method, architecture, or training recipe.",
    "related_work": "Cite as related work or positioning, not as a method to copy.",
    "dataset": "Reuse a dataset, benchmark, or evaluation protocol.",
    "skip": "Do not use this paper for the current project paper.",
}
SCORE_LEVELS = [
    "No usable overlap with the project.",
    "Weak or incidental overlap.",
    "Partial overlap that could inform one section.",
    "Direct overlap that should shape the project paper.",
]


def normalize_weights(weights: dict[str, float] | None = None) -> dict[str, float]:
    raw = dict(DEFAULT_WEIGHTS)
    if weights:
        for key, value in weights.items():
            if key in raw:
                raw[key] = float(value)
    total = sum(raw.values())
    if total <= 0:
        raise ValueError("weights must sum to a positive number")
    return {key: value / total for key, value in raw.items()}


def build_state(project: dict[str, Any], paper: dict[str, Any], stage: str = "abstract") -> dict[str, Any]:
    paper_state = (
        {
            "title": paper.get("title") or "",
            "introduction": paper.get("introduction") or "",
            "method": paper.get("method") or "",
        }
        if stage == "intro_method"
        else {
            "title": paper.get("title") or "",
            "authors": paper.get("authors") or "",
            "year": paper.get("year") or "",
            "venue": paper.get("venue") or "",
            "abstract": paper.get("abstract") or "",
        }
    )
    return {
        "project": {
            "title": project.get("title") or "",
            "brief": project.get("brief") or "",
            "method_constraints": project.get("method_constraints") or "",
            "evidence_constraints": project.get("evidence_constraints") or "",
        },
        "paper": paper_state,
    }


def build_questions(stage: str = "abstract") -> dict[str, dict[str, Any]]:
    evidence_fields = (
        "`paper.title`, `paper.introduction`, and `paper.method`"
        if stage == "intro_method"
        else "`paper.title` and `paper.abstract`"
    )
    method_evidence = "`paper.method`" if stage == "intro_method" else "`paper.abstract`"
    return {
        "topic_match": {
            "type": "noul",
            "instructions": f"Based only on {evidence_fields}, is this paper about the same research problem family as `project.title` and `project.brief`?",
            "criteria": {
                "true": "The paper addresses the same problem family, task, or scientific question as the project.",
                "false": "The paper is about a different problem, even if some methods or keywords overlap.",
            },
        },
        "method_transferable": {
            "type": "noul",
            "instructions": f"Based only on {evidence_fields}, could a method, architecture, training recipe, or analysis procedure from this paper be reused in the project described by `project.brief` and `project.method_constraints`?",
            "criteria": {
                "true": "The described method could be adapted without changing the project's core task.",
                "false": "The method is tied to a different task, modality, or setting that the project cannot use.",
            },
        },
        "evidence_compatible": {
            "type": "noul",
            "instructions": f"Based only on {evidence_fields}, is the paper's evidence type compatible with `project.evidence_constraints`?",
            "criteria": {
                "true": "The paper's data, evaluation, or evidence type can sit beside the project's intended evidence without a category error.",
                "false": "The paper's evidence is a different kind, such as clinical claims, official scores, or a mismatched modality, and should not be mixed in.",
            },
        },
        "problem_overlap": {
            "type": "score",
            "instructions": f"How much does {method_evidence} overlap the project's scientific problem?",
            "criteria": SCORE_LEVELS,
        },
        "method_reuse": {
            "type": "score",
            "instructions": f"How reusable is the method described in {method_evidence} for the current project?",
            "criteria": SCORE_LEVELS,
        },
        "experiment_transfer": {
            "type": "score",
            "instructions": "How transferable are the paper's experiments, metrics, or evaluation setup to the project?",
            "criteria": SCORE_LEVELS,
        },
        "citation_value": {
            "type": "score",
            "instructions": "How useful would this paper be as a citation in the project paper, even if the method is not copied?",
            "criteria": SCORE_LEVELS,
        },
        "role_in_paper": {
            "type": "choice",
            "instructions": "If this paper is used in the project paper, what is its primary role?",
            "criteria": ROLE_OPTIONS,
        },
    }

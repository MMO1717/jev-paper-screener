from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .questions import HARD_GATES, SCORE_DIMENSIONS, normalize_weights

GATE_YES = 0.5
GATE_CONFIDENCE = 0.7
KEEP_SCORE = 0.62
DROP_SCORE = 0.38
KEEP_CONFIDENCE = 0.55
SCORE_MAX = 3.0


@dataclass
class GateResult:
    name: str
    noul: float
    rejected: bool
    uncertain: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Decision:
    decision: str
    reason: str
    weighted_score: float
    gates: list[GateResult]
    scores: dict[str, float]
    score_confidence: dict[str, float]
    role: str
    role_confidence: float
    flags: list[str] = field(default_factory=list)
    evidence_stage: str = "abstract"
    refined: bool = False
    refine_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["gates"] = [gate.to_dict() for gate in self.gates]
        return payload


def _noul(answers: dict[str, Any], key: str) -> float:
    value = answers.get(key) or {}
    if "noul" in value:
        return float(value["noul"])
    return float(value.get("value", 0.0))


def _score(answers: dict[str, Any], key: str) -> float:
    value = answers.get(key) or {}
    if "score" in value:
        return float(value["score"])
    return float(value.get("value", 0.0))


def _confidence(answers: dict[str, Any], key: str) -> float:
    value = answers.get(key) or {}
    if "confidence" in value:
        return float(value["confidence"])
    noul = value.get("noul")
    if noul is None:
        return 0.0
    return abs(float(noul) - 0.5) * 2


def _choice(answers: dict[str, Any], key: str) -> tuple[str, float]:
    value = answers.get(key) or {}
    return str(value.get("choice") or "skip"), float(value.get("confidence") or 0.0)


def weighted_score(answers: dict[str, Any], weights: dict[str, float] | None = None) -> tuple[float, dict[str, float]]:
    weights = normalize_weights(weights)
    scores = {key: _score(answers, key) / SCORE_MAX for key in SCORE_DIMENSIONS}
    total = sum(scores[key] * weights[key] for key in SCORE_DIMENSIONS)
    return total, scores


def route_paper(
    answers: dict[str, Any],
    weights: dict[str, float] | None = None,
    flags: list[str] | None = None,
) -> Decision:
    flags = list(flags or [])
    total, scores = weighted_score(answers, weights)
    score_confidence = {key: _confidence(answers, key) for key in SCORE_DIMENSIONS}
    mean_confidence = sum(score_confidence.values()) / max(len(score_confidence), 1)
    role, role_confidence = _choice(answers, "role_in_paper")

    gates: list[GateResult] = []
    hard_reject = False
    uncertain_reject = False
    for name in HARD_GATES:
        noul = _noul(answers, name)
        confidence = abs(noul - 0.5) * 2
        rejected = noul < GATE_YES
        uncertain = rejected and confidence < GATE_CONFIDENCE
        if rejected and not uncertain:
            hard_reject = True
        if uncertain:
            uncertain_reject = True
        gates.append(GateResult(name=name, noul=noul, rejected=rejected, uncertain=uncertain))

    if hard_reject:
        decision, reason = "drop", "hard_gate_reject"
    elif uncertain_reject:
        decision, reason = "review", "hard_gate_uncertain"
    elif total >= KEEP_SCORE and mean_confidence >= KEEP_CONFIDENCE and role != "skip":
        decision, reason = "keep", "gates_pass_high_score"
    elif total <= DROP_SCORE:
        decision, reason = "drop", "low_weighted_score"
    else:
        decision, reason = "review", "mid_band_or_low_confidence"

    if role == "skip" and decision == "keep":
        decision, reason = "review", "role_skip"
    if "language_risk" in flags and decision == "keep":
        decision, reason = "review", "language_risk"
        flags = flags + ["held_for_language_risk"]

    return Decision(
        decision=decision,
        reason=reason,
        weighted_score=round(total, 4),
        gates=gates,
        scores={key: round(value, 4) for key, value in scores.items()},
        score_confidence={key: round(value, 4) for key, value in score_confidence.items()},
        role=role,
        role_confidence=round(role_confidence, 4),
        flags=flags,
        evidence_stage="abstract",
        refined=False,
    )

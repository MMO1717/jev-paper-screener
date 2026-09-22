from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

CJK_RE = re.compile(r"[\u3400-\u9fff]")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


@dataclass
class NormalizedPaper:
    paper_id: str
    title: str
    authors: str
    year: str
    venue: str
    abstract: str
    source: str
    url: str
    language_risk: bool
    flags: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class IncompletePaper:
    paper_id: str
    title: str
    reason: str
    raw: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "; ".join(_as_text(item) for item in value if _as_text(item))
    if isinstance(value, dict):
        for key in ("name", "text", "value", "title"):
            if key in value:
                return _as_text(value[key])
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip()


def _first(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        if key in record and _as_text(record[key]):
            return _as_text(record[key])
        lower = key.lower()
        for actual, value in record.items():
            if str(actual).lower() == lower and _as_text(value):
                return _as_text(value)
    return ""


def _year(record: dict[str, Any]) -> str:
    raw = _first(record, "year", "published", "date", "publication_year")
    match = YEAR_RE.search(raw)
    return match.group(0) if match else raw


def _paper_id(record: dict[str, Any], title: str, abstract: str) -> str:
    explicit = _first(record, "paper_id", "id", "doi", "arxiv_id", "uid")
    if explicit:
        return explicit
    digest = hashlib.sha1(f"{title}\n{abstract}".encode("utf-8")).hexdigest()[:12]
    return f"paper-{digest}"


def has_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text or ""))


def normalize_record(record: dict[str, Any], source_hint: str = "") -> tuple[NormalizedPaper | None, IncompletePaper | None]:
    title = _first(record, "title", "paper_title", "name")
    abstract = _first(record, "abstract", "summary", "abs")
    paper_id = _paper_id(record, title, abstract)
    if not title:
        return None, IncompletePaper(paper_id=paper_id or "unknown", title="", reason="missing_title", raw=record)
    if not abstract:
        return None, IncompletePaper(paper_id=paper_id, title=title, reason="missing_abstract", raw=record)
    flags: list[str] = []
    language_risk = has_cjk(f"{title}\n{abstract}")
    if language_risk:
        flags.append("language_risk")
    paper = NormalizedPaper(
        paper_id=paper_id,
        title=title,
        authors=_first(record, "authors", "author", "author_list"),
        year=_year(record),
        venue=_first(record, "venue", "journal", "booktitle", "source_venue"),
        abstract=abstract,
        source=_first(record, "source", "database") or source_hint,
        url=_first(record, "url", "link", "pdf_url", "html_url"),
        language_risk=language_risk,
        flags=flags,
    )
    return paper, None


def _from_object(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        raise ValueError("candidate payload must be a JSON object, array, CSV, or BibTeX")
    for key in ("papers", "items", "results", "records", "data", "hits"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = _from_object(value)
            if nested:
                return nested
    if any(key in payload for key in ("title", "abstract", "summary")):
        return [payload]
    raise ValueError("could not find a paper list in the JSON payload")


def parse_json_text(text: str) -> list[dict[str, Any]]:
    return _from_object(json.loads(text))


def parse_csv_text(text: str) -> list[dict[str, Any]]:
    return [dict(row) for row in csv.DictReader(text.splitlines())]


def parse_bibtex_text(text: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    blocks = re.split(r"(?=@\w+\s*\{)", text)
    for block in blocks:
        block = block.strip()
        if not block.startswith("@"):
            continue
        header = re.match(r"@\w+\s*\{\s*([^,]+)\s*,", block, re.S)
        fields = dict(re.findall(r"(\w+)\s*=\s*[{\"](.+?)[}\"]\s*,?", block, re.S))
        cleaned = {key.lower(): re.sub(r"\s+", " ", value).strip() for key, value in fields.items()}
        if header:
            cleaned.setdefault("paper_id", header.group(1).strip())
        records.append(cleaned)
    return records


def parse_candidates_text(text: str, filename: str = "") -> list[dict[str, Any]]:
    stripped = text.strip()
    if not stripped:
        return []
    lower_name = filename.lower()
    if lower_name.endswith(".csv"):
        return parse_csv_text(stripped)
    if lower_name.endswith(".bib") or stripped.startswith("@"):
        return parse_bibtex_text(stripped)
    if stripped[0] in "[{":
        return parse_json_text(stripped)
    try:
        return parse_json_text(stripped)
    except json.JSONDecodeError:
        if "," in stripped.splitlines()[0]:
            return parse_csv_text(stripped)
        return parse_bibtex_text(stripped)


def normalize_candidates(records: Iterable[dict[str, Any]], source_hint: str = "") -> tuple[list[NormalizedPaper], list[IncompletePaper]]:
    papers: list[NormalizedPaper] = []
    incomplete: list[IncompletePaper] = []
    seen: set[str] = set()
    for record in records:
        paper, missing = normalize_record(record, source_hint=source_hint)
        if missing:
            incomplete.append(missing)
            continue
        assert paper is not None
        if paper.paper_id in seen:
            incomplete.append(IncompletePaper(paper_id=paper.paper_id, title=paper.title, reason="duplicate", raw=record))
            continue
        seen.add(paper.paper_id)
        papers.append(paper)
    return papers, incomplete


def load_candidates(path: str | Path, source_hint: str = "") -> tuple[list[NormalizedPaper], list[IncompletePaper]]:
    file_path = Path(path)
    records = parse_candidates_text(file_path.read_text(encoding="utf-8"), filename=file_path.name)
    return normalize_candidates(records, source_hint=source_hint or file_path.stem)

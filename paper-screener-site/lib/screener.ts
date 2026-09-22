export const MODEL_ID = "jev-1.13.0";

export const SCORE_DIMENSIONS = [
  "problem_overlap",
  "method_reuse",
  "experiment_transfer",
  "citation_value",
] as const;

export const DEFAULT_WEIGHTS: Record<(typeof SCORE_DIMENSIONS)[number], number> = {
  problem_overlap: 0.35,
  method_reuse: 0.3,
  experiment_transfer: 0.2,
  citation_value: 0.15,
};

export const HARD_GATES = [
  "topic_match",
  "method_transferable",
  "evidence_compatible",
] as const;

export const ROLE_OPTIONS = {
  baseline: "Use as a comparable baseline or competing method.",
  method: "Reuse or adapt a method, architecture, or training recipe.",
  related_work: "Cite as related work or positioning, not as a method to copy.",
  dataset: "Reuse a dataset, benchmark, or evaluation protocol.",
  skip: "Do not use this paper for the current project paper.",
} as const;

export const SCORE_LEVELS = [
  "No usable overlap with the project.",
  "Weak or incidental overlap.",
  "Partial overlap that could inform one section.",
  "Direct overlap that should shape the project paper.",
];

export type ProjectBrief = {
  title: string;
  brief: string;
  method_constraints: string;
  evidence_constraints: string;
};

export type PaperRecord = {
  paper_id: string;
  title: string;
  authors: string;
  year: string;
  venue: string;
  abstract: string;
  source: string;
  url: string;
  language_risk: boolean;
  flags: string[];
};

export type IncompletePaper = {
  paper_id: string;
  title: string;
  reason: string;
};

export type GateResult = {
  name: string;
  noul: number;
  rejected: boolean;
  uncertain: boolean;
};

export type Decision = {
  decision: "keep" | "review" | "drop" | "incomplete";
  reason: string;
  weighted_score: number;
  gates: GateResult[];
  scores: Record<string, number>;
  score_confidence: Record<string, number>;
  role: string;
  role_confidence: number;
  flags: string[];
};

export type ScreenedPaper = {
  paper: PaperRecord;
  decision: Decision;
};

const CJK_RE = /[\u3400-\u9fff]/;
const YEAR_RE = /\b(19|20)\d{2}\b/;
const GATE_YES = 0.5;
const GATE_CONFIDENCE = 0.7;
const KEEP_SCORE = 0.62;
const DROP_SCORE = 0.38;
const KEEP_CONFIDENCE = 0.55;
const SCORE_MAX = 3;

function asText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "text", "value", "title"]) {
      if (key in record) return asText(record[key]);
    }
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function first(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (key in record && asText(record[key])) return asText(record[key]);
    const lower = key.toLowerCase();
    for (const [actual, value] of Object.entries(record)) {
      if (actual.toLowerCase() === lower && asText(value)) return asText(value);
    }
  }
  return "";
}

function paperId(record: Record<string, unknown>, title: string, abstract: string) {
  const explicit = first(record, ["paper_id", "id", "doi", "arxiv_id", "uid"]);
  if (explicit) return explicit;
  return `paper-${hash12(`${title}\n${abstract}`)}`;
}

function hash12(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 12);
}

export function normalizeWeights(weights?: Record<string, number>) {
  const raw = { ...DEFAULT_WEIGHTS };
  if (weights) {
    for (const key of SCORE_DIMENSIONS) {
      if (typeof weights[key] === "number") raw[key] = weights[key];
    }
  }
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error("weights must sum to a positive number");
  return Object.fromEntries(
    SCORE_DIMENSIONS.map((key) => [key, raw[key] / total]),
  ) as Record<(typeof SCORE_DIMENSIONS)[number], number>;
}

export function buildQuestions() {
  return {
    topic_match: {
      type: "noul",
      instructions:
        "Based only on `paper.title` and `paper.abstract`, is this paper about the same research problem family as `project.title` and `project.brief`?",
      criteria: {
        true: "The paper addresses the same problem family, task, or scientific question as the project.",
        false: "The paper is about a different problem, even if some methods or keywords overlap.",
      },
    },
    method_transferable: {
      type: "noul",
      instructions:
        "Based only on `paper.title` and `paper.abstract`, could a method, architecture, training recipe, or analysis procedure from this paper be reused in the project described by `project.brief` and `project.method_constraints`?",
      criteria: {
        true: "The abstract describes a method that could be adapted without changing the project's core task.",
        false: "The method is tied to a different task, modality, or setting that the project cannot use.",
      },
    },
    evidence_compatible: {
      type: "noul",
      instructions:
        "Based only on `paper.title` and `paper.abstract`, is the paper's evidence type compatible with `project.evidence_constraints`?",
      criteria: {
        true: "The paper's data, evaluation, or evidence type can sit beside the project's intended evidence without a category error.",
        false: "The paper's evidence is a different kind, such as clinical claims, official scores, or a mismatched modality, and should not be mixed in.",
      },
    },
    problem_overlap: {
      type: "score",
      instructions: "How much does `paper.abstract` overlap the project's scientific problem?",
      criteria: SCORE_LEVELS,
    },
    method_reuse: {
      type: "score",
      instructions: "How reusable is the paper's method for the current project?",
      criteria: SCORE_LEVELS,
    },
    experiment_transfer: {
      type: "score",
      instructions: "How transferable are the paper's experiments, metrics, or evaluation setup to the project?",
      criteria: SCORE_LEVELS,
    },
    citation_value: {
      type: "score",
      instructions: "How useful would this paper be as a citation in the project paper, even if the method is not copied?",
      criteria: SCORE_LEVELS,
    },
    role_in_paper: {
      type: "choice",
      instructions: "If this paper is used in the project paper, what is its primary role?",
      criteria: ROLE_OPTIONS,
    },
  };
}

export function buildState(project: ProjectBrief, paper: PaperRecord) {
  return {
    project: {
      title: project.title || "",
      brief: project.brief || "",
      method_constraints: project.method_constraints || "",
      evidence_constraints: project.evidence_constraints || "",
    },
    paper: {
      title: paper.title || "",
      authors: paper.authors || "",
      year: paper.year || "",
      venue: paper.venue || "",
      abstract: paper.abstract || "",
    },
  };
}

export function normalizeRecord(record: Record<string, unknown>, sourceHint = ""): { paper?: PaperRecord; incomplete?: IncompletePaper } {
  const title = first(record, ["title", "paper_title", "name"]);
  const abstract = first(record, ["abstract", "summary", "abs"]);
  const id = paperId(record, title, abstract);
  if (!title) return { incomplete: { paper_id: id || "unknown", title: "", reason: "missing_title" } };
  if (!abstract) return { incomplete: { paper_id: id, title, reason: "missing_abstract" } };
  const languageRisk = CJK_RE.test(`${title}\n${abstract}`);
  const yearRaw = first(record, ["year", "published", "date", "publication_year"]);
  const year = YEAR_RE.exec(yearRaw)?.[0] ?? yearRaw;
  return {
    paper: {
      paper_id: id,
      title,
      authors: first(record, ["authors", "author", "author_list"]),
      year,
      venue: first(record, ["venue", "journal", "booktitle", "source_venue"]),
      abstract,
      source: first(record, ["source", "database"]) || sourceHint,
      url: first(record, ["url", "link", "pdf_url", "html_url"]),
      language_risk: languageRisk,
      flags: languageRisk ? ["language_risk"] : [],
    },
  };
}

function fromObject(payload: unknown): Record<string, unknown>[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (typeof payload !== "object") throw new Error("candidate payload must be JSON, CSV, or BibTeX");
  const record = payload as Record<string, unknown>;
  for (const key of ["papers", "items", "results", "records", "data", "hits"]) {
    const value = record[key];
    if (Array.isArray(value)) return fromObject(value);
    if (value && typeof value === "object") {
      const nested = fromObject(value);
      if (nested.length) return nested;
    }
  }
  if ("title" in record || "abstract" in record || "summary" in record) return [record];
  throw new Error("could not find a paper list in the JSON payload");
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
}

function splitCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out;
}

function parseBibtex(text: string) {
  const blocks = text.split(/(?=@\w+\s*\{)/);
  const records: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed.startsWith("@")) continue;
    const header = trimmed.match(/@\w+\s*\{\s*([^,]+)\s*,/);
    const fields = [...trimmed.matchAll(/(\w+)\s*=\s*[{"](.+?)[}"]\s*,?/gs)];
    const cleaned: Record<string, unknown> = {};
    for (const [, key, value] of fields) cleaned[key.toLowerCase()] = value.replace(/\s+/g, " ").trim();
    if (header) cleaned.paper_id = header[1].trim();
    records.push(cleaned);
  }
  return records;
}

export function parseCandidatesText(text: string, filename = "") {
  const stripped = text.trim();
  if (!stripped) return [];
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(stripped);
  if (lower.endsWith(".bib") || stripped.startsWith("@")) return parseBibtex(stripped);
  if (stripped[0] === "[" || stripped[0] === "{") return fromObject(JSON.parse(stripped));
  try {
    return fromObject(JSON.parse(stripped));
  } catch {
    if (stripped.split("\n")[0]?.includes(",")) return parseCsv(stripped);
    return parseBibtex(stripped);
  }
}

export function normalizeCandidates(records: Record<string, unknown>[], sourceHint = "") {
  const papers: PaperRecord[] = [];
  const incomplete: IncompletePaper[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const result = normalizeRecord(record, sourceHint);
    if (result.incomplete) {
      incomplete.push(result.incomplete);
      continue;
    }
    const paper = result.paper!;
    if (seen.has(paper.paper_id)) {
      incomplete.push({ paper_id: paper.paper_id, title: paper.title, reason: "duplicate" });
      continue;
    }
    seen.add(paper.paper_id);
    papers.push(paper);
  }
  return { papers, incomplete };
}

function noul(answers: Record<string, any>, key: string) {
  const value = answers[key] || {};
  if (typeof value.noul === "number") return value.noul;
  return Number(value.value || 0);
}

function score(answers: Record<string, any>, key: string) {
  const value = answers[key] || {};
  if (typeof value.score === "number") return value.score;
  return Number(value.value || 0);
}

function confidence(answers: Record<string, any>, key: string) {
  const value = answers[key] || {};
  if (typeof value.confidence === "number") return value.confidence;
  if (typeof value.noul === "number") return Math.abs(value.noul - 0.5) * 2;
  return 0;
}

export function routePaper(answers: Record<string, any>, weights?: Record<string, number>, flags: string[] = []): Decision {
  const normalized = normalizeWeights(weights);
  const scores = Object.fromEntries(
    SCORE_DIMENSIONS.map((key) => [key, score(answers, key) / SCORE_MAX]),
  );
  const total = SCORE_DIMENSIONS.reduce((sum, key) => sum + scores[key] * normalized[key], 0);
  const scoreConfidence = Object.fromEntries(
    SCORE_DIMENSIONS.map((key) => [key, confidence(answers, key)]),
  );
  const meanConfidence =
    Object.values(scoreConfidence).reduce((sum, value) => sum + value, 0) /
    Math.max(Object.values(scoreConfidence).length, 1);
  const roleValue = answers.role_in_paper || {};
  const role = String(roleValue.choice || "skip");
  const roleConfidence = Number(roleValue.confidence || 0);
  const gates: GateResult[] = [];
  let hardReject = false;
  let uncertainReject = false;
  for (const name of HARD_GATES) {
    const value = noul(answers, name);
    const gateConfidence = Math.abs(value - 0.5) * 2;
    const rejected = value < GATE_YES;
    const uncertain = rejected && gateConfidence < GATE_CONFIDENCE;
    if (rejected && !uncertain) hardReject = true;
    if (uncertain) uncertainReject = true;
    gates.push({ name, noul: value, rejected, uncertain });
  }
  let decision: Decision["decision"] = "review";
  let reason = "mid_band_or_low_confidence";
  let nextFlags = [...flags];
  if (hardReject) {
    decision = "drop";
    reason = "hard_gate_reject";
  } else if (uncertainReject) {
    decision = "review";
    reason = "hard_gate_uncertain";
  } else if (total >= KEEP_SCORE && meanConfidence >= KEEP_CONFIDENCE && role !== "skip") {
    decision = "keep";
    reason = "gates_pass_high_score";
  } else if (total <= DROP_SCORE) {
    decision = "drop";
    reason = "low_weighted_score";
  }
  if (role === "skip" && decision === "keep") {
    decision = "review";
    reason = "role_skip";
  }
  if (nextFlags.includes("language_risk") && decision === "keep") {
    decision = "review";
    reason = "language_risk";
    nextFlags = [...nextFlags, "held_for_language_risk"];
  }
  return {
    decision,
    reason,
    weighted_score: Number(total.toFixed(4)),
    gates,
    scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Number(value.toFixed(4))])),
    score_confidence: Object.fromEntries(
      Object.entries(scoreConfidence).map(([key, value]) => [key, Number(value.toFixed(4))]),
    ),
    role,
    role_confidence: Number(roleConfidence.toFixed(4)),
    flags: nextFlags,
  };
}

export function incompleteDecision(item: IncompletePaper): ScreenedPaper {
  return {
    paper: {
      paper_id: item.paper_id,
      title: item.title,
      authors: "",
      year: "",
      venue: "",
      abstract: "",
      source: "",
      url: "",
      language_risk: false,
      flags: [item.reason],
    },
    decision: {
      decision: "incomplete",
      reason: item.reason,
      weighted_score: 0,
      gates: [],
      scores: {},
      score_confidence: {},
      role: "skip",
      role_confidence: 0,
      flags: [item.reason],
    },
  };
}

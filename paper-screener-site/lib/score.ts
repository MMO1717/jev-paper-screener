import { env } from "cloudflare:workers";
import { canRefine, extractIntroMethodSections } from "./sections";
import {
  MODEL_ID,
  type EvidenceStage,
  type PaperRecord,
  type ProjectBrief,
  type ScreenedPaper,
  buildQuestions,
  buildState,
  incompleteDecision,
  routePaper,
} from "./screener";

type TypeSafeAnswer = {
  type?: string;
  noul?: number;
  score?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

async function scorePaper(project: ProjectBrief, paper: PaperRecord, apiKey: string, stage: EvidenceStage = "abstract") {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: buildState(project, paper, stage),
      model: MODEL_ID,
      questions: buildQuestions(stage),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message || `Jev scoring failed (${response.status}).`;
    throw new Error(message);
  }
  const answers = (payload?.answers || {}) as Record<string, TypeSafeAnswer>;
  return {
    paper,
    decision: routePaper(answers, undefined, paper.flags),
    raw: answers,
  };
}

function prepareRefineSections(paper: PaperRecord) {
  if (paper.introduction && paper.method) {
    return {
      introduction: paper.introduction,
      method: paper.method,
      section_source: paper.section_source || "heading",
    };
  }
  if (paper.full_text) return extractIntroMethodSections(paper.full_text);
  return extractIntroMethodSections("");
}

export async function scorePapers(
  project: ProjectBrief,
  papers: PaperRecord[],
  incomplete: { paper_id: string; title: string; reason: string }[],
  customApiKey?: string,
  refineKeepReview = true,
) {
  let envKey = "";
  try {
    envKey = (env as { TYPESAFE_API_KEY?: string })?.TYPESAFE_API_KEY || "";
  } catch {}
  const apiKey = (customApiKey || "").trim() || envKey || (typeof process !== "undefined" ? process.env?.TYPESAFE_API_KEY : "") || "";
  const decisions: ScreenedPaper[] = [];
  const raw: Record<string, Record<string, TypeSafeAnswer>> = {};
  const errors: { paper_id: string; title: string; error: string }[] = [];
  if (!apiKey) {
    return {
      ok: false,
      error: "未配置 TYPESAFE_API_KEY。请在页面左侧提供您的 TypeSafe API Key，或在服务端 .env 中配置。",
      decisions: incomplete.map(incompleteDecision),
    };
  }
  const BATCH_SIZE = 5;
  const firstPass: ScreenedPaper[] = [];
    for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    const chunk = papers.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (paper) => {
        try {
          const scored = await scorePaper(project, paper, apiKey, "abstract");
          scored.paper.evidence_stage = "abstract";
          scored.decision.evidence_stage = "abstract";
          firstPass.push({ paper: scored.paper, decision: scored.decision });
          firstRaw[paper.paper_id] = scored.raw;
          raw[paper.paper_id] = scored.raw;
        } catch (error) {
          errors.push({
            paper_id: paper.paper_id,
            title: paper.title,
            error: error instanceof Error ? error.message : "Scoring failed.",
          });
        }
      }),
    );
  }
  const refineTargets = refineKeepReview
    ? firstPass.filter((row) => row.decision.decision === "keep" || row.decision.decision === "review")
    : [];
  const refined = new Map<string, ScreenedPaper>();
  for (let i = 0; i < refineTargets.length; i += BATCH_SIZE) {
    const chunk = refineTargets.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (row) => {
        const sections = prepareRefineSections(row.paper);
        if (!canRefine(sections)) {
          const flagged = {
            ...row,
            paper: {
              ...row.paper,
              evidence_stage: "refine_incomplete" as const,
              flags: [...row.paper.flags, sections.missing_reason || "refine_incomplete"],
            },
            decision: {
              ...row.decision,
              evidence_stage: "refine_incomplete" as const,
              refined: false,
              refine_reason: sections.missing_reason || "refine_incomplete",
              flags: [...row.decision.flags, "refine_incomplete"],
            },
          };
          refined.set(row.paper.paper_id, flagged);
          return;
        }
        const paper = {
          ...row.paper,
          introduction: sections.introduction,
          method: sections.method,
          section_source: sections.section_source,
        };
        try {
          const scored = await scorePaper(project, paper, apiKey, "intro_method");
          scored.paper.evidence_stage = "intro_method";
          scored.decision.evidence_stage = "intro_method";
          scored.decision.refined = true;
          scored.decision.refine_reason = "intro_method_override";
          refined.set(paper.paper_id, { paper: scored.paper, decision: scored.decision });
          raw[`${paper.paper_id}::intro_method`] = scored.raw;
        } catch (error) {
          errors.push({
            paper_id: row.paper.paper_id,
            title: row.paper.title,
            error: error instanceof Error ? error.message : "Second-pass scoring failed.",
          });
          refined.set(row.paper.paper_id, {
            ...row,
            paper: { ...row.paper, evidence_stage: "refine_incomplete" },
            decision: {
              ...row.decision,
              evidence_stage: "refine_incomplete",
              refined: false,
              refine_reason: "refine_failed",
              flags: [...row.decision.flags, "refine_failed"],
            },
          });
        }
      }),
    );
  }
  for (const row of firstPass) {
    decisions.push(refined.get(row.paper.paper_id) || row);
  }
  decisions.push(...incomplete.map(incompleteDecision));
  return {
    ok: errors.length === 0,
    model: MODEL_ID,
    disclaimer: "Screening aid only. Not official related-work evidence.",
    counts: {
      scored: papers.length,
      incomplete: incomplete.length,
      errors: errors.length,
      keep: decisions.filter((row) => row.decision.decision === "keep").length,
      review: decisions.filter((row) => row.decision.decision === "review").length,
      drop: decisions.filter((row) => row.decision.decision === "drop").length,
    },
    decisions,
    raw_jev: raw,
    errors,
  };
}

import { env } from "cloudflare:workers";
import {
  MODEL_ID,
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

async function scorePaper(project: ProjectBrief, paper: PaperRecord, apiKey: string) {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: buildState(project, paper),
      model: MODEL_ID,
      questions: buildQuestions(),
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

export async function scorePapers(
  project: ProjectBrief,
  papers: PaperRecord[],
  incomplete: { paper_id: string; title: string; reason: string }[],
  customApiKey?: string,
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
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    const chunk = papers.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (paper) => {
        try {
          const scored = await scorePaper(project, paper, apiKey);
          decisions.push({ paper: scored.paper, decision: scored.decision });
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

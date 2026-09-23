export type SectionSource = "heading" | "fallback" | "missing";

export type ExtractedSections = {
  introduction: string;
  method: string;
  section_source: SectionSource;
  missing_reason?: string;
};

const INTRO_HEADING =
  /(?:^|\n)\s*(?:\d+\s*[.)]?\s*)?(?:introduction|引言|绪论)\b[^\n]*/i;
const METHOD_HEADING =
  /(?:^|\n)\s*(?:\d+\s*[.)]?\s*)?(?:method(?:s|ology)?|approach(?:es)?|model(?:s)?|proposed method|our method|方法|模型|算法)\b[^\n]*/i;
const NEXT_AFTER_INTRO =
  /(?:^|\n)\s*(?:\d+\s*[.)]?\s*)?(?:related work|background|method(?:s|ology)?|approach(?:es)?|model(?:s)?|experiment(?:s)?|evaluation|results?|discussion|conclusion|参考文献|相关工作|方法|实验)\b/i;
const NEXT_AFTER_METHOD =
  /(?:^|\n)\s*(?:\d+\s*[.)]?\s*)?(?:experiment(?:s)?|evaluation|results?|discussion|conclusion|ablation|implementation|相关工作|实验|结果|讨论|结论)\b/i;

function clean(text: string) {
  return text.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clip(text: string, max = 3500) {
  const value = clean(text);
  return value.length > max ? value.slice(0, max).trim() : value;
}

function headingIndex(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match || typeof match.index !== "number") return -1;
  return match.index + (match[0].startsWith("\n") ? 1 : 0);
}

function sliceUntil(text: string, start: number, stopPattern: RegExp) {
  const rest = text.slice(start);
  const firstLineEnd = rest.indexOf("\n");
  const bodyStart = firstLineEnd >= 0 ? firstLineEnd + 1 : 0;
  const body = rest.slice(bodyStart);
  const stop = stopPattern.exec(body);
  const end = stop && typeof stop.index === "number" ? stop.index : Math.min(body.length, 4000);
  return clip(body.slice(0, end));
}

function fallbackIntroduction(text: string) {
  const abstractSplit = text.split(/\b(?:Abstract|ABSTRACT|摘要)\b[\s:—–.-]*/i);
  const after = abstractSplit.length > 1 ? abstractSplit.slice(1).join(" ") : text;
  const withoutIntroHeading = after.replace(/^\s*(?:\d+\s*[.)]?\s*)?(?:introduction|引言)[^\n]*\n?/i, "");
  const paragraphs = withoutIntroHeading
    .split(/\n\s*\n/)
    .map((item) => clean(item))
    .filter((item) => item && !/^(keywords?|index terms)\b/i.test(item));
  return clip(paragraphs.slice(0, 2).join("\n\n"));
}

function fallbackMethod(text: string) {
  const methodIdx = headingIndex(text, METHOD_HEADING);
  if (methodIdx >= 0) return sliceUntil(text, methodIdx, NEXT_AFTER_METHOD);
  return "";
}

export function extractIntroMethodSections(text: string): ExtractedSections {
  const source = clean(text);
  if (!source) {
    return { introduction: "", method: "", section_source: "missing", missing_reason: "empty_text" };
  }
  const introIdx = headingIndex(source, INTRO_HEADING);
  const methodIdx = headingIndex(source, METHOD_HEADING);
  let introduction = "";
  let method = "";
  let sectionSource: SectionSource = "missing";
  if (introIdx >= 0) {
    introduction = sliceUntil(source, introIdx, NEXT_AFTER_INTRO);
    sectionSource = "heading";
  }
  if (methodIdx >= 0) {
    method = sliceUntil(source, methodIdx, NEXT_AFTER_METHOD);
    sectionSource = "heading";
  }
  if (!introduction) introduction = fallbackIntroduction(source);
  if (!method) method = fallbackMethod(source);
  if (introduction && method) {
    return {
      introduction,
      method,
      section_source: sectionSource === "heading" ? "heading" : "fallback",
    };
  }
  const missing = !introduction && !method ? "missing_intro_method" : !introduction ? "missing_introduction" : "missing_method";
  return {
    introduction,
    method,
    section_source: "missing",
    missing_reason: missing,
  };
}

export function htmlToPlainText(html: string) {
  return clean(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

export function canRefine(sections: ExtractedSections) {
  return Boolean(sections.introduction && sections.method && sections.section_source !== "missing");
}

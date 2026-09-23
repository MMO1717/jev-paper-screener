import { extractText } from "unpdf";
import { canRefine, extractIntroMethodSections } from "./sections";
import { type IncompletePaper, type PaperRecord, normalizeCandidates } from "./screener";

const BANNER_PATTERNS = [
  /arxiv:\d{4}\.\d{4,5}/i,
  /under review as a conference paper/i,
  /proceedings of/i,
  /provided proper attribution/i,
  /hereby grants permission/i,
  /solely for use in/i,
  /permission to (?:make|reproduce|use)/i,
  /published as a journal paper/i,
  /ieee transactions/i,
  /acm transactions/i,
  /to appear in/i,
  /preprint\.?/i,
  /submitted to/i,
  /all rights reserved/i,
  /copyright \d{4}/i,
  /scholarly works/i,
];

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export function extractPaperFromPdfText(
  pagesText: string[],
  fallbackTitle = "PDF Document",
  url = "",
  source = "pdf",
): { papers: PaperRecord[]; incomplete: IncompletePaper[] } {
  const combined = pagesText.slice(0, 2).join("\n\n");
  if (!combined.trim()) {
    return {
      papers: [],
      incomplete: [
        {
          paper_id: fallbackTitle || "pdf",
          title: fallbackTitle,
          reason: "empty_pdf_or_scanned_without_ocr",
        },
      ],
    };
  }

  // Find Abstract
  const abstractRegex = /\b(?:Abstract|ABSTRACT|Summary|SUMMARY)[\s:—–.-]*\n?([\s\S]*)/i;
  const match = combined.match(abstractRegex);

  let rawAbstract = "";
  let preAbstract = combined;

  if (match) {
    const afterAbstract = match[1];
    preAbstract = combined.slice(0, match.index);

    // Find end of abstract (Introduction, Keywords, Index Terms)
    const endMatch = afterAbstract.match(
      /(?:\n\s*(?:(?:1|I)\s*[.\s]\s*Introduction|INTRODUCTION|Key\s*words[:—–\s]|Keywords[:—–\s]|Index Terms[:—–\s]))/i,
    );

    if (endMatch && typeof endMatch.index === "number") {
      rawAbstract = afterAbstract.slice(0, endMatch.index);
    } else {
      // Limit to first reasonable paragraph or 3000 chars
      const paragraphs = afterAbstract.split(/\n\s*\n/);
      rawAbstract = paragraphs.slice(0, 2).join("\n\n").slice(0, 3000);
    }
  }

  const abstract = cleanLine(rawAbstract);

  // Extract Title and Authors from preAbstract
  const preLines = preAbstract
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => {
      if (!line) return false;
      return !BANNER_PATTERNS.some((pat) => pat.test(line));
    });

  let title = "";
  let authors = "";

  if (preLines.length > 0) {
    const isAuthorLine = (line: string) => {
      // Author lines usually have asterisks, daggers, commas separating names, or followed immediately by affiliation
      if (/[*∗†‡§^]/.test(line)) return true;
      if (line.includes(",") && line.split(",").length >= 2) return true;
      if (line.includes(" and ") || line.includes(" & ")) return true;
      const lower = line.toLowerCase();
      return (
        lower.includes("@") ||
        lower.includes("university") ||
        lower.includes("department") ||
        lower.includes("laboratory") ||
        lower.includes("institute") ||
        lower.includes("google") ||
        lower.includes("meta") ||
        lower.includes("microsoft") ||
        lower.includes("research") ||
        lower.includes("school of") ||
        lower.includes("college")
      );
    };

    const titleLines: string[] = [];
    let i = 0;
    while (i < Math.min(preLines.length, 3)) {
      const line = preLines[i];
      if (isAuthorLine(line)) {
        break;
      }
      titleLines.push(line);
      i += 1;
      // If we already have a substantial title (> 20 chars) and the next line has author-like shape, stop
      if (titleLines.join(" ").length >= 20 && i < preLines.length && isAuthorLine(preLines[i])) {
        break;
      }
    }

    // If all lines were considered authors (i === 0), fall back to taking first line as title
    if (titleLines.length === 0) {
      title = preLines[0];
      i = 1;
    } else {
      title = titleLines.join(" ").trim();
    }

    // Remaining lines before abstract contain authors and affiliations
    const remainingLines = preLines.slice(i);
    authors = remainingLines
      .filter((l) => !l.includes("@") && !l.includes("http"))
      .join("; ")
      .slice(0, 300);
  } else {
    title = fallbackTitle;
  }

  // Extract year
  const yearMatch = combined.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";
  const fullText = pagesText.join("\n\n");
  const sections = extractIntroMethodSections(fullText);
  const normalized = normalizeCandidates(
    [
      {
        title,
        abstract,
        authors,
        year,
        venue: "PDF Document",
        url,
        source,
        introduction: sections.introduction,
        method: sections.method,
        full_text: fullText.slice(0, 20000),
      },
    ],
    source,
  );
  if (normalized.papers[0]) {
    const paper = normalized.papers[0];
    paper.introduction = sections.introduction;
    paper.method = sections.method;
    paper.full_text = fullText.slice(0, 20000);
    paper.section_source = sections.section_source;
    if (!canRefine(sections) && sections.missing_reason) {
      paper.flags = [...paper.flags, sections.missing_reason];
    }
  }
  return normalized;
}

export async function papersFromPdfBytes(
  bytes: Uint8Array,
  filename = "paper.pdf",
  url = "",
): Promise<{ papers: PaperRecord[]; incomplete: IncompletePaper[] }> {
  try {
    const { text } = await extractText(bytes, { mergePages: false });
    const fallbackTitle = filename.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
    return extractPaperFromPdfText(text, fallbackTitle, url, "pdf_upload");
  } catch (error) {
    return {
      papers: [],
      incomplete: [
        {
          paper_id: filename || "pdf",
          title: filename,
          reason: error instanceof Error ? `pdf_parse_error: ${error.message}` : "pdf_parse_error",
        },
      ],
    };
  }
}

import { papersFromPdfBytes } from "./pdf";
import { canRefine, extractIntroMethodSections, htmlToPlainText } from "./sections";
import {
  type IncompletePaper,
  type PaperRecord,
  normalizeCandidates,
  parseCandidatesText,
} from "./screener";

const MAX_BYTES = 12_000_000;
const FETCH_TIMEOUT_MS = 15_000;

function attachSections(result: { papers: PaperRecord[]; incomplete: IncompletePaper[] }, text: string) {
  if (!result.papers[0] || !text.trim()) return result;
  const sections = extractIntroMethodSections(text);
  const paper = result.papers[0];
  paper.introduction = sections.introduction;
  paper.method = sections.method;
  paper.full_text = text.slice(0, 20000);
  paper.section_source = sections.section_source;
  if (!canRefine(sections) && sections.missing_reason) {
    paper.flags = [...paper.flags, sections.missing_reason];
  }
  return result;
}


function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function meta(html: string, names: string[]) {
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtml(match[1]);
    }
  }
  return "";
}

function tagText(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeHtml(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : "";
}

function arxivId(url: string) {
  const match = url.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7})/i);
  return match?.[1]?.replace(/\.pdf$/i, "") ?? "";
}

export function looksLikeStructuredFile(filename: string, text: string) {
  const lower = filename.toLowerCase();
  const trimmed = text.trim();
  return (
    lower.endsWith(".json") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".bib") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("@")
  );
}

export function papersFromText(text: string, filename = "", sourceHint = "") {
  return normalizeCandidates(parseCandidatesText(text, filename), sourceHint);
}

export function paperFromFields(input: {
  title?: string;
  abstract?: string;
  authors?: string;
  year?: string;
  venue?: string;
  url?: string;
  source?: string;
}) {
  return normalizeCandidates(
    [
      {
        title: input.title || "",
        abstract: input.abstract || "",
        authors: input.authors || "",
        year: input.year || "",
        venue: input.venue || "",
        url: input.url || "",
        source: input.source || "",
      },
    ],
    input.source || "",
  );
}

function paperFromHtml(html: string, url: string): { papers: PaperRecord[]; incomplete: IncompletePaper[] } {
  const title =
    meta(html, ["citation_title", "dc.title", "og:title"]) ||
    tagText(html, "title");
  const abstract =
    meta(html, ["citation_abstract", "dc.description", "og:description", "description"]) ||
    tagText(html, "blockquote") ||
    "";
  const authors = meta(html, ["citation_author", "dc.creator"]);
  const year = meta(html, ["citation_publication_date", "citation_date", "dc.date"]);
  const venue = meta(html, ["citation_journal_title", "citation_conference_title"]);
  const result = paperFromFields({
    title,
    abstract,
    authors,
    year,
    venue,
    url,
    source: new URL(url).hostname,
  });
  return attachSections(result, htmlToPlainText(html));
}

async function fetchResource(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/pdf,application/json,text/plain,*/*",
        "User-Agent": "paper-screener/1.0",
      },
    });
    if (!response.ok) throw new Error(`Could not fetch that URL (${response.status}).`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_BYTES) throw new Error("That file is too large (>12MB).");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new Error("That file is too large (>12MB).");
    const bytes = new Uint8Array(buffer);
    const contentType = response.headers.get("content-type") || "";
    const isPdf =
      contentType.includes("application/pdf") ||
      new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-";

    return {
      bytes,
      isPdf,
      text: isPdf ? "" : new TextDecoder("utf-8").decode(buffer),
      contentType,
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function papersFromUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a full URL, starting with https://");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs can be fetched.");
  }
  const id = arxivId(url.href);
  const fetchUrl = id ? `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}` : url.href;
  const fetched = await fetchResource(fetchUrl);

  if (fetched.isPdf || url.pathname.toLowerCase().endsWith(".pdf")) {
    const filename = url.pathname.split("/").pop() || "downloaded.pdf";
    return papersFromPdfBytes(fetched.bytes, filename, url.href);
  }

  if (looksLikeStructuredFile(url.pathname, fetched.text) || fetched.contentType.includes("json") || fetched.contentType.includes("csv")) {
    return papersFromText(fetched.text, url.pathname, url.hostname);
  }
  if (id || fetched.contentType.includes("xml") || fetched.text.includes("<feed")) {
    const entry = fetched.text.match(/<entry[\s\S]*?<\/entry>/i)?.[0] || fetched.text;
    const title = tagText(entry, "title");
    const abstract = tagText(entry, "summary");
    const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => match[1]).join("; ");
    const published = tagText(entry, "published");
    const result = paperFromFields({
      title,
      abstract,
      authors,
      year: published.slice(0, 4),
      venue: "arXiv",
      url: `https://arxiv.org/abs/${id || ""}`.replace(/\/abs\/$/, url.href),
      source: "arxiv",
    });
    const absUrl = result.papers[0]?.url || url.href;
    try {
      const html = await fetchResource(absUrl.replace('/abs/', '/html/'));
      if (!html.isPdf && html.text) return attachSections(result, htmlToPlainText(html.text));
    } catch {}
    result.papers.forEach((paper) => {
      paper.flags = [...paper.flags, "missing_intro_method"];
      paper.section_source = "missing";
    });
    return result;
  }
  return paperFromHtml(fetched.text, fetched.finalUrl);
}

export async function papersFromUpload(filename: string, bytes: Uint8Array) {
  const lower = filename.toLowerCase();
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (lower.endsWith(".pdf") || header === "%PDF-") {
    return papersFromPdfBytes(bytes, filename);
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("That file is too large (>12MB). Use title and abstract, JSON, CSV, BibTeX, or a smaller PDF.");
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return papersFromText(text, filename, "upload");
}

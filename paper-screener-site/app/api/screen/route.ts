import { paperFromFields, papersFromText, papersFromUpload, papersFromUrl } from "@/lib/ingest";
import { scorePapers } from "@/lib/score";
import type { PaperRecord, ProjectBrief } from "@/lib/screener";

async function collectPapers(body: any, files: File[]) {
  const allPapers: PaperRecord[] = [];
  const allIncomplete: any[] = [];

  if (files.length > 0) {
    for (const file of files) {
      try {
        const res = await papersFromUpload(file.name, new Uint8Array(await file.arrayBuffer()));
        allPapers.push(...res.papers);
        allIncomplete.push(...res.incomplete);
      } catch (err) {
        allIncomplete.push({
          paper_id: file.name,
          title: file.name,
          reason: err instanceof Error ? err.message : "file_read_error",
        });
      }
    }
  }

  if (typeof body?.url === "string" && body.url.trim()) {
    const urls = body.url
      .split(/[\r\n,;]+/)
      .map((u: string) => u.trim())
      .filter((u: string) => u.startsWith("http://") || u.startsWith("https://"));

    await Promise.all(
      urls.map(async (u: string) => {
        try {
          const res = await papersFromUrl(u);
          allPapers.push(...res.papers);
          allIncomplete.push(...res.incomplete);
        } catch (err) {
          allIncomplete.push({
            paper_id: u,
            title: u,
            reason: err instanceof Error ? err.message : "url_fetch_failed",
          });
        }
      }),
    );
  }

  if (typeof body?.text === "string" && body.text.trim()) {
    const res = papersFromText(body.text, body.filename || "paste.json", "paste");
    allPapers.push(...res.papers);
    allIncomplete.push(...res.incomplete);
  }

  if (body?.title || body?.abstract) {
    const res = paperFromFields(body);
    allPapers.push(...res.papers);
    allIncomplete.push(...res.incomplete);
  }

  if (Array.isArray(body?.papers)) {
    const res = papersFromText(JSON.stringify(body.papers), "papers.json", "paste");
    allPapers.push(...res.papers);
    allIncomplete.push(...res.incomplete);
  }

  // Deduplicate by paper_id
  const seen = new Set<string>();
  const uniquePapers: PaperRecord[] = [];
  for (const p of allPapers) {
    if (!seen.has(p.paper_id)) {
      seen.add(p.paper_id);
      uniquePapers.push(p);
    }
  }

  return { papers: uniquePapers, incomplete: allIncomplete };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let body: any = {};
    const files: File[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        if (value instanceof File && (key === "file" || key === "files")) {
          files.push(value);
        } else if (typeof value === "string") {
          body[key] = value;
        }
      }
    } else {
      body = await request.json();
    }

    const project: ProjectBrief = {
      title: body.title || "",
      brief: body.brief || "",
      method_constraints: body.method_constraints || "",
      evidence_constraints: body.evidence_constraints || "",
    };
    if (!project.brief.trim()) {
      return Response.json({ error: "Add a project brief before scoring." }, { status: 400 });
    }

    const collected = await collectPapers(
      {
        url: body.url,
        text: body.text,
        filename: body.filename,
        title: body.paper_title || body.paperTitle,
        abstract: body.abstract,
        authors: body.authors,
        year: body.year,
        venue: body.venue,
        papers: body.papers,
      },
      files,
    );

    if (!collected.papers.length && !collected.incomplete.length) {
      return Response.json({ error: "请提供至少一篇论文（输入链接、上传文件或填写标题与摘要）。" }, { status: 400 });
    }

    const apiKey = (body.apiKey || body.api_key || request.headers.get("x-typesafe-api-key") || "") as string;
    const result = await scorePapers(project, collected.papers, collected.incomplete, apiKey);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Scoring failed." },
      { status: 400 },
    );
  }
}

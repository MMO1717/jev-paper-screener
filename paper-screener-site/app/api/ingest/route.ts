import { papersFromText, papersFromUpload, papersFromUrl } from "@/lib/ingest";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const files: File[] = [];
      for (const [key, value] of form.entries()) {
        if (value instanceof File && (key === "file" || key === "files")) {
          files.push(value);
        }
      }
      if (files.length === 0) {
        return Response.json({ error: "Choose at least one PDF, JSON, CSV, or BibTeX file." }, { status: 400 });
      }
      const allPapers: any[] = [];
      const allIncomplete: any[] = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const res = await papersFromUpload(file.name, bytes);
        allPapers.push(...res.papers);
        allIncomplete.push(...res.incomplete);
      }
      return Response.json({ papers: allPapers, incomplete: allIncomplete });
    }
    const body = await request.json();
    if (typeof body.url === "string" && body.url.trim()) {
      const urls = body.url
        .split(/[\r\n,;]+/)
        .map((u: string) => u.trim())
        .filter((u: string) => u.startsWith("http://") || u.startsWith("https://"));
      const allPapers: any[] = [];
      const allIncomplete: any[] = [];
      await Promise.all(
        urls.map(async (u: string) => {
          try {
            const res = await papersFromUrl(u);
            allPapers.push(...res.papers);
            allIncomplete.push(...res.incomplete);
          } catch (e) {
            allIncomplete.push({ paper_id: u, title: u, reason: e instanceof Error ? e.message : "fetch_failed" });
          }
        }),
      );
      return Response.json({ papers: allPapers, incomplete: allIncomplete });
    }
    if (typeof body.text === "string") {
      return Response.json(papersFromText(body.text, body.filename || "paste.json", "paste"));
    }
    return Response.json({ error: "Provide a URL, file, or paper list." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read that input." },
      { status: 400 },
    );
  }
}

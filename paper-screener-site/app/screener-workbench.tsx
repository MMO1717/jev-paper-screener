"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  KeyRound,
  Link2,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ScreenedPaper } from "@/lib/screener";

type ScreenResponse = {
  ok?: boolean;
  error?: string;
  disclaimer?: string;
  counts?: Record<string, number>;
  decisions?: ScreenedPaper[];
};

const buckets = [
  { key: "keep", label: "Keep", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  { key: "review", label: "Review", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  { key: "drop", label: "Drop", color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
] as const;

export function ScreenerWorkbench() {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [method, setMethod] = useState("");
  const [evidence, setEvidence] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [paperTitle, setPaperTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [refineKeepReview, setRefineKeepReview] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScreenResponse | null>(null);

  const grouped = useMemo(() => {
    const decisions = result?.decisions || [];
    return {
      keep: decisions.filter((row) => row.decision.decision === "keep"),
      review: decisions.filter((row) => row.decision.decision === "review"),
      drop: decisions.filter(
        (row) => row.decision.decision === "drop" || row.decision.decision === "incomplete",
      ),
    };
  }, [result]);

  useEffect(() => {
    const context = typeof document === "undefined" ? undefined : document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: "score_papers",
          title: "Score papers",
          description: "Score uploaded or linked papers against the current project brief.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
              text: { type: "string" },
              paper_title: { type: "string" },
              abstract: { type: "string" },
              api_key: { type: "string" },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            const payload = (input || {}) as Record<string, string>;
            const form = new FormData();
            form.set("title", title);
            form.set("brief", brief);
            form.set("method_constraints", method);
            form.set("evidence_constraints", evidence);
            form.set("url", payload.url || url);
            form.set("text", payload.text || text);
            form.set("paper_title", payload.paper_title || paperTitle);
            form.set("abstract", payload.abstract || abstract);
            form.set("apiKey", payload.api_key || apiKey);
            form.set("refine_keep_review", refineKeepReview ? "true" : "false");
            const response = await fetch("/api/screen", { method: "POST", body: form });
            const res = await response.json();
            setResult(res);
            if (!response.ok) throw new Error(res.error || "Scoring failed.");
            return { counts: res.counts, decisions: res.decisions };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch((err) => setError(err instanceof Error ? err.message : "Tool registration failed."));
    return () => lifecycle.abort();
  }, [title, brief, method, evidence, url, text, paperTitle, abstract, apiKey, refineKeepReview]);

  function loadExample() {
    setTitle("基于反思与强化学习的情感支持对话自进化机制");
    setBrief(
      "本课题研究大语言模型在多轮共情对话与情绪支持（Emotional Support Conversation, ESC）中的自进化机制。目标是通过自反思（Self-Refinement）、基于情感状态转化的多轮强化学习（RL/DPO）与探索，让对话系统在无需海量人工标注的情况下，持续进化共情理解能力与支持策略，实现从情绪共鸣到积极情绪诱导（Positive Emotion Elicitation）的动态策略自进化。",
    );
    setMethod("强化学习（PPO/GRPO/DPO）、多轮策略自优化、自我反思（Self-Refinement/Self-Rewarding）或情感状态追踪。排除仅做单轮静态监督微调（Static SFT）的方法。");
    setEvidence("情绪支持对话基准（如 ESConv、EmpatheticDialogues）上的多轮交互评估、共情质量胜率或积极情绪转化率指标。");
    setUrl("https://arxiv.org/abs/2307.07994\nhttps://arxiv.org/abs/2106.01144\nhttps://arxiv.org/abs/1706.03762");
    setPaperTitle("");
    setAbstract("");
    setFiles([]);
    setText("");
    setError("");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("title", title);
      form.set("brief", brief);
      form.set("method_constraints", method);
      form.set("evidence_constraints", evidence);
      form.set("apiKey", apiKey);
      form.set("refine_keep_review", refineKeepReview ? "true" : "false");
      form.set("url", url);
      form.set("text", text);
      form.set("paper_title", paperTitle);
      form.set("abstract", abstract);
      files.forEach((f) => form.append("files", f));

      const response = await fetch("/api/screen", { method: "POST", body: form });
      const payload = (await response.json()) as ScreenResponse;
      if (!response.ok) {
        setResult(payload.decisions ? payload : null);
        throw new Error(payload.error || "打分失败，请检查输入或 API 密钥。");
      }
      setResult(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "打分遇到异常。";
      if (msg === "Load failed" || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError("网络请求超时或连接中断，请重新点击“开始筛选论文”。");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!result?.decisions?.length) return;
    const headers = ["ID", "Title", "Authors", "Year", "Decision", "Weighted Score", "Role", "Reason", "Evidence Stage", "Refined", "URL", "Flags"];
    const rows = result.decisions.map((row) => [
      `"${(row.paper.paper_id || "").replace(/"/g, '""')}"`,
      `"${(row.paper.title || "").replace(/"/g, '""')}"`,
      `"${(row.paper.authors || "").replace(/"/g, '""')}"`,
      `"${(row.paper.year || "").replace(/"/g, '""')}"`,
      `"${row.decision.decision}"`,
      row.decision.weighted_score,
      `"${row.decision.role}"`,
      `"${row.decision.reason}"`,
      `"${row.decision.evidence_stage || row.paper.evidence_stage || "abstract"}"`,
      `"${row.decision.refined ? "yes" : "no"}"`,
      `"${row.paper.url || ""}"`,
      `"${(row.decision.flags || []).join(";")}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `jev-screen-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  function exportJson() {
    if (!result?.decisions?.length) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `jev-screen-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] items-start">
      <aside className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              Jev 论文筛选器
            </h1>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              基于 TypeSafe Jev 的硬门槛与加权评分辅助工具。仅供文献初筛，非正式 related work 结论。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={loadExample}
            className="text-xs shrink-0 text-muted-foreground hover:text-foreground"
            title="填入示例项目信息"
          >
            <Sparkles className="size-3.5 mr-1" />
            示例
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title" className="text-xs font-semibold">
            项目标题 (Project Title)
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：基于线性注意力的长文档摘要"
            className="text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <Label htmlFor="brief" className="text-xs font-semibold">
              项目简介 (Project Brief) <span className="text-destructive">*</span>
            </Label>
          </div>
          <Textarea
            id="brief"
            required
            rows={4}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="说明本项目要解决的核心科学问题、方法目标及关键考量..."
            className="text-sm resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="method" className="text-xs font-semibold">
            方法约束 (Method Constraints)
          </Label>
          <Textarea
            id="method"
            rows={2}
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            placeholder="可复用或需规避的算法、架构或设定..."
            className="text-sm resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="evidence" className="text-xs font-semibold">
            证据/评估约束 (Evidence Constraints)
          </Label>
          <Textarea
            id="evidence"
            rows={2}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder="所需的数据集类别、评测标准或证据形式..."
            className="text-sm resize-y"
          />
        </div>

        <div className="pt-2 border-t border-border/80 space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="apiKey" className="text-xs font-semibold flex items-center gap-1.5">
              <KeyRound className="size-3.5 text-muted-foreground" />
              TypeSafe API Key (可选)
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={() => setShowApiKey(!showApiKey)}
            >
              {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
          <Input
            id="apiKey"
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="留空则自动使用服务端配置的密钥"
            className="text-xs font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            公开访问模式下支持自定义密钥打分，不会在公网暴露。
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <Label htmlFor="refine" className="text-xs font-semibold">
            加深 Keep/Review
          </Label>
          <input
            id="refine"
            type="checkbox"
            checked={refineKeepReview}
            onChange={(event) => setRefineKeepReview(event.target.checked)}
            className="size-4"
          />
        </div>
        <p className="text-[11px] text-muted-foreground -mt-2">
          默认开启。对 Keep/Review 再看引言和方法；抽不到段落则保持第一轮并标记待审。
        </p>
        <Button type="submit" disabled={busy} className="w-full font-medium mt-2">
          {busy ? <LoaderCircle className="animate-spin mr-2 size-4" /> : null}
          {busy
            ? "正在通过 Jev 智能批量打分..."
            : files.length > 1
              ? `开始筛选 ${files.length} 篇上传论文`
              : "开始筛选论文"}
        </Button>

        {error ? (
          <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
            {error}
          </div>
        ) : null}

        {result?.disclaimer ? (
          <p className="text-[11px] text-muted-foreground text-center">{result.disclaimer}</p>
        ) : null}
      </aside>

      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">输入候选论文 (Candidates)</h2>
            <span className="text-xs text-muted-foreground">支持批量上传 / 多条 URL / 结构化文件</span>
          </div>

          <Tabs defaultValue="url" className="mt-4">
            <TabsList className="grid grid-cols-3 w-full sm:w-[420px]">
              <TabsTrigger value="url">论文网址 (支持多条)</TabsTrigger>
              <TabsTrigger value="file">批量上传文件 (含 PDF)</TabsTrigger>
              <TabsTrigger value="paste">标题与摘要</TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-2 pt-3">
              <Label htmlFor="url" className="text-xs font-medium">
                论文链接（支持输入多条链接，每行一个，支持 arXiv 网页或 PDF 直链）
              </Label>
              <div className="flex items-start gap-2">
                <Link2 className="size-4 text-muted-foreground shrink-0 mt-2.5" />
                <Textarea
                  id="url"
                  rows={3}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={"https://arxiv.org/abs/2307.07994\nhttps://arxiv.org/abs/2106.01144\nhttps://arxiv.org/abs/1706.03762"}
                  className="text-xs font-mono resize-y"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                系统将并行并发解析所有链接，自动提取标题与摘要并提交 Jev 打分。
              </p>
            </TabsContent>

            <TabsContent value="file" className="space-y-3 pt-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="file" className="text-xs font-medium">
                  选择或拖入多个 PDF、JSON、CSV、BibTeX 文件
                </Label>
                {files.length > 0 && (
                  <span className="text-xs text-primary font-medium">
                    已选 {files.length} 个文件
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <FileUp className="size-4 text-muted-foreground shrink-0" />
                <Input
                  id="file"
                  type="file"
                  multiple
                  accept=".pdf,.json,.csv,.bib,.txt"
                  onChange={(event) => {
                    const selected = event.target.files;
                    if (selected?.length) {
                      setFiles((prev) => {
                        const existingNames = new Set(prev.map((f) => f.name));
                        const newFiles = Array.from(selected).filter((f) => !existingNames.has(f.name));
                        return [...prev, ...newFiles];
                      });
                    }
                    event.target.value = "";
                  }}
                  className="text-sm cursor-pointer"
                />
                {files.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles([])}
                    className="text-xs shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5 mr-1" /> 清空
                  </Button>
                )}
              </div>

              {files.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {files.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className="text-xs bg-muted/40 p-2 rounded-md flex items-center justify-between border border-border/50"
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <span className="font-medium text-foreground truncate">{f.name}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          ({(f.size / 1024).toFixed(1)} KB)
                        </span>
                        {f.name.toLowerCase().endsWith(".pdf") && (
                          <Badge variant="secondary" className="text-[10px] py-0">
                            PDF 自动抽取
                          </Badge>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-5 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1 pt-1">
                <Label className="text-xs text-muted-foreground">或直接粘贴 JSON / CSV / BibTeX 内容：</Label>
                <Textarea
                  value={text}
                  rows={3}
                  onChange={(event) => setText(event.target.value)}
                  placeholder='[{"title":"...","abstract":"..."}] 或 @article{...}'
                  className="text-xs font-mono"
                />
              </div>
            </TabsContent>

            <TabsContent value="paste" className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="paper-title" className="text-xs font-medium">
                  论文标题 (Title)
                </Label>
                <Input
                  id="paper-title"
                  value={paperTitle}
                  onChange={(event) => setPaperTitle(event.target.value)}
                  placeholder="例如：Attention Is All You Need"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="abstract" className="text-xs font-medium">
                  论文摘要 (Abstract) <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="abstract"
                  rows={4}
                  value={abstract}
                  onChange={(event) => setAbstract(event.target.value)}
                  placeholder="粘贴论文摘要文本进 Jev 打分..."
                  className="text-sm resize-y"
                />
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              筛选结果看板
              {result?.counts ? (
                <span className="text-xs font-normal text-muted-foreground">
                  (已处理: {result.counts.scored ?? 0} 篇，缺摘要: {result.counts.incomplete ?? 0} 篇)
                </span>
              ) : null}
            </h2>
            {result?.decisions?.length ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={exportCsv} className="text-xs h-8">
                  <Download className="size-3.5 mr-1" /> 导出 CSV
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={exportJson} className="text-xs h-8">
                  <Download className="size-3.5 mr-1" /> 导出 JSON
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {buckets.map((bucket) => {
              const items = grouped[bucket.key];
              return (
                <div key={bucket.key} className="rounded-xl border border-border bg-card p-3.5 flex flex-col min-h-[300px]">
                  <div className="mb-3 flex items-center justify-between pb-2 border-b border-border/60">
                    <span className="text-sm font-semibold tracking-tight">{bucket.label}</span>
                    <Badge variant="outline" className={`font-mono text-xs ${bucket.color}`}>
                      {items.length}
                    </Badge>
                  </div>
                  <div className="space-y-3 flex-1 overflow-y-auto max-h-[700px] pr-1">
                    {items.length ? (
                      items.map((row) => {
                        const isKeep = row.decision.decision === "keep";
                        const isReview = row.decision.decision === "review";
                        const isIncomplete = row.decision.decision === "incomplete";
                        const scorePct = Math.round((row.decision.weighted_score || 0) * 100);

                        return (
                          <article
                            key={row.paper.paper_id}
                            className="rounded-lg border border-border bg-background/50 p-3.5 hover:border-border/80 transition-colors shadow-xs space-y-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  isKeep
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                    : isReview
                                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                                }
                              >
                                {row.decision.decision.toUpperCase()}
                              </Badge>
                              {!isIncomplete ? (
                                <span className="font-mono text-xs font-semibold text-foreground">
                                  加权分: {scorePct}%
                                </span>
                              ) : null}
                            </div>

                            <div>
                              <h4 className="text-sm font-semibold leading-snug text-foreground flex items-start justify-between gap-2">
                                <span>{row.paper.title || "(无标题)"}</span>
                                {row.paper.url ? (
                                  <a
                                    href={row.paper.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-muted-foreground hover:text-primary shrink-0 mt-0.5"
                                    title="在新标签页查看论文"
                                  >
                                    <ExternalLink className="size-3.5" />
                                  </a>
                                ) : null}
                              </h4>
                              {(row.paper.authors || row.paper.year) && (
                                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
                                  {row.paper.authors ? row.paper.authors : "未知作者"}
                                  {row.paper.year ? ` · ${row.paper.year}` : ""}
                                </p>
                              )}
                            </div>

                            {isIncomplete ? (
                              <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded">
                                ⚠️ 未打分：{row.decision.reason === "missing_abstract" ? "缺失摘要 (incomplete)" : row.decision.reason}
                              </div>
                            ) : (
                              <div className="space-y-1.5 text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-md">
                                <div className="flex justify-between text-[11px]">
                                  <span className="font-medium text-foreground">定位: {row.decision.role}</span>
                                  <span className="text-muted-foreground">理由: {row.decision.reason}</span>
                                </div>
                                {row.decision.gates?.length ? (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    {row.decision.gates.map((gate) => (
                                      <span
                                        key={gate.name}
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                          gate.rejected
                                            ? "bg-rose-500/10 text-rose-500"
                                            : "bg-emerald-500/10 text-emerald-500"
                                        }`}
                                      >
                                        {gate.name.replace(/_/g, " ")}: {gate.rejected ? "FAIL" : "PASS"}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )}

                            {row.decision.evidence_stage ? (
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                                {row.decision.evidence_stage === "intro_method"
                                  ? "第二轮: 引言+方法"
                                  : row.decision.evidence_stage === "refine_incomplete"
                                    ? "待审: 缺引言/方法"
                                    : "第一轮: 摘要"}
                              </Badge>
                            ) : null}
                            {row.decision.flags?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {row.decision.flags.map((flag) => (
                                  <Badge key={flag} variant="secondary" className="text-[10px] py-0 px-1.5">
                                    {flag}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        );
                      })
                    ) : (
                      <Empty className="border border-dashed py-8">
                        <EmptyHeader>
                          <EmptyTitle className="text-xs text-muted-foreground">暂无论文</EmptyTitle>
                          <EmptyDescription className="text-[11px]">
                            输入网址、文件或标题摘要后点击打分。
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </form>
  );
}

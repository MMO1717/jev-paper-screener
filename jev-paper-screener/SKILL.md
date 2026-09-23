---
name: jev-paper-screener
description: "Score candidate papers against a project brief with TypeSafe Jev. Use when screening literature for a project paper, ranking keep/review/drop, or launching the local Jev paper screener. Do not use for searching papers, writing related work, or reading PDFs."
---

# Jev Paper Screener

Jev scores candidate papers. It does not search, write related work, or read PDFs.

## Workflow

1. Collect candidates with `$qinyan-paper-search` or a local JSON/CSV/BibTeX file. Do not invent papers.
2. Normalize to title plus abstract. Missing abstracts are `incomplete` and are not sent to Jev.
3. Score title + abstract first. Refine Keep/Review with introduction + method when those sections exist. Missing sections stay `refine_incomplete` and keep the first-pass decision.
4. Launch the local page when the user wants a workbench. Export the run directory.

## Commands

```bash
python3 scripts/screen.py --project project.json --candidates papers.json --out runs/latest
python3 scripts/serve.py --port 8765
python3 scripts/test_offline.py
```

Read [references/schema.md](references/schema.md) for the candidate schema, questions, weights, and routing thresholds.

## Constraints

- Pin `jev-1.13.0`. Read `TYPESAFE_API_KEY` from the environment only.
- First pass sends title + abstract. Keep/Review may send introduction + method. Never send full text.
- Chinese abstracts may be scored but must be flagged `language_risk`.
- Screening is an aid, not official related-work evidence.

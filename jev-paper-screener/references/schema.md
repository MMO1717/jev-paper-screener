# Jev paper screener schema

## Candidate fields

`paper_id, title, authors, year, venue, abstract, source, url`

Missing `title` or `abstract` => `incomplete`. Do not call Jev.

JSON array, `{ "papers": [...] }`, CSV, and BibTeX are accepted.

## Project fields

`title, brief, method_constraints, evidence_constraints`

## Questions

Hard-gate Noul: `topic_match`, `method_transferable`, `evidence_compatible`.

Weighted Score: `problem_overlap` 0.35, `method_reuse` 0.30, `experiment_transfer` 0.20, `citation_value` 0.15.

Choice: `role_in_paper` = baseline | method | related_work | dataset | skip.

## Routing

- High-confidence hard-gate no => `drop`. High scores cannot rescue it.
- Uncertain hard-gate no => `review`.
- All gates pass, weighted score >= 0.62, mean score confidence >= 0.55 => `keep`.
- Weighted score <= 0.38 => `drop`.
- Otherwise `review`.
- `language_risk` holds `keep` to `review`.
- Year/language/missing fields are code rules, not Jev questions.

## Run artifacts

`inputs.json`, `raw_jev.json`, `ranked.csv`, `decisions.json`

Screening is an aid, not official related-work evidence.


## Evidence stages

- `abstract`: first pass over title + abstract.
- `intro_method`: second pass over introduction + method; this overrides the first pass.
- `refine_incomplete`: Keep/Review lacked extractable introduction or method. Keep the first-pass decision and do not send a second Jev call.

High-confidence Drop is never refined. Second-pass state contains only the project brief, title, introduction, and method.

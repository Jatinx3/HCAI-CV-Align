# CV–Job Description Alignment Assistant

A research prototype built for the MSc thesis *Designing a Human-Centered AI
Assistant for CV–Job Description Alignment* (MSc Human-Centred Artificial
Intelligence, TU Dublin).

Most commercial CV tools take your CV and a job advert and hand back a rewritten
document. You get no account of what changed or why, and no way to disagree with
any single edit. This project asks whether that is the only shape such a tool can
take, and builds the alternative so the two can be compared by people actually
applying for jobs.

The app contains both systems:

**One-click rewrite** sends the whole CV to a model in a single call and returns
the rewritten document. No explanations, no per-change control. This is the
baseline, and it is deliberately thin.

**Review each change** analyses the CV one section at a time. Every proposal
arrives with the job-description requirement it addresses, a plain-language
reason, and a word-level diff. Nothing is applied until you accept it, and any
decision can be taken back.

Both modes export through the same pipeline, so a difference the study measures
is a difference in the interaction, not in how well the download survived.

## What the study found

Twenty-one accounts were provisioned. Fourteen participants started a session and
eleven completed both conditions on the same model and reached the feedback form.

| | |
| --- | --- |
| Completed both conditions | 11 |
| Chose the review mode first | 11 of 14 |
| Chose the one-click baseline first | 3 of 14 |
| Ran a mode more than once | 7 |
| Rewrite runs recorded | 51, of which 42 completed |
| CV formats used | 47 PDF, 3 DOCX, 1 LaTeX |

Order was self-selected rather than assigned, so the split above is an observed
preference and not a manipulated variable. The interaction log recorded 122
accepted suggestions against 13 rejected and 6 edited, with 9 decisions later
undone and 33 changes to the conservatism setting.

The full survey instrument is in [`docs/post-task-survey.md`](docs/post-task-survey.md).

## Authenticity is enforced in code, not requested in the prompt

The system prompt forbids inventing content. That is not enough, and the
prototype is built on the assumption that it never will be. Every suggestion the
model returns is checked server-side before a participant sees it, and eight
rules can reject one:

1. The quoted original does not appear in the section
2. Nothing actually changed
3. The words were only reordered
4. A factual record was rewritten (a date, a grade, an employer)
5. The CV was switched into the first person
6. The explanation or the cited requirement is missing
7. The quoted span is too long to review closely
8. The original was kept intact and a new claim appended to it

The eighth rule was added after a model defeated the first seven. It quoted the
original exactly, appended `using Apache Airflow and Kubernetes on AWS` to a line
that mentioned neither, and arrived with a valid explanation and a real cited
requirement. It passed every check and would have reached a participant looking
identical to an honest suggestion. Every fabrication caught during development
was already forbidden by the prompt.

Discarded counts are shown to the participant rather than hidden, on the grounds
that a tool claiming transparency should say when it has thrown something away.

## Choosing a model

Suggestion count turns out to be a poor proxy for suggestion quality. Measured on
the same CV and job description, counting only suggestions that survive the
validator:

| Model | Valid | Discarded | Time |
| --- | --- | --- | --- |
| Claude Sonnet 5 | 5 | 0 | 64s |
| Qwen3 235B | 9 | 0 | 42s |
| Gemini 2.5 Flash | 8 | 2 | 9s |
| Claude Haiku 4.5 | 7 | 1 | 17s |
| Gemini 2.5 Flash Lite | 15 | 0 | 11s |
| Nemotron 3 Nano (free) | 2 | 0 | 118s |

Gemini 2.5 Flash Lite produced three times as many suggestions as Sonnet 5 and
was the least trustworthy of them. Most were padding, and one grafted a phrase
from the job description onto a project whose stack did not contain it. The free
model returned two usable suggestions in nearly two minutes, which is why the
study ran on a paid one.

Participants were given a small allowance across tiers rather than a single fixed
model: one run of each mode on Claude Sonnet 5, which is the pair the analysis
reports, plus cheaper models for repeat runs. Those repeats are recorded and
excluded from the comparison. The catalogue lives in
[`src/lib/models.ts`](src/lib/models.ts).

## How a rewrite is put together

```
CV upload  ──▶  extract text  ──▶  parse into sections  ──▶  model call
 pdf/docx/tex      pdfjs            header excluded         one per section
                   mammoth
                                                                  │
   export  ◀──  accept/reject/edit  ◀──  validator  ◀─────────────┘
 splice into                            8 rules, server-side
 the original
```

The contact header is never sent to a model in either mode. That is not
precautionary: asked to rewrite a whole document, a model changed an applicant's
email address to one that was not theirs, and the applicant would have had no
reason to look.

Exports keep the original document wherever possible. A `.tex` CV is recompiled
from its own source with the accepted spans spliced in. A `.docx` has its text
runs rewritten and is converted through LibreOffice. A PDF is edited in place
using MuPDF redaction with pdf-lib redraw, and falls back to a clean template
when a change cannot fit the space it replaces. The participant is told which of
those happened.

## Running it locally

Two system binaries are needed, which is why this cannot run on a serverless
host:

- **Tectonic** for LaTeX. `brew install tectonic`
- **LibreOffice** for `.docx` conversion. `brew install --cask libreoffice`

Tectonic downloads its package bundle on first compile, which takes a few
minutes. Warm it once so a participant is not the one waiting:

```bash
printf '\\documentclass{article}\\begin{document}warm\\end{document}' > /tmp/warm.tex && tectonic --outdir /tmp --chatter minimal /tmp/warm.tex
```

Then:

```bash
npm install && cp .env.example .env && npx prisma migrate dev && npm run dev
```

### Environment

| Variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | `openrouter` or `anthropic`. Read server-side only; no key ever reaches the browser. |
| `OPENROUTER_API_KEY` | From <https://openrouter.ai/keys>. |
| `OPENROUTER_MODEL` | Fallback only. Study runs pick a model per request from the catalogue. |
| `ANTHROPIC_API_KEY` | Used when `LLM_PROVIDER=anthropic`. |
| `CLAUDE_MODEL` | Model id for the Anthropic path. |
| `AUTH_SECRET` | Session secret. `openssl rand -base64 32` |
| `AUTH_URL` | Public URL when behind a reverse proxy, so sign-in redirects resolve. |
| `DATABASE_URL` | SQLite path, e.g. `file:./dev.db` |
| `STUDY_FEEDBACK_FORM_URL` | Feedback form link. `{code}` in the URL is replaced with the participant's session code. |

SQLite is held to a single connection. Several connections each take their own
advisory lock on the file, which is fine on a local disk and is the documented
way to corrupt a database on network storage.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run provision -- --email x --participant` | Create one account |
| `npm run provision:batch -- --count 20 --out credentials.csv` | Create a cohort, printing passwords once |
| `npm run sheet -- --credentials credentials.csv --out participants.csv` | Open each session early so the participant code can be handed out with the login |
| `npm run check-models` | Ask the provider whether every catalogue model still exists |
| `npm run export-study -- --out study-export` | Write `sessions.csv`, `steps.csv`, `events.csv` |
| `npm run pseudonymise` | Strip identifiers from an export |
| `npm run corpus` | Regression-check the layout engine against six CV templates |

`check-models` exists because a provider withdrew a model in the middle of a
session. The endpoint began answering 404 and a participant saw four of five CV
sections fail. Nothing in this repository can prevent that; the script moves the
discovery to before the session rather than during it.

## Deployment

[`deploy/azure/`](deploy/azure) holds a working deployment: a Docker image with
both binaries, cloud-init, a compose file, and Caddy terminating TLS with
automatic certificates. The study ran on an Azure VM for eight days at about
€2.26 a day.

A VM rather than a managed platform for two reasons. SQLite needs a real block
device, and managed containers usually offer network storage. And a rewrite can
hold a request open for minutes, which some platforms cut at four.

## Layout

```
src/app          Next.js App Router pages and API routes
src/lib          sections, suggestions, validator, models, export pipeline
src/lib/values.ts   the four design values, shared by the UI chips and the legend
prisma/          schema and migrations
scripts/         provisioning, export, corpus regression checks
docs/            the post-task survey instrument
deploy/azure/    container deployment used for the study
DESIGN.md        the full brief: modes, study design, value mapping, fidelity rules
```

## Limitations

The sample is eleven completed participants, not the twenty planned. Results are
descriptive at that size.

Model output is not deterministic. Three identical runs of the same CV and job
description produced three, zero and one suggestions. Setting a temperature did
not fix it, so two participants with the same CV do not meet the same assistant.

The authenticity validator judges a suggestion against the section it edits, not
the whole CV. A genuine move of a skill from one section into another is
rejected. That trade is deliberate, since a lost suggestion costs a participant
one idea and a fabricated one costs them their honesty.

CV text is sent to a third-party provider to generate suggestions. The contact
header is withheld, but the body is not, and a CV body usually identifies its
author.

Survey items name the design value they measure. Three of those words appear as
labels in the review interface and nowhere in the baseline, so participants meet
the term in only one of the two conditions they rate.

---

Jatin Assudani · MSc Human-Centred Artificial Intelligence · TU Dublin

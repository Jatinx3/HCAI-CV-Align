# CV–Job Description Alignment Assistant

MSc thesis artifact: "Designing a Human-Centered AI Assistant for CV–Job Description Alignment."
Grounded in Value Sensitive Design (Friedman, Kahn & Borning 2006) and Human-Centered AI
(Amershi et al. 2019; Shneiderman 2022). This app is the technical investigation (RO2) and is
evaluated in a within-subjects user study (RO3). Central value tension: **efficiency**
(fast automated rewriting) vs **authenticity** (honest self-representation).

The `Stuff/` directory is an unrelated prior project — never touch it.

## The two rewrite modes

1. **One-click rewrite (baseline).** Upload CV + paste JD, one button, returns a fully
   rewritten CV in the uploaded file's format. No explanations, no JD links, no section
   breakdown, no per-change control, no conservatism control. Represents the commercial
   status quo (Jobscan, Teal, Resume.io). Keep it deliberately thin — resist improving it.
2. **Human-centered rewrite (prototype).** CV parsed into sections (summary, experience,
   skills, education); each section analysed against the JD independently — never a
   monolithic rewrite. Per section: a small set of suggestions, each carrying
   `original`, `suggested`, `explanation`, `jd_requirement`. Explanation and JD link are
   mandatory — a suggestion missing either is invalid and must not be shown. User accepts /
   rejects / edits each suggestion individually; nothing is applied automatically. A
   conservatism slider (conservative → assertive) is passed into the model call, always
   within the anti-fabrication constraints. A live working CV reflects accepted/edited
   suggestions in real time and exports via the per-format pipeline.

## Within-subjects guided study session

- Each account has boolean `studyParticipant`.
- General user (`false`): free choice of either mode, no guided flow.
- Study participant (`true`): guided session —
  1. On session start, app assigns counterbalanced mode order (one-click first or
     human-centered first) and records it. Balance assignment across participants
     (alternate or randomise while tracking counts) so neither order dominates.
  2. Participant completes first assigned mode, then the second.
  3. Single comparative feedback handoff: app directs participant to ONE external
     Microsoft Forms form (preference, comparative judgements on trust / perceived
     control / transparency / authenticity, free-text reason). App does NOT reproduce
     the form; it logs that the handoff was reached. Optionally record forced-choice
     preference locally as backup.
- Record per mode step: which CV and which JD were used (do NOT assume the same JD is
  reused across both modes — same-CV/two-JDs vs wash-out is the researcher's decision),
  order, mode, timestamps.

## VSD value → feature mapping (the design spine)

When a design question is ambiguous, resolve in favour of the value, not convenience.

| Value | Requirement | Feature |
|---|---|---|
| Transparency | User understands why each change is proposed | Inline explanation on every suggestion naming the specific JD requirement |
| User control | User decides every change | Per-suggestion accept / reject / edit; nothing auto-applied |
| User control | User sets system assertiveness | Conservatism slider |
| Authenticity | System must not invent credentials | Anti-fabrication constraints in system prompt; only rephrase/reframe/surface existing CV content |
| Usability | Low friction, clear structure | Section-by-section flow, readable diffs, no dead ends |
| Trust | Emergent, measured not built | No dedicated feature; supported by the above |

The values are also named in the interface: the human-centered review screen labels each
affordance with the value it carries and opens with a legend explaining them
(`src/lib/values.ts` is the single source for both, so a chip and the legend cannot make
different claims). One-click stays unlabelled — annotating the baseline would blunt the
contrast the study measures.

## Output fidelity by input format

Both modes export through the same per-format pipeline. Never attempt in-place text
replacement inside arbitrary PDFs.

- **.tex (highest fidelity):** parse source, separate content blocks from preamble and
  formatting, send only content to model, splice rewritten content back into untouched
  structure, recompile with Tectonic. Output PDF formatting-identical. Target common
  resume classes (article, moderncv, altacv); degrade gracefully.
- **.docx (high fidelity):** extract text runs with styles, rewrite text, write back into
  same runs preserving paragraph/run styles, convert to PDF via LibreOffice headless.
  Some reflow expected when text length changes.
- **.pdf (best effort, explicit reformat):** extract text, rewrite, render into a clean
  standard resume template exported as PDF. Tell the user a PDF upload is reformatted,
  not cloned. Column structure is recovered from glyph positions (pdf.js item x/width),
  not guessed from the flattened string.
  In-place editing was investigated and rejected on evidence — see below.

## Tech stack (decided)

- Next.js (App Router) + React + TypeScript, Tailwind CSS.
- Next.js API routes only — no separate server.
- Auth.js (NextAuth) for login; researcher provisions participant accounts; public
  sign-up optional/disableable.
- Prisma + SQLite: users, `studyParticipant`, study sessions, telemetry.
- LLM calls go through one server-side client module with a provider switch
  (`LLM_PROVIDER`): **openrouter** (free models, current default; OpenAI-compatible
  chat-completions endpoint, `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`) or
  **anthropic** (Messages API, `ANTHROPIC_API_KEY` + `CLAUDE_MODEL`). Never called
  from the browser; keys never hardcoded or sent to client. Prompts and the JSON
  suggestion contract are provider-agnostic so switching is an env change only.
- Doc tooling (system-level): Tectonic (.tex recompile), LibreOffice headless
  (.docx → PDF), pdf-parse/pdfjs (PDF extraction), mammoth (DOCX parsing).

## Authenticity system prompt (human-centered mode)

Keep every hard constraint: only rephrase/reframe/reorganise/surface existing CV content;
never introduce skills, tools, employers, roles, qualifications, certifications, metrics,
or achievements absent from the original; note gaps rather than fill them; every
suggestion cites its JD requirement and carries a plain-language explanation; structured
JSON output only. One-click mode uses a separate plain rewrite prompt with no authenticity
scaffolding and no structured output.

## Research telemetry (study instrumentation, NOT an accountability feature)

Keyed by account (anonymised id), session, mode, order. Per mode step: CV + JD used,
start/end timestamps, time on task, time to first action (coarse — no keystroke logging).
Human-centered: every accept/reject/edit event with suggestion + section + conservatism
level in effect. Whether feedback handoff was reached. Final exported CV text per mode.
No names, emails, or identifying content beyond the uploaded CV.

## Out of scope — do not build

- Bias detection, demographic inference, fairness scoring.
- Audit trails or compliance tooling framed as accountability features.
- In-place text replacement inside arbitrary PDFs. Attempted behind
  `PDF_INPLACE_EDIT=true` (`src/lib/export/pdf-inplace.ts`) and left disabled: without
  rewriting the page content stream, an edit can only paint over the original run, and
  painting over does not delete. Both the old and the new wording stay in the text layer,
  so an ATS would read a contradictory CV that looks correct on screen. Verified across
  the generated corpus (`npm run corpus`); every template fell back. Doing this properly
  requires true redaction at the content-stream level.
- Anything that fabricates or embellishes CV content in human-centered mode.

## Build phases

Work in phases; commit at end of each; pause for confirmation before the next.
1. Setup (this doc, README, scaffold, env) ✅
2. Auth + accounts (login, Prisma schema, researcher provisioning)
3. Upload + parsing (.pdf/.docx/.tex detection + extraction, JD field)
4. Format-preserving export pipeline (three output paths, shared by both modes)
5. Human-centered mode (section parsing, suggestion API, accept/reject/edit UI, slider)
6. One-click mode (plain rewrite route, minimal screen)
7. Guided study session (counterbalancing, two-mode walkthrough, feedback handoff)
8. Telemetry
9. Polish (empty states, error handling, readable diffs — no feature creep)

## Commands

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run lint` — ESLint

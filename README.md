# CV–Job Description Alignment Assistant

Research prototype for the MSc thesis *"Designing a Human-Centered AI Assistant for
CV–Job Description Alignment."* A web app offering two CV rewrite modes — a one-click
baseline (full automated rewrite, no explanations) and a human-centered prototype
(per-suggestion accept/reject/edit, each suggestion linked to a specific job description
requirement) — evaluated in a within-subjects user study.

## Requirements

- **Node.js** ≥ 20 and npm.
- **Tectonic** — self-contained LaTeX engine, used to recompile `.tex` CVs and to
  render reformatted PDFs. macOS: `brew install tectonic`
- **LibreOffice** — headless conversion of `.docx` CVs to PDF.
  macOS: `brew install --cask libreoffice` (provides `soffice`)

Both are required for the export pipeline. On its **first** compile Tectonic downloads
its LaTeX package bundle (a few minutes, network required); later compiles are fast.
Warm it once after installing so the first user-facing export isn't slow:

```bash
printf '\\documentclass{article}\\begin{document}warm\\end{document}' > /tmp/warm.tex
tectonic --outdir /tmp --chatter minimal /tmp/warm.tex
```

## Setup

```bash
npm install
cp .env.example .env   # then fill in values
npm run dev            # http://localhost:3000
```

## Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `openrouter` (free models, default for now) or `anthropic`. All keys server-side only. |
| `OPENROUTER_API_KEY` | OpenRouter API key (https://openrouter.ai/keys). |
| `OPENROUTER_MODEL` | Free-tier model id. Default `nvidia/nemotron-3-super-120b-a12b:free` (good instruction-following + JSON); `google/gemma-4-31b-it:free` is a faster fallback. Browse the live free list at https://openrouter.ai/models?max_price=0. |
| `ANTHROPIC_API_KEY` | Anthropic Messages API key (when `LLM_PROVIDER=anthropic`). |
| `CLAUDE_MODEL` | Claude model id used for all rewrite/suggestion calls. |
| `AUTH_SECRET` | Auth.js session encryption secret (`npx auth secret` or `openssl rand -base64 32`). |
| `DATABASE_URL` | Prisma SQLite location, e.g. `file:./dev.db`. |

Human-centered mode analyses each CV section with a separate model call, several
in parallel. Free OpenRouter models have low rate limits, so a live participant
session can hit `429`s mid-run. For real study sessions, set `LLM_PROVIDER=anthropic`
with an `ANTHROPIC_API_KEY`; keep the free models for development.

## Provisioning accounts

There is no public sign-up; the researcher creates accounts:

```bash
# Study participant (guided two-mode session)
npm run provision -- --email p01@study.local --participant

# General user (free choice of mode)
npm run provision -- --email someone@example.com

# Optional explicit password (otherwise one is generated and printed once)
npm run provision -- --email p02@study.local --participant --password chosen-pass
```

Re-running for an existing email resets the password and participant flag.

## Scripts

- `npm run dev` — development server
- `npm run build` / `npm start` — production build and serve
- `npm run lint` — ESLint
- `npm run provision` — create/update an account (see above)
- `npx tsx scripts/test-export.ts <dir>` — manual check of the three export paths
  (needs `cv.tex`, `cv.docx`, `cv.txt` in `<dir>`; writes `out-*.pdf` alongside them)
- `npx prisma migrate dev` — apply schema changes
- `npx prisma studio` — inspect the database

## Project structure

- `src/app` — Next.js App Router pages and API routes
- `prisma/` — schema and SQLite database (from Phase 2)
- `DESIGN.md` — full project brief: modes, study design, VSD value mapping, fidelity rules
- `Stuff/` — unrelated prior work, not part of this app

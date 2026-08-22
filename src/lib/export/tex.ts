import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
// The implementation directly: pdf-parse's index.js runs debug code when
// loaded outside a parent module context.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const execFileAsync = promisify(execFile);

/**
 * .tex path — highest fidelity. The original source is never restructured:
 * rewritten text is spliced into the untouched preamble/structure, then the
 * document is recompiled with Tectonic. Output PDF is formatting-identical.
 */

export type SpanReplacement = { original: string; replacement: string };

export type TexSpliceResult = {
  source: string;
  applied: SpanReplacement[];
  unplaced: SpanReplacement[];
};

// Escape a string for use inside a RegExp.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Words the model quotes come from the EXTRACTED (LaTeX-stripped) text, so a
// span pulled from the CV rarely matches the raw source character-for-
// character: the source interleaves inline commands (\textbf{…}, \emph{…}) and
// braces between the visible words. Build a regex from the visible words that
// tolerates that inline noise.
//
// The noise class matches whitespace/ties, braces, and inline LaTeX control
// sequences — but deliberately NOT the structural commands \item, \begin and
// \end. That keeps a match inside a single paragraph or list item: an edit
// that spans two \item bullets (e.g. reordering them) will fail to match and
// be reported as unplaced, rather than matching and splicing in text that
// destroys the list structure.
const NOISE =
  "(?:[ \\t~]|[{}]|\\\\(?!item\\b|begin\\b|end\\b)[a-zA-Z]+\\*?(?:\\[[^\\]]*\\])?)*";

// Split a span into visible words, dropping leading list markers that only
// exist in the stripped text (e.g. the "• " this app inserts for \item).
function visibleWords(span: string): string[] {
  return span
    .replace(/^[\s•\-–*]+/gm, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function flexiblePattern(span: string): RegExp {
  const words = visibleWords(span).map(escapeRegExp);
  // A single line break between words is allowed (prose wrapped across lines),
  // but not a blank line, so the match cannot swallow unrelated blocks.
  const between = `${NOISE}(?:\\n${NOISE})?`;
  return new RegExp(words.join(between));
}

/**
 * Replace plain-text spans inside a .tex source. Tries an exact match first,
 * then a whitespace-tolerant match. Spans that cannot be located (e.g. text
 * that only exists after LaTeX commands are stripped) are reported back as
 * `unplaced` so the caller can degrade gracefully rather than silently drop
 * an accepted change.
 */
export function replaceTexSpans(
  source: string,
  replacements: SpanReplacement[],
): TexSpliceResult {
  let out = source;
  const applied: SpanReplacement[] = [];
  const unplaced: SpanReplacement[] = [];

  for (const r of replacements) {
    if (!r.original || r.original === r.replacement) {
      applied.push(r);
      continue;
    }
    const escaped = escapeTexText(stripLeadingListMarker(r.replacement));
    if (out.includes(r.original)) {
      out = out.replace(r.original, escaped);
      applied.push(r);
      continue;
    }
    const flex = flexiblePattern(r.original);
    if (flex.test(out)) {
      out = out.replace(flex, escaped);
      applied.push(r);
      continue;
    }
    unplaced.push(r);
  }

  return { source: out, applied, unplaced };
}

// The source's list structure already provides the bullet (\item for .tex,
// the list paragraph for .docx), so a leading marker in the model's
// replacement text — models routinely echo "• " — would double it. Strip it
// before splicing. Shared by both export paths.
export function stripLeadingListMarker(text: string): string {
  return text.replace(/^\s*[•·▪‣∙*–—-]\s+/, "");
}

// Escape characters that would break LaTeX when inserting model-written
// plain text into a source file. Backslash first.
export function escapeTexText(text: string): string {
  return (
    text
      .replace(/\\/g, "\\textbackslash{}")
      .replace(/([&%$#_{}])/g, "\\$1")
      .replace(/~/g, "\\textasciitilde{}")
      .replace(/\^/g, "\\textasciicircum{}")
      /**
       * Typographic punctuation has no glyph in the T1 fonts Tectonic loads by
       * default, and TeX drops an unrepresentable character rather than
       * failing: "05/2024 – 05/2025" compiled to a date range with nothing
       * between the two dates. Mapped to the TeX ligatures that produce the
       * same marks.
       */
      .replace(/—/g, "---")
      .replace(/–/g, "--")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, "\\ldots{}")
      .replace(/[   ]/g, "~")
      .replace(/[•·]/g, "\\textbullet{}")
  );
}

/** Page count of a compiled PDF, used to check that a rewrite still fits. */
export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const parsed = await pdfParse(pdf);
  return parsed.numpages;
}

/** A compile that failed, with the TeX error rather than the shell command. */
export class TexCompileError extends Error {}

/**
 * Shims for pdfTeX primitives that XeTeX does not have.
 *
 * Tectonic runs XeTeX. Widely-used résumé templates — the Jake's-resume family
 * among them — are written for pdfTeX and open with
 *
 *     \input{glyphtounicode}
 *     \pdfgentounicode=1
 *
 * which improves text extraction under pdfTeX and is an undefined control
 * sequence under XeTeX, so the compile halts before a single line is set. The
 * author's own PDF proves the source is valid; it was simply built by a
 * different engine. Defining the primitives as no-ops lets the document
 * compile unchanged, and costs only the glyph map, which XeTeX writes itself.
 *
 * Inserted after \documentclass so the definitions exist before the preamble
 * uses them, and only when the source does not already define them.
 */
const XETEX_SHIM = String.raw`
\makeatletter
\ifdefined\pdfglyphtounicode\else\long\def\pdfglyphtounicode#1#2{}\fi
\ifdefined\pdfgentounicode\else\newcount\pdfgentounicode\fi
\ifdefined\pdfsuppresswarningpagegroup\else\newcount\pdfsuppresswarningpagegroup\fi
\makeatother
`;

function withXetexShim(source: string): string {
  if (!/\\pdfgentounicode|\\pdfglyphtounicode|glyphtounicode/.test(source)) {
    return source;
  }
  const documentclass = /\\documentclass[^\n]*\n/.exec(source);
  if (!documentclass) return `${XETEX_SHIM}\n${source}`;
  const at = documentclass.index + documentclass[0].length;
  return source.slice(0, at) + XETEX_SHIM + source.slice(at);
}

/**
 * Drop Font Awesome and stub the icon macros the document uses.
 *
 * `\usepackage{fontawesome5}` aborts the engine outright — SIGABRT, no log, no
 * TeX error, nothing to report — so a CV carrying it could never be exported at
 * all. The package is very common in the résumé templates people actually use;
 * the Jake's-resume family puts it on the contact line for the envelope, phone
 * and LinkedIn glyphs.
 *
 * Dropping it costs those few decorative icons and keeps the entire rest of the
 * document: the same contact details are set beside them as ordinary text, so
 * nothing a reader needs is lost. Losing four glyphs beats losing the export.
 *
 * Only the commands the source actually uses are stubbed, which keeps this from
 * becoming a reimplementation of the package. `\faIcon{name}` takes an argument
 * and is stubbed separately. `\fa[A-Z]` is required so that \fancyhf and
 * friends are left alone.
 */
function withoutFontAwesome(source: string): string {
  const loads = /\\usepackage(\[[^\]]*\])?\{fontawesome5?\}[ \t]*\n?/g;
  if (!loads.test(source)) return source;

  const used = new Set(
    [...source.matchAll(/\\(fa[A-Z][A-Za-z]*)/g)].map((m) => m[1]),
  );
  const stubs = [
    String.raw`\providecommand{\faIcon}[1]{}`,
    ...[...used].map((name) => `\\providecommand{\\${name}}{}`),
  ].join("\n");

  const stripped = source.replace(loads, "");
  const begin = /\\begin\{document\}/.exec(stripped);
  return begin
    ? `${stripped.slice(0, begin.index)}${stubs}\n${stripped.slice(begin.index)}`
    : `${stubs}\n${stripped}`;
}

/** The first real TeX error in a log, rather than the whole transcript. */
function texErrorLine(output: string): string | null {
  const line = output
    .split("\n")
    .find((l) => /^!|error:/i.test(l) && !/^error: halted/i.test(l));
  return line ? line.replace(/^!\s*/, "").trim().slice(0, 160) : null;
}

/**
 * A LaTeX package that stops the engine dead rather than reporting an error.
 *
 * Tectonic's XeTeX aborts on some packages with no log and no message at all,
 * which leaves nothing for texErrorLine to find and used to surface the raw
 * shell command to the participant. Naming the package is the only useful thing
 * that can be said, so it is worth checking the source for the ones known to do
 * it before falling back to something generic.
 */
const FATAL_PACKAGES = [/\\usepackage(\[[^\]]*\])?\{fontawesome5?\}/];

function fatalPackageNote(source: string): string | null {
  return FATAL_PACKAGES.some((p) => p.test(source))
    ? "the LaTeX engine could not load one of the packages this CV uses"
    : null;
}

/** Compile a .tex source with Tectonic; returns the PDF bytes. */
export async function compileTex(source: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "cvtex-"));
  try {
    const texPath = join(dir, "cv.tex");
    const prepared = withoutFontAwesome(withXetexShim(source));
    await writeFile(texPath, prepared, "utf-8");
    try {
      await execFileAsync(
        "tectonic",
        ["--outdir", dir, "--chatter", "minimal", texPath],
        { timeout: 180_000 },
      );
    } catch (err) {
      // The raw failure is "Command failed: tectonic --outdir /var/folders/…",
      // which tells the person nothing about their document. A crash with no
      // output leaves nothing to quote, so say what can be said instead of
      // handing them the command line.
      const detail =
        texErrorLine(
          `${(err as { stderr?: string }).stderr ?? ""}\n${(err as { stdout?: string }).stdout ?? ""}`,
        ) ??
        fatalPackageNote(source) ??
        "the LaTeX engine stopped without reporting a reason";
      throw new TexCompileError(`LaTeX could not compile your CV: ${detail}`);
    }
    return await readFile(join(dir, "cv.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

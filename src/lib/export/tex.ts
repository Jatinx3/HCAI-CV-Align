import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

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
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/** Compile a .tex source with Tectonic; returns the PDF bytes. */
export async function compileTex(source: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "cvtex-"));
  try {
    const texPath = join(dir, "cv.tex");
    await writeFile(texPath, source, "utf-8");
    await execFileAsync(
      "tectonic",
      ["--outdir", dir, "--chatter", "minimal", texPath],
      { timeout: 180_000 },
    );
    return await readFile(join(dir, "cv.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

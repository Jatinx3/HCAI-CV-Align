import type { SpanReplacement } from "./export";

/**
 * One-click baseline mode — the commercial status quo (Jobscan, Teal,
 * Resume.io). A single call rewrites the whole CV against the JD, returned in
 * the uploaded format. Deliberately thin: NO authenticity scaffolding, NO
 * structured output, NO per-change control. This is the efficiency arm the
 * study contrasts against the human-centered mode, so it must not carry the
 * anti-fabrication constraints — that difference is the experiment.
 */

export function buildOneClickSystemPrompt(): string {
  return `You are a CV rewriting assistant. Rewrite the user's CV so it is strongly tailored to the target job description, maximising how well the candidate appears to fit the role.

Return the complete rewritten CV as plain text and nothing else — no commentary, no explanations, no notes.

Preserve the CV's overall structure so it can be re-inserted into the original document: keep the same sections in the same order, keep each section heading on its own line unchanged, and keep the same number of content lines (rewrite the wording of a line, but do not split one line into several or merge several into one). Do not add or remove sections.`;
}

export function buildOneClickUserPrompt(
  cvText: string,
  jdText: string,
): string {
  return `Job description:
"""
${jdText.trim()}
"""

CV to rewrite:
"""
${cvText.trim()}
"""

Return the full rewritten CV as plain text.`;
}

/**
 * Strip the delimiters the model echoed back around its own answer.
 *
 * The user prompt fences the job description and the CV in triple quotes, and a
 * model handed a fenced input will sometimes fence its output to match. The
 * closing `"""` then travels the whole pipeline as an ordinary line of the CV
 * and prints under the last section — which is exactly how it reached a
 * participant's downloaded PDF, three characters below "Methodologies".
 *
 * Only whole lines that are nothing but a fence are removed, and only from the
 * ends, so a line of real CV text that happens to contain quotes is untouched.
 * Markdown code fences are treated the same way: same reflex, same damage.
 */
export function stripModelFences(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const isFence = (l: string) => /^\s*(?:`{3,}[a-zA-Z0-9]*|"{3,}|'{3,})\s*$/.test(l);
  const isDroppable = (l: string) => l.trim().length === 0 || isFence(l);

  let start = 0;
  let end = lines.length;
  while (start < end && isDroppable(lines[start])) start++;
  while (end > start && isDroppable(lines[end - 1])) end--;
  return lines.slice(start, end).join("\n");
}

/**
 * Turn a whole-CV rewrite into line-aligned span replacements so the .tex /
 * .docx paths can splice it through the same per-format pipeline the
 * human-centered mode uses. The prompt asks the model to keep line structure;
 * pairing is by line index over the shared length, skipping blank, unchanged,
 * and heading-preserved lines. Any line that can't be located in the source is
 * reported as unplaced by the export pipeline, not silently dropped.
 */
export function deriveLineReplacements(
  originalText: string,
  rewrittenText: string,
): SpanReplacement[] {
  const original = originalText.replace(/\r\n/g, "\n").split("\n");
  const rewritten = rewrittenText.replace(/\r\n/g, "\n").split("\n");
  const reps: SpanReplacement[] = [];

  const n = Math.min(original.length, rewritten.length);
  for (let i = 0; i < n; i++) {
    const a = original[i].trim();
    const b = rewritten[i].trim();
    if (a.length > 0 && b.length > 0 && a !== b) {
      reps.push({ original: a, replacement: b });
    }
  }
  return reps;
}

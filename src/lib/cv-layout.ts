/**
 * Shared CV layout heuristics.
 *
 * The export pipeline turns plain text into a document; the on-screen preview
 * has to make the same decisions about what is a name, a heading, or a bullet,
 * or the participant reviews one layout and downloads another. Both import
 * from here so the two cannot drift apart.
 *
 * Client-safe by construction: no node built-ins, no server-only imports.
 */

export const BULLET = /^\s*[•\-–*]\s+/;

export function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 48 || BULLET.test(t)) return false;
  const caps = t === t.toUpperCase() && /[A-Z]/.test(t);
  const knownHeading =
    /^(summary|profile|experience|work experience|employment|skills|education|projects|certifications|publications|awards|interests|references|languages)$/i.test(
      t,
    );
  if (caps || knownHeading) return true;

  /**
   * Title Case section names — "Professional Experience", "Technical Skills".
   * Common in LaTeX résumé classes, which do not set headings in capitals, so
   * an ALL-CAPS test alone leaves them rendered as body text. Kept tight: a
   * few capitalised words, no digits, and none of the punctuation that marks
   * an entry line ("Capgemini | Software Engineer", "Dublin, Ireland • …").
   */
  const words = t.split(/\s+/);
  return (
    words.length <= 4 &&
    !/[\d|•·,:()]/.test(t) &&
    words.every((w) => /^[A-Z][a-zA-Z-]*$/.test(w))
  );
}

/**
 * Résumé entries put a title on the left and a date or grade hard against the
 * right margin. Text extraction drops the whitespace between the two columns,
 * gluing them into "…Artificial IntelligenceExpected 09/2026". Splitting them
 * back apart is what lets both the preview and the export set the row as the
 * two columns it actually is.
 */
const RIGHT_COLUMN =
  /(Expected|Graduated|Anticipated|Present|GPA|CGPA)\b|\d{1,2}\/\d{4}|\b(19|20)\d{2}\s*[–—-]/;

export function splitEntry(line: string): { left: string; right: string } | null {
  const t = line.trim();
  if (!t || BULLET.test(t) || isHeading(t)) return null;

  // The boundary is a lowercase letter or closing punctuation immediately
  // followed by the start of the right-hand column.
  const m = /([a-z)\].,])(?=(Expected|Graduated|Anticipated|Present|GPA|CGPA|\d{1,2}\/\d{4}))/.exec(
    t,
  );
  if (!m) return null;

  const at = m.index + 1;
  const left = t.slice(0, at).trim();
  const right = t.slice(at).trim();
  if (!left || !right || !RIGHT_COLUMN.test(right)) return null;
  return { left, right };
}

export function titleCase(s: string): string {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * ALL-CAPS headings read as shouting once set in a document face, so they are
 * folded to sentence case. Headings that already carry their own casing —
 * "Professional Experience" — are left exactly as the author wrote them.
 */
export function normaliseHeading(t: string): string {
  const isAllCaps = t === t.toUpperCase() && /[A-Z]/.test(t);
  return isAllCaps ? titleCase(t) : t;
}

/**
 * Rejoin lines that are only broken because the source document was hard
 * wrapped. Extracted PDF and LaTeX text arrives wrapped at the page width, so
 * a single sentence can span three lines; treating each as its own paragraph
 * sets the CV as a column of fragments.
 *
 * A line continues the previous one when the previous line does not end a
 * sentence and this line does not start one. That keeps genuinely separate
 * entries — a role title followed by an achievement, each ending in a full
 * stop — on their own lines.
 */
export function unwrapLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const prev = out[out.length - 1];

    const continues =
      prev !== undefined &&
      prev.length > 0 &&
      line.length > 0 &&
      !isHeading(line) &&
      !isHeading(prev) &&
      // a continuation is never itself a bullet, though it may continue one:
      // long bullets wrap, and "…serving 20K+ daily" / "operations" is one
      // sentence split across two extracted lines
      !BULLET.test(line) &&
      !splitEntry(line) &&
      !splitEntry(prev) &&
      // previous line did not finish a sentence…
      !/[.!?:;]$/.test(prev) &&
      // …and this one does not begin a new entry
      /^[a-z(]/.test(line);

    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

export type CvBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  /** A title/date row. `secondary` marks the sub-line of an entry (the
      institution under a degree), which résumé layouts set in italic. */
  | { kind: "entry"; left: string; right: string; secondary: boolean };

export type CvDoc = {
  /** First non-empty line, treated as the person's name. */
  name: string;
  /** Contact-ish lines that appear before the first heading. */
  contact: string[];
  blocks: CvBlock[];
};

/**
 * Structure plain CV text the same way `renderCvTemplate` does: first non-empty
 * line is the name, short ALL-CAPS or known headings start sections, bullet
 * markers group into lists.
 */
export function layoutCv(text: string): CvDoc {
  const raw = text.replace(/\r\n/g, "\n").split("\n");

  let nameIdx = raw.findIndex((l) => l.trim().length > 0);
  if (nameIdx === -1) nameIdx = 0;
  const name = raw[nameIdx]?.trim() ?? "Curriculum Vitae";

  // Unwrap only below the name, so a lowercase contact line is never absorbed
  // into it. Index 0 of `lines` corresponds to the name itself.
  const lines = [name, ...unwrapLines(raw.slice(nameIdx + 1))];
  nameIdx = 0;

  const blocks: CvBlock[] = [];
  const contact: string[] = [];
  let seenHeading = false;
  let list: string[] | null = null;

  const closeList = () => {
    if (list && list.length) blocks.push({ kind: "list", items: list });
    list = null;
  };

  for (let i = nameIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      closeList();
      continue;
    }
    if (isHeading(t)) {
      closeList();
      seenHeading = true;
      blocks.push({ kind: "heading", text: normaliseHeading(t) });
      continue;
    }
    if (BULLET.test(t)) {
      if (!list) list = [];
      list.push(t.replace(BULLET, ""));
      continue;
    }
    closeList();

    const entry = splitEntry(t);
    if (entry && seenHeading) {
      // Two entry rows in a row means the second describes the first — the
      // institution under a degree — which résumé layouts set as a sub-line.
      const prev = blocks[blocks.length - 1];
      blocks.push({
        kind: "entry",
        left: entry.left,
        right: entry.right,
        secondary: prev?.kind === "entry" && !prev.secondary,
      });
      continue;
    }
    // Lines above the first heading read as contact details, not body copy.
    if (!seenHeading) contact.push(t);
    else blocks.push({ kind: "paragraph", text: t });
  }
  closeList();

  return { name, contact, blocks };
}

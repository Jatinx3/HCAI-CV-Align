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
   * LaTeX résumé classes do not set headings in capitals, so an ALL-CAPS test
   * alone leaves them as body text.
   *
   * Matched against known section vocabulary rather than "any Title Case
   * line": a CV header carries a job title and link labels ("Software
   * Engineer", "Portfolio") that are indistinguishable from a heading by shape
   * alone, and promoting those splits the contact block into false sections.
   */
  return SECTION_NAME.test(t.replace(/[:\s]+$/, ""));
}

/** Section names as résumés actually write them, with common qualifiers. */
const SECTION_NAME =
  /^((professional|work|relevant|other|additional|technical|core|key|personal|selected)\s+)?(summary|profile|objective|about|experience|employment|history|education|skills|competencies|expertise|projects|project|certifications?|publications?|awards?|honou?rs|interests|volunteering|languages|references|activities|training|courses|memberships?|achievements|leadership|extracurriculars?)$/i;

/**
 * Résumé entries put a title on the left and a date or grade hard against the
 * right margin. Text extraction drops the whitespace between the two columns,
 * gluing them into "…Artificial IntelligenceExpected 09/2026". Splitting them
 * back apart is what lets both the preview and the export set the row as the
 * two columns it actually is.
 */
const MONTH = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

const RIGHT_COLUMN = new RegExp(
  `(Expected|Graduated|Anticipated|Present|GPA|CGPA)\\b|\\d{1,2}/\\d{4}|\\b(19|20)\\d{2}\\s*[–—-]|^(${MONTH})[a-z]*\\.?\\s*\\d{4}`,
);

/**
 * A line that is only a date range, or only a place. Résumé macros such as
 * \resumeSubheading{title}{dates}{organisation}{location} put each field in
 * its own brace group, so extraction yields them as four consecutive lines
 * where the document shows two rows.
 */
export function isDateOnly(line: string): boolean {
  const t = line.trim().replace(/\s+/g, " ");
  if (!t || t.length > 34) return false;
  return /^((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(–|—|--|-|to|until)\s*((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{1,2}\/\d{4}|\d{4}|Present|Current|Now)$/i.test(
    t,
  );
}

/** A short line with no sentence punctuation — an organisation or a place. */
export function isShortField(line: string): boolean {
  const t = line.trim();
  return (
    t.length > 0 &&
    t.length <= 48 &&
    !BULLET.test(t) &&
    !isHeading(t) &&
    !/[.!?;:]$/.test(t) &&
    !isDateOnly(t)
  );
}

export function splitEntry(line: string): { left: string; right: string } | null {
  const t = line.trim();
  if (!t || BULLET.test(t) || isHeading(t)) return null;

  // The boundary is a lowercase letter or closing punctuation immediately
  // followed by the start of the right-hand column.
  const m = new RegExp(
    `([a-z)\\].,])(?=(Expected|Graduated|Anticipated|Present|GPA|CGPA|\\d{1,2}/\\d{4}|(${MONTH})[a-z]*\\.?\\s*\\d{4}))`,
  ).exec(t);
  if (!m) return null;

  const at = m.index + 1;
  const left = t.slice(0, at).trim();
  const right = t.slice(at).trim();
  if (!left || !right || !RIGHT_COLUMN.test(right)) return null;
  return { left, right };
}

/**
 * Split a trailing proper noun that extraction glued on: "Airtel International
 * LLPIndia" is an organisation and a location. There is nothing in the string
 * itself that proves where the boundary is, so this is only ever applied to
 * the line directly beneath an entry — the position a résumé reserves for
 * exactly that pair.
 */
export function splitTrailingProper(
  line: string,
): { left: string; right: string } | null {
  const t = line.trim();
  if (!t || BULLET.test(t) || isHeading(t) || t.length > 64) return null;

  const m = /(?<=[A-Za-z])(?=[A-Z][a-z]{2,}$)/.exec(t);
  if (!m || m.index < 2) return null;

  return { left: t.slice(0, m.index).trim(), right: t.slice(m.index).trim() };
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
      // …and this one does not begin a new entry. A line may still start with
      // a capital and be a continuation when it closes a bracket the previous
      // line opened: "…MSc in Computer Science (Human-Centered" / "AI), …".
      (/^[a-z(]/.test(line) ||
        (/\([^)]*$/.test(prev) && /^[^(]*\)/.test(line)) ||
        // Inside a bullet, a following unmarked line is a wrap, whatever its
        // case: a new item would carry its own marker. This is what rescues
        // "…daily using Apache" / "Hadoop and Apache Spark".
        (BULLET.test(prev) && !isDateOnly(line) && !isShortField(line)));

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
      // A blank line does not end a list: extraction puts one between items
      // often enough that closing here shatters a list into single-item lists.
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

    // A title whose date sits on the following line, because the source macro
    // held them in separate brace groups. Rejoining them restores the row the
    // document actually shows, and the organisation/location pair beneath it.
    const next = lines[i + 1]?.trim() ?? "";
    if (seenHeading && next && isDateOnly(next) && isShortField(t)) {
      blocks.push({ kind: "entry", left: t, right: next, secondary: false });
      i += 1;
      const org = lines[i + 1]?.trim() ?? "";
      const place = lines[i + 2]?.trim() ?? "";
      if (org && place && isShortField(org) && isShortField(place)) {
        blocks.push({
          kind: "entry",
          left: org,
          right: place,
          secondary: true,
        });
        i += 2;
      }
      continue;
    }

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
    if (!seenHeading) {
      contact.push(t);
      continue;
    }

    // Directly beneath an entry, a glued organisation/location pair is the
    // sub-line of that entry.
    const last = blocks[blocks.length - 1];
    if (last?.kind === "entry" && !last.secondary) {
      const pair = splitTrailingProper(t);
      if (pair) {
        blocks.push({
          kind: "entry",
          left: pair.left,
          right: pair.right,
          secondary: true,
        });
        continue;
      }
    }

    blocks.push({ kind: "paragraph", text: t });
  }
  closeList();

  return { name, contact, blocks };
}

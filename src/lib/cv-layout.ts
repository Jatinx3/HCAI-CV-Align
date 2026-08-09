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
  return caps || knownHeading;
}

export function titleCase(s: string): string {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
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
      !BULLET.test(line) &&
      !BULLET.test(prev) &&
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
  | { kind: "list"; items: string[] };

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
      blocks.push({ kind: "heading", text: titleCase(t) });
      continue;
    }
    if (BULLET.test(t)) {
      if (!list) list = [];
      list.push(t.replace(BULLET, ""));
      continue;
    }
    closeList();
    // Lines above the first heading read as contact details, not body copy.
    if (!seenHeading) contact.push(t);
    else blocks.push({ kind: "paragraph", text: t });
  }
  closeList();

  return { name, contact, blocks };
}

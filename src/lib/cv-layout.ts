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

/**
 * A short right-hand column that is not a date: a location, a grade, an award.
 * Only ever consulted when a separator has already marked the boundary.
 */
function isPlaceLike(s: string): boolean {
  const t = s.trim();
  return (
    t.length > 1 &&
    t.length <= 40 &&
    !/[.!?;]$/.test(t) &&
    /^[A-Z]/.test(t) &&
    t.split(/\s+/).length <= 5
  );
}

/**
 * A right-hand column that lists tools rather than naming a date or a place:
 * the technology stack résumés hang off a project title.
 *
 * Recognised by shape — comma-separated items, none of them long enough to be
 * a sentence — rather than by length. Length was what decided this before, and
 * it made the same row bold or plain depending on how many libraries the
 * project happened to use.
 */
function isTechList(s: string, minParts = 3): boolean {
  const t = s.trim();
  if (!t || t.length > 120 || /[.!?]$/.test(t)) return false;
  const parts = t
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // Three items or more, because two are far more likely to be a place:
  // "Dublin, Ireland" and "Tempe, AZ" are the right-hand column of an
  // organisation row, not a stack. A title that ends in a link is already
  // known to be a project, so two items are enough there.
  if (parts.length < minParts) return false;
  return parts.every((p) => p.length <= 44 && p.split(/\s+/).length <= 6);
}

/** How many comma-separated items count as a stack, given the title beside it. */
function minStackParts(left: string): number {
  return /\(link\)$/i.test(left.trim()) ? 2 : 3;
}

/** A left-hand column that reads as a title: no sentence, no "Label:" prefix. */
function isEntryTitle(s: string): boolean {
  const t = s.trim();
  return (
    t.length > 0 &&
    t.length <= 80 &&
    !/[.!?]$/.test(t) &&
    !t.includes(":") &&
    t.split(/\s+/).length <= 12
  );
}

export type EntryParts = {
  left: string;
  right: string;
  /**
   * Whether the right column belongs on its own line beneath the title. A date
   * sits opposite its title; a technology stack does not fit there, and forcing
   * it into the same row overflows the measure.
   */
  stacked: boolean;
};

export function splitEntry(line: string): EntryParts | null {
  // A tab is a column boundary the page geometry proved, so it outranks every
  // guess below it. Some templates mark the organisation row with a bullet;
  // the row is still a title/place pair, not a list item.
  if (line.includes("\t")) {
    const [first, ...rest] = line.split("\t");
    const left = first.replace(BULLET, "").trim();
    const right = rest.join(" ").trim();
    if (left && right) {
      return {
        left,
        right,
        stacked: isTechList(right, minStackParts(left)),
      };
    }
    return null;
  }

  const t = line.trim();
  if (!t || BULLET.test(t) || isHeading(t)) return null;

  // Plain templates put no gap between the columns at all; they write a
  // separator. Split there when what follows reads as a right-hand column.
  const piped = /^(.+?)\s+[|•·–—]\s+(.+)$/.exec(t);
  if (piped) {
    const [, left, right] = piped;
    if (RIGHT_COLUMN.test(right) || isDateOnly(right)) {
      return { left: left.trim(), right: right.trim(), stacked: false };
    }
    // "Docu RAG (link) | Python, Pinecone, RocksDB" — a project and its stack.
    // Tested before isPlaceLike, which a short stack also satisfies: deciding
    // between them by length is what set one project opposite its title and
    // the next one below it.
    if (isEntryTitle(left) && isTechList(right, minStackParts(left))) {
      return { left: left.trim(), right: right.trim(), stacked: true };
    }
    if (isPlaceLike(right)) {
      return { left: left.trim(), right: right.trim(), stacked: false };
    }
  }

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
  return { left, right, stacked: false };
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
/**
 * Word parts that are hyphenated because the author wrote them that way, not
 * because the typesetter broke the line: "human-centered", "real-time". Both
 * cases reach extraction as a trailing hyphen, and nothing in the text says
 * which one it was, so the split is decided by whether the part before the
 * hyphen is a prefix résumés genuinely hyphenate.
 */
const REAL_HYPHEN =
  /^(human|multi|cross|self|real|sub|non|pre|post|re|open|end|full|part|time|high|low|data|cloud|micro|co|inter|intra|anti|semi|well|long|short|large|small|first|second|third|state|user|client|server|front|back|top|in|out)$/i;

/**
 * Rejoin a wrapped line. A line broken mid-word leaves a trailing hyphen —
 * "…budget of 200 mil-" / "liseconds." — and joining with a space keeps the
 * break visible in the CV the participant reads and in the text sent to the
 * model.
 */
function joinWrapped(prev: string, line: string): string {
  if (/[a-z]-$/.test(prev) && /^[a-z]/.test(line)) {
    const stem = prev.slice(0, -1).split(/[\s(]/).pop() ?? "";
    return REAL_HYPHEN.test(stem) ? `${prev}${line}` : `${prev.slice(0, -1)}${line}`;
  }
  return `${prev} ${line}`;
}

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
        (BULLET.test(prev) &&
          !isDateOnly(line) &&
          !line.includes("\t") &&
          !splitEntry(line)));

    if (continues) out[out.length - 1] = joinWrapped(prev, line);
    else out.push(line);
  }
  return out;
}

export type CvBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  /** A title/date row. `secondary` marks the sub-line of an entry (the
      institution under a degree), which résumé layouts set in italic.
      `stacked` puts the right column on its own line — a technology stack is
      too long to sit opposite its title the way a date does. */
  | {
      kind: "entry";
      left: string;
      right: string;
      secondary: boolean;
      stacked: boolean;
    };

export type CvDoc = {
  /** First non-empty line, treated as the person's name. */
  name: string;
  /** A professional title under the name, when the header carries one. */
  subtitle: string | null;
  /** Contact details that appear before the first heading. */
  contact: string[];
  blocks: CvBlock[];
};

/**
 * Break a run of contact details that extraction joined with plain spaces.
 * A résumé header separates them with icons or bullets; those do not survive,
 * leaving "+353 87 380 3453 name@example.com linkedin.com/in/x" as one string
 * in which the reader cannot see where one detail ends and the next begins.
 */
export function splitContactRun(line: string): string[] {
  const t = line.trim();
  if (!t) return [];

  // A marker is inserted at each boundary and split on, so that spaces inside
  // one detail — "+353 87 380 3453" — are left intact.
  const SEP = "\u0000";
  const parts = t
    // Separators the document did manage to keep.
    .replace(/\s*[\u2022\u00b7|]\s*/g, SEP)
    // Before an email address.
    // The separator is excluded from the class, or the lookahead matches
    // across an already-split boundary and cuts the detail before it.
    // Not after a label — "Email: someone@example.com" is one detail.
    .replace(/(?<!:)\s+(?=[^\s@\u0000]+@[^\s@\u0000]+\.[a-z]{2,})/gi, SEP)
    // Before a URL or a bare domain.
    .replace(
      /\s+(?=(https?:\/\/|www\.)|[a-z0-9-]+\.(com|org|net|io|dev|me|co|ie|uk)\b)/gi,
      SEP,
    )
    .split(SEP)
    .map((s) => s.trim())
    // A leftover icon glyph carries no letters or digits, or stands alone as a
    // single character; neither is a contact detail.
    .filter((s) => s.length > 1 && /[\p{L}\p{N}]/u.test(s));

  // Deliberately no fallback to the raw line: when everything was filtered the
  // line held only icons, and returning it would put them back.
  return parts;
}

/** A short line with no contact punctuation — a professional title. */
function looksLikeTitle(line: string): boolean {
  const t = line.trim();
  return (
    t.length > 0 &&
    t.length <= 44 &&
    !/[@\d]/.test(t) &&
    !/(https?:|www\.|\.com|\.org|\.io|\.dev)/i.test(t) &&
    !/[•·|]/.test(t)
  );
}

/**
 * Structure plain CV text the same way `renderCvTemplate` does: first non-empty
 * line is the name, short ALL-CAPS or known headings start sections, bullet
 * markers group into lists.
 */
export function layoutCv(text: string): CvDoc {
  const raw = text.replace(/\r\n/g, "\n").split("\n");

  let nameIdx = raw.findIndex((l) => l.trim().length > 0);
  if (nameIdx === -1) nameIdx = 0;

  // Some headers set the name on the left and a contact detail hard right, on
  // the same line. Only the left column is the name.
  const nameLine = raw[nameIdx]?.trim() ?? "Curriculum Vitae";
  const [namePart, ...nameRest] = nameLine.split("\t");
  const name = namePart.trim() || "Curriculum Vitae";
  const headerRight = nameRest.join(" ").trim();

  // Unwrap only below the name, so a lowercase contact line is never absorbed
  // into it. Index 0 of `lines` corresponds to the name itself.
  const lines = [name, ...unwrapLines(raw.slice(nameIdx + 1))];
  nameIdx = 0;

  const blocks: CvBlock[] = [];
  const contact: string[] = [];
  if (headerRight) contact.push(headerRight);
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
    // A bullet that carries a column boundary is an entry row, not a list item.
    if (BULLET.test(t) && !t.includes("\t")) {
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
      blocks.push({
        kind: "entry",
        left: t,
        right: next,
        secondary: false,
        stacked: false,
      });
      i += 1;
      const org = lines[i + 1]?.trim() ?? "";
      const place = lines[i + 2]?.trim() ?? "";
      if (org && place && isShortField(org) && isShortField(place)) {
        blocks.push({
          kind: "entry",
          left: org,
          right: place,
          secondary: true,
          stacked: false,
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
        // A project title carrying its own stack is never the sub-line of the
        // project above it.
        secondary:
          !entry.stacked && prev?.kind === "entry" && !prev.secondary,
        stacked: entry.stacked,
      });
      continue;
    }
    // Lines above the first heading read as contact details, not body copy.
    if (!seenHeading) {
      const prev = contact[contact.length - 1];
      // A phone number wrapped across two lines in the source is still one
      // number: "…• +353" / "857331590".
      if (prev && /[\d+]$/.test(prev) && /^\d/.test(t)) {
        contact[contact.length - 1] = `${prev} ${t}`;
      } else {
        contact.push(t);
      }
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
          stacked: false,
        });
        continue;
      }
    }

    blocks.push({ kind: "paragraph", text: t });
  }
  closeList();

  // A title directly under the name is a subtitle, not a contact detail.
  let subtitle: string | null = null;
  if (contact.length > 0 && looksLikeTitle(contact[0])) {
    subtitle = contact.shift()!;
  }

  return {
    name,
    subtitle,
    // A contact line may itself be a two-column row ("ijatin.dev \t Mobile: …").
    contact: contact
      .flatMap((c) => c.split("\t"))
      .map((c) => c.trim())
      .filter(Boolean)
      .flatMap(splitContactRun),
    blocks,
  };
}

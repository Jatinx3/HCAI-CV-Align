/**
 * CV section parsing. The human-centered mode analyses each section against
 * the JD independently — never a monolithic rewrite — so the CV must first be
 * split into labelled sections.
 *
 * Heuristic and deliberately conservative: text that doesn't match a known
 * heading stays in the preceding section rather than being invented into a
 * new one. Anything before the first heading becomes the "header" section
 * (name / contact), which is not sent for rewriting.
 */

export type SectionKind =
  | "header"
  | "summary"
  | "experience"
  | "skills"
  | "education"
  | "other";

export type CvSection = {
  /** Stable id for UI + telemetry: kind plus ordinal, e.g. "experience-0". */
  id: string;
  kind: SectionKind;
  /** Heading text as it appears in the CV ("" for the header block). */
  heading: string;
  /** Body text, excluding the heading line. */
  text: string;
};

const HEADING_PATTERNS: { kind: SectionKind; pattern: RegExp }[] = [
  {
    kind: "summary",
    pattern: /^(professional\s+)?(summary|profile|objective|about( me)?)$/i,
  },
  {
    kind: "experience",
    pattern:
      /^(work\s+|professional\s+|relevant\s+)?(experience|employment( history)?|career( history)?|positions? held)$/i,
  },
  {
    kind: "skills",
    pattern:
      /^(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|expertise|proficiencies)$/i,
  },
  {
    kind: "education",
    pattern:
      /^(education|academic background|qualifications|academic qualifications)$/i,
  },
];

const OTHER_HEADINGS =
  /^(projects|publications|certifications?|awards|honou?rs|interests|volunteering|languages|references|activities|training|courses|memberships?)$/i;

/**
 * Undo letter-spacing so a tracked heading can be recognised.
 *
 * Designers set section headings with wide tracking — P R O F I L E — and text
 * extraction faithfully reports a space between every glyph. Nothing then
 * matched: "P R O F I L E" is not "profile", and the ALL-CAPS fallback counts
 * seven words where it allows four. A real participant's CV parsed into zero
 * sections and the review screen told them their CV had nothing to rewrite.
 *
 * Groups separated by two or more spaces are treated as separate words, so
 * "E X P E R I E N C E" collapses to one word and a two-word heading survives
 * as two. Only runs of single alphanumeric characters collapse, which leaves
 * "R & D" alone, and three is the shortest run worth treating as tracked type.
 */
function collapseLetterSpacing(s: string): string {
  return s
    .trim()
    .split(/\s{2,}/)
    .map((group) => {
      const tokens = group.split(/\s+/).filter(Boolean);
      const tracked =
        tokens.length >= 3 && tokens.every((t) => /^[A-Za-z0-9]$/.test(t));
      return tracked ? tokens.join("") : group;
    })
    .join(" ");
}

/**
 * A line is a heading if it is short, not a bullet, and either matches a known
 * section name or looks like a standalone ALL-CAPS label.
 */
function classifyHeading(line: string): SectionKind | null {
  const t = collapseLetterSpacing(line.trim().replace(/[:\s]+$/, ""));
  if (!t || t.length > 48) return null;
  if (/^\s*[•\-–*]\s+/.test(line)) return null;
  // Lines with sentence punctuation are prose, not headings.
  if (/[.!?,;]$/.test(t)) return null;

  for (const { kind, pattern } of HEADING_PATTERNS) {
    if (pattern.test(t)) return kind;
  }
  if (OTHER_HEADINGS.test(t)) return "other";

  // ALL-CAPS standalone label with no digits — an unrecognised section name.
  const isCaps = t === t.toUpperCase() && /[A-Z]/.test(t) && !/\d/.test(t);
  if (isCaps && t.split(/\s+/).length <= 4) return "other";

  return null;
}

export function parseSections(cvText: string): CvSection[] {
  const lines = cvText.replace(/\r\n/g, "\n").split("\n");
  const sections: CvSection[] = [];
  const counters: Record<string, number> = {};

  let current: { kind: SectionKind; heading: string; body: string[] } = {
    kind: "header",
    heading: "",
    body: [],
  };

  const push = () => {
    const text = current.body.join("\n").trim();
    // Drop empty sections, except a header that genuinely has content.
    if (!text && !current.heading) return;
    const n = counters[current.kind] ?? 0;
    counters[current.kind] = n + 1;
    sections.push({
      id: `${current.kind}-${n}`,
      kind: current.kind,
      heading: current.heading,
      text,
    });
  };

  for (const line of lines) {
    const kind = classifyHeading(line);
    if (kind) {
      push();
      current = { kind, heading: line.trim().replace(/[:\s]+$/, ""), body: [] };
    } else {
      current.body.push(line);
    }
  }
  push();

  return sections;
}

/** Sections that are sent to the model. The header block is never rewritten. */
export function rewritableSections(sections: CvSection[]): CvSection[] {
  return sections.filter((s) => s.kind !== "header" && s.text.trim().length > 0);
}

/**
 * Reassemble a CV from sections, preserving original heading lines. Used to
 * build the live working CV as the user accepts and edits suggestions.
 */
export function assembleCv(sections: CvSection[]): string {
  return sections
    .map((s) => (s.heading ? `${s.heading}\n${s.text}` : s.text))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

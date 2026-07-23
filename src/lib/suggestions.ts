import type { CvSection } from "./sections";

/**
 * The suggestion contract for human-centered mode.
 *
 * Transparency and authenticity are enforced here, not just requested in the
 * prompt: a suggestion missing its explanation or its JD requirement is
 * INVALID and is never shown to the user. Same for a "suggestion" that would
 * not actually change anything.
 */

export const CONSERVATISM_LEVELS = [
  {
    value: 1,
    label: "Very conservative",
    hint: "Minimal edits, wording stays close to your original.",
  },
  {
    value: 2,
    label: "Conservative",
    hint: "Light-touch rephrasing where it clearly helps.",
  },
  {
    value: 3,
    label: "Balanced",
    hint: "Rephrase and reorder where the job description warrants it.",
  },
  {
    value: 4,
    label: "Assertive",
    hint: "Stronger reframing of what your CV already says.",
  },
  {
    value: 5,
    label: "Very assertive",
    hint: "Maximum reframing and reordering, still no invented content.",
  },
] as const;

export type ConservatismLevel = 1 | 2 | 3 | 4 | 5;

export function isConservatismLevel(n: unknown): n is ConservatismLevel {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

function conservatismDescription(level: ConservatismLevel): string {
  return CONSERVATISM_LEVELS.find((l) => l.value === level)!.hint;
}

export type Suggestion = {
  id: string;
  sectionId: string;
  original: string;
  suggested: string;
  explanation: string;
  jdRequirement: string;
};

/**
 * The authenticity system prompt. Every hard constraint is load-bearing:
 * removing any of them changes what the prototype is arguing for.
 */
export function buildSystemPrompt(level: ConservatismLevel): string {
  return `You assist a job seeker in aligning their existing CV to a specific job description.
You operate on one CV section at a time and return focused suggestions, not a rewrite.

Hard constraints:
- You may only rephrase, reframe, reorganise, or surface content that is already present
  in the user's original CV.
- You must never introduce a skill, tool, technology, employer, role, qualification,
  certification, metric, or achievement that does not appear in the original CV.
- If the job description asks for something the CV does not evidence, do not invent it.
  You may note the gap, but you must not fabricate content to fill it.
- Every suggestion must cite the specific job description requirement or phrase it addresses.
- Every suggestion must include a short, plain-language explanation of why it helps.

Conservatism level: ${level} of 5 — ${conservatismDescription(level)}
Conservative means minimal, light-touch edits close to the original wording. Assertive
means stronger reframing and reordering, still within the constraints above.

Return between 0 and 4 suggestions for this section. Prefer a few strong suggestions over
many weak ones. If the section already aligns well, return an empty suggestions array.

The "original" field must quote text exactly as it appears in the section, character for
character, so it can be located in the source document. Do not paraphrase it.

Return only valid JSON in this shape:
{
  "section": "<section name>",
  "suggestions": [
    {
      "original": "<exact text from the section>",
      "suggested": "<proposed text>",
      "explanation": "<why this helps, plain language>",
      "jd_requirement": "<the specific JD phrase or requirement this addresses>"
    }
  ]
}

Return no prose outside the JSON.`;
}

export function buildUserPrompt(section: CvSection, jdText: string): string {
  return `Job description:
"""
${jdText.trim()}
"""

CV section — ${section.heading || section.kind}:
"""
${section.text.trim()}
"""

Analyse this section against the job description and return the JSON described above.`;
}

/**
 * Extract a JSON object from a model response. Free models in particular tend
 * to wrap JSON in prose or code fences, so this is tolerant — but it never
 * relaxes the validation that follows.
 */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in the model response.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export type ValidationOutcome = {
  suggestions: Suggestion[];
  /** Suggestions dropped for violating the contract, with the reason.
      Surfaced for research transparency, never shown as advice. */
  rejected: { reason: string; raw: unknown }[];
};

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validate raw model output against the contract.
 *
 * A suggestion is invalid — and must not be shown — when it is missing its
 * explanation or its JD requirement (transparency), when it doesn't quote
 * text that actually exists in the section (authenticity: it would otherwise
 * be editing text the user never wrote), or when it changes nothing.
 */
export function validateSuggestions(
  parsed: unknown,
  section: CvSection,
): ValidationOutcome {
  const suggestions: Suggestion[] = [];
  const rejected: { reason: string; raw: unknown }[] = [];

  const rawList = (parsed as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(rawList)) {
    return {
      suggestions,
      rejected: [{ reason: "Response had no suggestions array.", raw: parsed }],
    };
  }

  const sectionText = section.text;
  const normalisedSection = normalise(sectionText);

  rawList.forEach((item, i) => {
    const r = item as Record<string, unknown>;
    const original = typeof r.original === "string" ? r.original.trim() : "";
    const suggested = typeof r.suggested === "string" ? r.suggested.trim() : "";
    const explanation =
      typeof r.explanation === "string" ? r.explanation.trim() : "";
    const jdRequirement =
      typeof r.jd_requirement === "string"
        ? r.jd_requirement.trim()
        : typeof r.jdRequirement === "string"
          ? r.jdRequirement.trim()
          : "";

    if (!nonEmptyString(suggested)) {
      rejected.push({ reason: "No suggested text.", raw: item });
      return;
    }
    // Transparency is mandatory — both fields, every time.
    if (!nonEmptyString(explanation)) {
      rejected.push({ reason: "Missing explanation.", raw: item });
      return;
    }
    if (!nonEmptyString(jdRequirement)) {
      rejected.push({ reason: "Missing JD requirement.", raw: item });
      return;
    }
    if (!nonEmptyString(original)) {
      rejected.push({ reason: "Missing original text to replace.", raw: item });
      return;
    }
    // The quoted original must really exist in the section, or accepting it
    // would edit text the user never wrote.
    if (
      !sectionText.includes(original) &&
      !normalisedSection.includes(normalise(original))
    ) {
      rejected.push({
        reason: "Quoted original text is not present in the section.",
        raw: item,
      });
      return;
    }
    if (normalise(original) === normalise(suggested)) {
      rejected.push({ reason: "Suggestion changes nothing.", raw: item });
      return;
    }

    suggestions.push({
      id: `${section.id}-s${i}`,
      sectionId: section.id,
      original,
      suggested,
      explanation,
      jdRequirement,
    });
  });

  return { suggestions, rejected };
}

function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

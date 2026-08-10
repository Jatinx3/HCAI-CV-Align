import type { CompletionRequest } from "./llm";

/**
 * A deterministic offline provider, selected with LLM_PROVIDER=stub.
 *
 * Free-tier models take seconds to minutes per call and rate-limit under load,
 * which makes exercising a whole flow — upload, suggest, accept, export, and
 * the two-mode study walkthrough — slow and flaky for reasons that have
 * nothing to do with the code under test. This returns contract-valid output
 * instantly, with no network and no key, so the interface and the study flow
 * can be worked on and tested repeatably.
 *
 * It is a test double, not a model: the wording it produces is mechanical. It
 * exists to prove the pipeline carries a suggestion correctly from prompt to
 * accepted change, not to say anything useful about a CV.
 */

/** Deterministic verb swaps — enough to guarantee a real wording change. */
const VERBS: Record<string, string> = {
  built: "Developed",
  designed: "Architected",
  engineered: "Delivered",
  mentored: "Coached",
  automated: "Streamlined",
  wrote: "Authored",
  shipped: "Released",
  led: "Directed",
  managed: "Oversaw",
  created: "Produced",
  developed: "Built",
  optimised: "Tuned",
  optimized: "Tuned",
  implemented: "Delivered",
  migrated: "Moved",
  reduced: "Cut",
  improved: "Raised",
  maintained: "Supported",
  deployed: "Rolled out",
  integrated: "Connected",
  architected: "Designed",
};

function quoted(prompt: string, after: string): string {
  const at = prompt.indexOf(after);
  if (at === -1) return "";
  const open = prompt.indexOf('"""', at);
  if (open === -1) return "";
  const close = prompt.indexOf('"""', open + 3);
  return close === -1 ? "" : prompt.slice(open + 3, close).trim();
}

/** A requirement-shaped line from the job description, for citation. */
function jdRequirement(jd: string, n: number): string {
  const candidates = jd
    .split("\n")
    .map((l) => l.replace(/^[-•*\s]+/, "").trim())
    .filter((l) => l.length > 18 && l.length < 110 && /[a-z]/.test(l));
  return candidates.length
    ? candidates[n % candidates.length]
    : "the job description";
}

/**
 * Rewrite one line by swapping its leading verb. Returns null when the line
 * has no verb to swap, which keeps the stub from emitting a "change" that the
 * validator would rightly reject for changing nothing.
 */
function reword(line: string): string | null {
  const text = line.replace(/^[-•*\s]+/, "").trim();
  if (text.length < 24 || text.length > 300) return null;
  // Records — dates, grades — have no wording to improve, and the validator
  // rejects rewrites of them.
  if (/\b(GPA|CGPA)\b|\d{1,2}\/\d{4}|\b(19|20)\d{2}\s*[–—-]/.test(text)) {
    return null;
  }
  const first = text.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  const swap = VERBS[first];
  if (!swap) return null;
  return swap + text.slice(text.split(/\s+/)[0].length);
}

function suggestionsResponse(user: string): string {
  const section = quoted(user, "CV section");
  const jd = quoted(user, "Job description");

  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const suggestions: Record<string, string>[] = [];
  for (const line of lines) {
    if (suggestions.length >= 2) break;
    const suggested = reword(line);
    if (!suggested) continue;
    suggestions.push({
      original: line.replace(/^[-•*\s]+/, "").trim(),
      suggested,
      explanation:
        "Leads with a stronger verb so the achievement reads as ownership rather than participation.",
      jd_requirement: jdRequirement(jd, suggestions.length),
    });
  }

  return JSON.stringify({
    section: "stub",
    suggestions,
    gaps: [
      {
        jd_requirement: jdRequirement(jd, 7),
        note: "This section does not evidence that requirement. (Offline stub provider.)",
      },
    ],
  });
}

/** One-click returns plain text, keeping line structure so splicing works. */
function oneClickResponse(user: string): string {
  const cv = quoted(user, "CV to rewrite");
  return cv
    .split("\n")
    .map((line) => reword(line) ?? line)
    .join("\n");
}

export function completeStub({ system, user }: CompletionRequest): string {
  const structured = /"suggestions"|jd_requirement/.test(system);
  return structured ? suggestionsResponse(user) : oneClickResponse(user);
}

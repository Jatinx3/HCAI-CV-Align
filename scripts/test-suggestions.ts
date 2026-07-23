/**
 * Checks the pure logic of human-centered mode: section parsing and the
 * validation rules that enforce the transparency and authenticity
 * constraints. No API key or network needed.
 *
 * Usage: npx tsx scripts/test-suggestions.ts
 */
import { parseSections, rewritableSections, assembleCv } from "../src/lib/sections";
import { validateSuggestions, extractJson } from "../src/lib/suggestions";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`, detail !== undefined ? detail : "");
  }
}

const CV = `Jane Doe
jane@example.com

SUMMARY
Backend engineer with 5 years of experience building data pipelines in Python and Go.

EXPERIENCE
Acme Corp - Senior Engineer (2021-2025)
- Built ETL pipelines processing 2TB daily
- Led migration from monolith to microservices

SKILLS
Python, Go, PostgreSQL, Docker, Kubernetes

EDUCATION
BSc Computer Science, University of Example (2016-2019)`;

console.log("\nsection parsing");
const sections = parseSections(CV);
const kinds = sections.map((s) => s.kind);
check("header captured before first heading", kinds[0] === "header", kinds);
check("finds summary", kinds.includes("summary"), kinds);
check("finds experience", kinds.includes("experience"), kinds);
check("finds skills", kinds.includes("skills"), kinds);
check("finds education", kinds.includes("education"), kinds);
check(
  "header is not rewritable",
  !rewritableSections(sections).some((s) => s.kind === "header"),
);
check(
  "experience body kept intact",
  sections.find((s) => s.kind === "experience")!.text.includes("2TB daily"),
);
check(
  "assemble round-trips content",
  assembleCv(sections).includes("BSc Computer Science") &&
    assembleCv(sections).includes("Jane Doe"),
);

// Prose lines that merely look short must not be treated as headings.
const prose = parseSections("SUMMARY\nI led a team.\nWe shipped fast.");
check(
  "sentence lines are not headings",
  prose.filter((s) => s.kind !== "header").length === 1,
  prose.map((s) => s.kind),
);

console.log("\nvalidation — the VSD constraints");
const section = sections.find((s) => s.kind === "experience")!;
const ORIGINAL = "Built ETL pipelines processing 2TB daily";

function validateOne(obj: Record<string, unknown>) {
  return validateSuggestions({ suggestions: [obj] }, section);
}

const good = validateOne({
  original: ORIGINAL,
  suggested: "Engineered ETL pipelines handling 2TB of data daily",
  explanation: "Uses the job description's wording for data engineering.",
  jd_requirement: "experience with large-scale data pipelines",
});
check("valid suggestion is accepted", good.suggestions.length === 1);

const noExplanation = validateOne({
  original: ORIGINAL,
  suggested: "Engineered ETL pipelines handling 2TB of data daily",
  jd_requirement: "large-scale data pipelines",
});
check(
  "missing explanation is rejected (transparency)",
  noExplanation.suggestions.length === 0 &&
    noExplanation.rejected[0].reason.includes("explanation"),
  noExplanation.rejected,
);

const noJd = validateOne({
  original: ORIGINAL,
  suggested: "Engineered ETL pipelines handling 2TB of data daily",
  explanation: "Reads better.",
});
check(
  "missing JD requirement is rejected (transparency)",
  noJd.suggestions.length === 0 &&
    noJd.rejected[0].reason.includes("JD requirement"),
  noJd.rejected,
);

const fabricated = validateOne({
  original: "Managed a team of 12 engineers across three offices",
  suggested: "Directed 12 engineers internationally",
  explanation: "Shows leadership.",
  jd_requirement: "team leadership",
});
check(
  "quoting text absent from the CV is rejected (authenticity)",
  fabricated.suggestions.length === 0 &&
    fabricated.rejected[0].reason.includes("not present"),
  fabricated.rejected,
);

const noop = validateOne({
  original: ORIGINAL,
  suggested: ORIGINAL,
  explanation: "No change.",
  jd_requirement: "data pipelines",
});
check("no-op suggestion is rejected", noop.suggestions.length === 0);

const missingArray = validateSuggestions({ nonsense: true }, section);
check(
  "malformed response yields no suggestions",
  missingArray.suggestions.length === 0 && missingArray.rejected.length === 1,
);

console.log("\nJSON extraction from messy model output");
check(
  "parses fenced json",
  (extractJson('```json\n{"suggestions": []}\n```') as { suggestions: [] })
    .suggestions.length === 0,
);
check(
  "parses json wrapped in prose",
  (
    extractJson('Sure! Here you go:\n{"suggestions": []}\nHope that helps.') as {
      suggestions: [];
    }
  ).suggestions.length === 0,
);
let threw = false;
try {
  extractJson("no json here at all");
} catch {
  threw = true;
}
check("throws when there is no JSON", threw);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);

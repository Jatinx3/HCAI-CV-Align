/**
 * Checks one-click line-alignment derivation. No key/network.
 * Usage: npx tsx scripts/test-one-click.ts
 */
import { deriveLineReplacements } from "../src/lib/one-click";
import { replaceTexSpans } from "../src/lib/export/tex";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`, cond ? "" : (detail ?? ""));
  if (!cond) failures++;
}

const ORIGINAL = `Jane Doe
SUMMARY
Backend engineer with 5 years of experience building data pipelines.
EXPERIENCE
Built ETL pipelines processing 2TB daily
Led migration from monolith to microservices`;

// Model preserved structure, reworded content lines, kept heading lines.
const REWRITTEN = `Jane Doe
SUMMARY
Senior data engineer with 5 years building large-scale ETL pipelines.
EXPERIENCE
Engineered ETL pipelines processing 2TB of data every day
Directed the migration from a monolith to microservices`;

const reps = deriveLineReplacements(ORIGINAL, REWRITTEN);
check("skips unchanged name/heading lines", reps.length === 3, reps.map(r=>r.original.slice(0,20)));
check("pairs summary line", reps.some(r=>r.original.startsWith("Backend engineer") && r.replacement.startsWith("Senior data")));
check("pairs both experience lines",
  reps.some(r=>r.original.startsWith("Built ETL")) && reps.some(r=>r.original.startsWith("Led migration")));

// Mismatched line counts: only shared prefix is paired, no crash.
const short = deriveLineReplacements(ORIGINAL, "Jane Doe\nSUMMARY\nShort.");
check("tolerates fewer rewritten lines", short.length >= 0 && short.every(r=>r.original && r.replacement));

// The derived reps actually splice into a formatted .tex source.
const TEX = `\\documentclass{article}
\\begin{document}
\\section*{Jane Doe}
\\section{Summary}
Backend engineer with \\textbf{5 years} of experience building data pipelines.
\\end{document}`;
const spliced = replaceTexSpans(TEX, deriveLineReplacements(
  "Backend engineer with 5 years of experience building data pipelines.",
  "Senior data engineer with 5 years building large-scale ETL pipelines."));
check("derived rep splices into formatted tex",
  spliced.applied.length === 1 && spliced.source.includes("Senior data engineer"),
  { unplaced: spliced.unplaced.length });

console.log(failures === 0 ? "\nAll one-click checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

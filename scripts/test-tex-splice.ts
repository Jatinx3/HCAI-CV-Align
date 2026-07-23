/**
 * Regression tests for splicing model-quoted spans back into .tex source.
 *
 * The spans the model quotes come from the LaTeX-stripped extracted text, so
 * they rarely match the raw source verbatim. These lock in the three cases:
 *   - inline-formatted edits (\textbf between words) must splice,
 *   - single list-item content edits must splice,
 *   - multi-item reorders must NOT match (they would break list structure)
 *     and instead be reported as unplaced.
 *
 * Self-contained, no network. Usage: npx tsx scripts/test-tex-splice.ts
 */
import { replaceTexSpans } from "../src/lib/export/tex";

const SOURCE = `\\documentclass{article}
\\begin{document}
\\section*{Jane Doe}
\\section{Summary}
Backend engineer with \\textbf{5 years} of experience building data pipelines.
\\section{Experience}
\\begin{itemize}
\\item Built ETL pipelines processing 2TB daily
\\item Led migration from monolith to microservices
\\end{itemize}
\\end{document}`;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`, cond ? "" : (detail ?? ""));
  if (!cond) failures++;
}

// 1. Inline-command edit: \textbf{5 years} sits between the quoted words.
{
  const rep = {
    original: "Backend engineer with 5 years of experience building data pipelines.",
    replacement: "Five years of backend engineering experience building data pipelines.",
  };
  const r = replaceTexSpans(SOURCE, [rep]);
  check(
    "inline-formatted edit splices",
    r.applied.length === 1 && r.source.includes(rep.replacement),
    { unplaced: r.unplaced.length },
  );
}

// 2. Single list-item content edit: the \item before it is preserved.
{
  const rep = {
    original: "• Built ETL pipelines processing 2TB daily",
    replacement: "Engineered ETL pipelines processing 2TB of data daily",
  };
  const r = replaceTexSpans(SOURCE, [rep]);
  check(
    "single bullet content edit splices",
    r.applied.length === 1 && r.source.includes(rep.replacement),
    { unplaced: r.unplaced.length },
  );
  check(
    "the \\item marker is preserved",
    r.source.includes(`\\item ${rep.replacement}`),
  );
}

// 3. Multi-item reorder must stay unplaced (splicing would wreck the list).
{
  const rep = {
    original:
      "• Built ETL pipelines processing 2TB daily\n• Led migration from monolith to microservices",
    replacement:
      "• Led migration from monolith to microservices\n• Built ETL pipelines processing 2TB daily",
  };
  const r = replaceTexSpans(SOURCE, [rep]);
  check(
    "multi-bullet reorder is reported unplaced",
    r.applied.length === 0 && r.unplaced.length === 1,
    { applied: r.applied.length },
  );
}

// 4. A verbatim span (no inline noise) still splices via the exact path.
{
  const rep = {
    original: "Led migration from monolith to microservices",
    replacement: "Led the migration from a monolith to microservices",
  };
  const r = replaceTexSpans(SOURCE, [rep]);
  check("verbatim span still splices", r.applied.length === 1);
}

// 5. A leading bullet in the replacement (models echo "• ") is stripped, so
//    it doesn't double the \item marker already in the source.
{
  const rep = {
    original: "Built ETL pipelines processing 2TB daily",
    replacement: "• Engineered scalable ETL pipelines processing 2TB daily",
  };
  const r = replaceTexSpans(SOURCE, [rep]);
  check(
    "leading bullet in replacement is stripped",
    r.applied.length === 1 &&
      r.source.includes("\\item Engineered scalable ETL") &&
      !r.source.includes("\\item • "),
  );
}

console.log(
  failures === 0 ? "\nAll tex-splice checks passed.\n" : `\n${failures} FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);

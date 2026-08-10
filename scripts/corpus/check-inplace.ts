/**
 * Exercise the in-place PDF editor over the generated corpus.
 *
 *   npx tsx scripts/corpus/check-inplace.ts
 *
 * Run scripts/corpus/check.ts first — this reads the PDFs it produced.
 *
 * For each template it applies a realistic set of edits (a shortened bullet, a
 * same-length rewrite, and one deliberately far too long) and reports what the
 * editor did with each. What matters is not that every edit lands — some
 * cannot, and that is the honest answer — but that the outcome is always
 * either a verified document or a clean fallback, never a corrupted file.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CV } from "./content";
import { TEMPLATES } from "./templates";
import { editPdfInPlace, verifyInPlace } from "../../src/lib/export/pdf-inplace";
import { exportCv } from "../../src/lib/export";

const OUT = new URL("./out/", import.meta.url).pathname;

const bullets = CV.sections[1].entries![0].bullets;

const EDITS = [
  {
    label: "shorter rewrite",
    original: bullets[1],
    replacement:
      "Cut median reconciliation latency from four hours to eleven minutes.",
  },
  {
    label: "similar length",
    original: bullets[2],
    replacement:
      "Mentored three engineers and started the weekly design review the platform group still runs.",
  },
  {
    label: "far too long",
    original: bullets[0],
    replacement:
      "Designed, built, operated and continuously improved the settlement service handling twelve million transactions every month, owning its on-call rotation, its dashboards, its alerting and its capacity planning end to end.",
  },
];

(async () => {
  let anyCorrupt = false;

  for (const name of Object.keys(TEMPLATES)) {
    const path = join(OUT, `${name}.pdf`);
    if (!existsSync(path)) {
      console.log(`SKIP  ${name} — run scripts/corpus/check.ts first`);
      continue;
    }
    const original = readFileSync(path);

    const edit = await editPdfInPlace(original, EDITS);
    if (!edit.ok) {
      console.log(`\n${name.padEnd(9)} in-place refused: ${edit.reason}`);
    } else {
      const placed = EDITS.filter((e) => !edit.unplaced.includes(e));
      const check = await verifyInPlace(edit.pdf, original, placed);
      writeFileSync(join(OUT, `${name}-edited.pdf`), edit.pdf);
      console.log(
        `\n${name.padEnd(9)} applied ${edit.applied}/${EDITS.length}  verify=${check.ok ? "PASS" : "FAIL: " + check.reason}`,
      );
      for (const e of EDITS) {
        const state = edit.unplaced.includes(e) ? "declined" : "applied";
        console.log(`          ${e.label.padEnd(16)} ${state}`);
      }
      if (!check.ok) anyCorrupt = true;
    }

    // The pipeline as the app calls it: must always return something usable.
    const result = await exportCv({
      format: "pdf",
      originalData: original,
      replacements: EDITS,
      fullText: "Morgan Whitfield\n\nSummary\nFallback body text.",
    });
    console.log(
      `          pipeline → ${result.reformatted ? `clean template (${result.reformatReason ?? "—"})` : "original design preserved"}, ${result.pdf.length} bytes`,
    );
    if (result.pdf.subarray(0, 5).toString() !== "%PDF-") {
      console.log("          !! pipeline returned a non-PDF");
      anyCorrupt = true;
    }
  }

  console.log(
    anyCorrupt
      ? "\nAt least one document failed verification — the fallback must cover it."
      : "\nEvery document either verified or fell back cleanly.",
  );
})();

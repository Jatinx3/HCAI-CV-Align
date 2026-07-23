/**
 * Manual verification of the three export paths (not part of the app).
 * Usage: npx tsx scripts/test-export.ts <samples-dir>
 * The samples dir must contain cv.tex, cv.docx and cv.txt.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { replaceTexSpans, compileTex } from "../src/lib/export/tex";
import { applyDocxReplacements, docxToPdf } from "../src/lib/export/docx";
import { renderCleanPdf } from "../src/lib/export/pdf";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npx tsx scripts/test-export.ts <samples-dir>");
  process.exit(1);
}

const OLD = "Built ETL pipelines processing 2TB daily";
const NEW = "Engineered ETL pipelines handling 2TB of data every day";
const REPLACEMENTS = [
  { original: OLD, replacement: NEW },
  // Deliberately unplaceable, to prove failures are reported not swallowed.
  { original: "this text does not exist anywhere", replacement: "x" },
];

async function main() {
  // 1. .tex — splice into untouched source, recompile.
  const tex = readFileSync(join(dir, "cv.tex"), "utf-8");
  const spliced = replaceTexSpans(tex, REPLACEMENTS);
  const texPdf = await compileTex(spliced.source);
  const texText = (await pdfParse(texPdf)).text;
  console.log(
    `tex   applied=${spliced.applied.length} unplaced=${spliced.unplaced.length}` +
      ` bytes=${texPdf.length} newText=${texText.includes("Engineered ETL")}` +
      ` structureKept=${texText.includes("Jane Doe")}`,
  );
  writeFileSync(join(dir, "out-tex.pdf"), texPdf);

  // 2. .docx — rewrite runs in place, convert via LibreOffice.
  const docx = readFileSync(join(dir, "cv.docx"));
  const dres = await applyDocxReplacements(docx, REPLACEMENTS);
  const docxPdf = await docxToPdf(dres.data);
  const docxText = (await pdfParse(docxPdf)).text;
  console.log(
    `docx  applied=${dres.applied.length} unplaced=${dres.unplaced.length}` +
      ` bytes=${docxPdf.length} newText=${docxText.includes("Engineered ETL")}` +
      ` restKept=${docxText.includes("BSc Computer Science")}`,
  );
  writeFileSync(join(dir, "out-docx.pdf"), docxPdf);

  // 3. .pdf — render rewritten text into the clean template.
  const extracted = readFileSync(join(dir, "cv.txt"), "utf-8").replace(
    OLD,
    NEW,
  );
  const cleanPdf = await renderCleanPdf(extracted);
  const cleanText = (await pdfParse(cleanPdf)).text;
  console.log(
    `pdf   bytes=${cleanPdf.length} newText=${cleanText.includes("Engineered ETL")}` +
      ` nameTitle=${cleanText.includes("Jane Doe")}` +
      ` headings=${cleanText.includes("Experience")}`,
  );
  writeFileSync(join(dir, "out-clean.pdf"), cleanPdf);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});

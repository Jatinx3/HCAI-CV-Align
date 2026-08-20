const Module = require("module") as { _resolveFilename: (r: string, ...a: unknown[]) => string };
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return require.resolve("./_so3.js");
  return resolve.call(this, request, ...args);
};

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const { extractText, detectFormat } = require("../src/lib/extract");
const { parseSections, rewritableSections } = require("../src/lib/sections");
const { buildSystemPrompt, buildUserPrompt, validateSuggestions, extractJson } = require("../src/lib/suggestions");
const { complete, activeModel } = require("../src/lib/llm");
const { exportCv } = require("../src/lib/export");
const { applyReplacement } = require("../src/lib/anchor");
const { assembleCv } = require("../src/lib/sections");

const D = "/private/tmp/claude-501/-Users-jatin-Developer-cv-app/043bb58e-5d87-4c18-bc02-20475664f5b6/scratchpad/pilot";
const JD = `Senior Backend Engineer. Design and operate Python services on AWS, own
data pipelines, and work with retrieval and LLM tooling. We value observability,
testing discipline and clear technical writing. Kubernetes desirable.`;

async function main() {
  const prisma = new PrismaClient();
  console.log(`model: ${activeModel()}\n`);

  for (const [n, file] of [["pilot01", "cv.pdf"], ["pilot02", "cv.docx"], ["pilot03", "cv.tex"]] as const) {
    const bytes = readFileSync(`${D}/${file}`);
    const format = detectFormat(file, bytes);
    const t0 = Date.now();
    const text = await extractText(format, bytes);
    const sections = parseSections(text);
    const targets = rewritableSections(sections);
    console.log(`── ${file} (${format})  extracted ${text.split(/\s+/).filter(Boolean).length} words in ${Date.now() - t0}ms, ${targets.length} sections`);

    const user = await prisma.user.findUnique({ where: { email: `${n}@study.local` } });
    const doc = await prisma.cvDocument.create({ data: { userId: user!.id, fileName: file, format, data: bytes, extractedText: text } });
    const step = await prisma.modeStep.create({ data: { userId: user!.id, mode: "HUMAN_CENTERED", cvDocumentId: doc.id, cvFileName: file, cvFormat: format, jdText: JD } });

    // One section against the real model, timed.
    const section = targets.find((s: { kind: string }) => s.kind === "experience") ?? targets[0];
    const t1 = Date.now();
    let accepted: { original: string; replacement: string }[] = [];
    let shown = 0, dropped = 0;
    try {
      const raw = await complete({ system: buildSystemPrompt(3), user: buildUserPrompt(section, JD), timeoutMs: 240_000 });
      const outcome = validateSuggestions(extractJson(raw), section);
      shown = outcome.suggestions.length;
      dropped = outcome.rejected.length;
      if (outcome.suggestions[0]) accepted = [{ original: outcome.suggestions[0].original, replacement: outcome.suggestions[0].suggested }];
    } catch (err) {
      console.log(`   model call FAILED: ${(err as Error).message}`);
    }
    console.log(`   suggestions: ${shown} shown, ${dropped} discarded, in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

    const working = sections.map((s: { id: string; text: string }) => ({ ...s }));
    for (const a of accepted) {
      const target = working.find((w: { id: string }) => w.id === section.id);
      if (target) target.text = applyReplacement(target.text, a.original, a.replacement);
    }

    const t2 = Date.now();
    try {
      const res = await exportCv({ format, originalData: bytes, replacements: accepted, fullText: assembleCv(working) });
      await prisma.modeStep.update({ where: { id: step.id }, data: { endedAt: new Date(), finalCvText: assembleCv(working) } });
      require("fs").writeFileSync(`${D}/out-${format}.pdf`, res.pdf);
      console.log(`   export: ${(res.pdf.length / 1024).toFixed(0)}KB in ${((Date.now() - t2) / 1000).toFixed(1)}s, reformatted=${res.reformatted}, unplaced=${res.unplaced.length}`);
    } catch (err) {
      console.log(`   export FAILED: ${(err as Error).message}`);
    }
    console.log(`   total ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }
  await prisma.$disconnect();
}
main();

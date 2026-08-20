/**
 * Strip identifying material from stored CVs once a session is over.
 *
 *   npm run pseudonymise -- --dry-run     # report what would change
 *   npm run pseudonymise                  # sessions that reached the handoff
 *   npm run pseudonymise -- --all         # every stored CV, finished or not
 *
 * What the study needs to keep is the structure of a CV and what the
 * participant did to it. What it does not need, once the session is over, is
 * the person's name, their contact details, or the original file.
 *
 * Two things happen to each document:
 *
 *   - The header block — the name and contact line a résumé opens with — is
 *     replaced in the extracted text with a placeholder. Section parsing
 *     already treats that block as its own unit and neither rewrite mode sends
 *     it to the model, so removing it costs the analysis nothing.
 *   - The original bytes are dropped. They exist for the format-preserving
 *     export, which has already happened by the time a session is finished.
 *     This is the larger of the two: it is the file the participant uploaded,
 *     and it holds their name in a form no text substitution reaches.
 *
 * The key is the credentials sheet from `npm run provision:batch`, which maps a
 * participant to an account and is the researcher's to keep off this machine.
 * Nothing here can undo what it does, so it runs after the sessions, not
 * during them, and --dry-run shows the damage before it is done.
 */
import { PrismaClient } from "@prisma/client";
import { parseSections } from "../src/lib/sections";

const prisma = new PrismaClient();

const PLACEHOLDER = "[name and contact details removed]";

function withoutHeader(text: string): { text: string; removed: number } {
  const sections = parseSections(text);
  const header = sections.find((s) => s.kind === "header");
  if (!header?.text.trim()) return { text, removed: 0 };
  const at = text.indexOf(header.text);
  if (at === -1) return { text, removed: 0 };
  return {
    text: text.slice(0, at) + PLACEHOLDER + text.slice(at + header.text.length),
    removed: header.text.length,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const all = process.argv.includes("--all");

  const documents = await prisma.cvDocument.findMany({
    include: { modeSteps: { include: { studySession: true } } },
  });

  let changed = 0;
  let bytesDropped = 0;
  let skipped = 0;

  for (const doc of documents) {
    const finished = doc.modeSteps.some(
      (s) => s.studySession?.feedbackHandoffReachedAt,
    );
    if (!all && !finished) {
      skipped += 1;
      continue;
    }
    if (doc.extractedText.startsWith(PLACEHOLDER)) continue;

    const { text, removed } = withoutHeader(doc.extractedText);
    const size = doc.data.length;
    console.log(
      `${doc.id}  ${doc.fileName.padEnd(28)} header -${removed} chars, file -${size} bytes`,
    );
    if (!dryRun) {
      await prisma.cvDocument.update({
        where: { id: doc.id },
        data: { extractedText: text, data: Buffer.alloc(0) },
      });
    }
    changed += 1;
    bytesDropped += size;
  }

  console.log(
    `\n${dryRun ? "Would change" : "Changed"} ${changed} document(s), dropping ${(bytesDropped / 1024).toFixed(0)} KB of original files.`,
  );
  if (skipped) {
    console.log(
      `Left alone: ${skipped} document(s) whose session has not reached the feedback handoff. Use --all to include them.`,
    );
  }
  if (dryRun) console.log("Nothing was written. Drop --dry-run to apply.");
  else if (changed) {
    console.log(
      "The exported CVs can no longer be rebuilt from these records. The final text of each run is still on its mode step.",
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

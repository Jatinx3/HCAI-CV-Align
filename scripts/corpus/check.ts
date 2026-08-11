/**
 * Generate the corpus and assert the pipeline recovers what went into it.
 *
 *   npx tsx scripts/corpus/check.ts          # run every template
 *   npx tsx scripts/corpus/check.ts jakes    # one template
 *
 * Because every PDF is rendered from `CV`, the correct answer is known: the
 * name, the section headings, every title/date row, and every bullet. A
 * template passes when extraction recovers all of them. This is coverage
 * without having to find real CVs in every style — and it is what would have
 * caught the extraction failures found by hand.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CV, allBullets, allEntryRows } from "./content";
import { TEMPLATES } from "./templates";
import { extractText } from "../../src/lib/extract";
import { layoutCv, unwrapLines } from "../../src/lib/cv-layout";

const run = promisify(execFile);
const OUT = new URL("./out/", import.meta.url).pathname;

/** Compare ignoring whitespace and the dash characters templates vary on. */
const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[–—-]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function buildPdf(name: string, tex: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), `corpus-${name}-`));
  writeFileSync(join(dir, "cv.tex"), tex, "utf-8");
  await run("tectonic", ["-o", dir, "--chatter", "minimal", join(dir, "cv.tex")], {
    timeout: 120_000,
  });
  return readFileSync(join(dir, "cv.pdf"));
}

type Result = { template: string; failures: string[]; stats: string };

async function checkTemplate(name: string): Promise<Result> {
  const failures: string[] = [];
  const pdf = await buildPdf(name, TEMPLATES[name](CV));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.pdf`), pdf);

  const extracted = await extractText("pdf", pdf);
  const doc = layoutCv(extracted);
  const flat = key(
    [
      doc.name,
      doc.subtitle ?? "",
      ...doc.contact,
      ...doc.blocks.flatMap((b) =>
        b.kind === "list"
          ? b.items
          : b.kind === "entry"
            ? [b.left, b.right]
            : [b.text],
      ),
    ].join(" \n "),
  );

  if (key(doc.name) !== key(CV.name)) {
    failures.push(`name: expected "${CV.name}", got "${doc.name}"`);
  }

  // Every section heading must be recognised as a heading, not body text.
  const headings = doc.blocks
    .filter((b) => b.kind === "heading")
    .map((b) => key((b as { text: string }).text));
  for (const s of CV.sections) {
    if (!headings.includes(key(s.heading))) {
      failures.push(`heading missing: "${s.heading}"`);
    }
  }

  // Every title/date row must come back as a two-column entry, not glued text.
  const entries = doc.blocks.filter((b) => b.kind === "entry") as {
    left: string;
    right: string;
    stacked: boolean;
  }[];
  for (const row of allEntryRows()) {
    const match = entries.find(
      (e) => key(e.left) === key(row.left) && key(e.right) === key(row.right),
    );
    if (!match) {
      failures.push(`entry not split: "${row.left}" / "${row.right}"`);
      continue;
    }
    // A technology stack must go below its title in every template, whatever
    // its length; a date must stay opposite its own.
    if (Boolean(row.stack) !== match.stacked) {
      failures.push(
        `stacked=${match.stacked} for "${row.left}" / "${row.right}" (expected ${Boolean(row.stack)})`,
      );
    }
  }

  // Every bullet must survive as a bullet.
  const bulletText = doc.blocks
    .filter((b) => b.kind === "list")
    .flatMap((b) => (b as { items: string[] }).items)
    .map(key);
  for (const b of allBullets()) {
    if (!bulletText.some((x) => x === key(b))) {
      failures.push(`bullet lost or mangled: "${b.slice(0, 48)}…"`);
    }
  }

  /**
   * An accepted suggestion must not change the structure of the document.
   *
   * A bullet wrapped by the page arrives as two lines, and the second one is
   * rejoined partly on the evidence that it starts lowercase. A suggestion
   * that rewrites that fragment will often capitalise it — it reads as a
   * sentence — which used to break the bullet in two and leave the second half
   * unmarked in the export. Capitalising every continuation line simulates the
   * worst case; the same bullets must come back.
   */
  const lines = extracted.split("\n");
  const capitalised = lines
    .map((l, i) => {
      // A line continuing a word the typesetter hyphenated ("…200 mil-" /
      // "liseconds.") is not something a suggestion can rewrite: the model
      // quotes text from the CV, and "liseconds." is not a word in it.
      const midWord = /-$/.test(lines[i - 1] ?? "");
      return !midWord && /^[a-z]/.test(l) ? l[0].toUpperCase() + l.slice(1) : l;
    })
    .join("\n");
  const afterEdit = layoutCv(capitalised)
    .blocks.filter((b) => b.kind === "list")
    .flatMap((b) => (b as { items: string[] }).items)
    .map(key);
  for (const b of allBullets()) {
    if (!afterEdit.some((x) => x === key(b))) {
      failures.push(`bullet split by an accepted edit: "${b.slice(0, 44)}…"`);
    }
  }

  // Nothing may vanish entirely: every skills value must appear somewhere.
  for (const s of CV.sections)
    for (const l of s.labelled ?? []) {
      if (!flat.includes(key(l.value))) {
        failures.push(`skills value missing: "${l.label}"`);
      }
    }

  const counts = doc.blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.kind] = (acc[b.kind] ?? 0) + 1;
    return acc;
  }, {});
  return {
    template: name,
    failures,
    stats: `headings=${counts.heading ?? 0} entries=${counts.entry ?? 0} lists=${counts.list ?? 0} paras=${counts.paragraph ?? 0}`,
  };
}

/**
 * Line-joining cases the generated PDFs cannot be made to produce on demand.
 *
 * Where a template breaks a line depends on its measure, so a corpus of whole
 * documents cannot guarantee that a wrap lands on the word a rule is about.
 * These are the wraps that have actually broken a real CV, written directly as
 * the two lines extraction produced.
 */
function checkLayoutRules(): Result {
  const failures: string[] = [];

  const cases: { name: string; lines: string[]; expect: number }[] = [
    {
      // An acronym at the start of a continuation line is shape-identical to a
      // section heading; it was promoted to one and printed as "Rbac.".
      name: "acronym after a dangling conjunction",
      lines: [
        "• Designed and deployed a production Next.js/PostgreSQL SaaS platform with active users, real-time messaging, and",
        "RBAC.",
      ],
      expect: 1,
    },
    {
      // A semicolon is a clause break inside a bullet, and the fragment after
      // it may have been capitalised by an accepted suggestion.
      name: "capitalised fragment after a semicolon",
      lines: [
        "• Built a Python FastAPI backend, cutting query latency by 60%;",
        "Rolled out on Hugging Face Spaces with sub-200ms p95 response times.",
      ],
      expect: 1,
    },
    {
      // The safety net: an unpunctuated line before a real section heading.
      name: "genuine heading after an unpunctuated line",
      lines: ["Tools: GitHub, Postman, JIRA", "PROJECTS"],
      expect: 2,
    },
    {
      // A trailing comma must not swallow the section that follows it.
      name: "genuine heading after a trailing comma",
      lines: ["Languages: Python, Go,", "Education"],
      expect: 2,
    },
  ];

  for (const c of cases) {
    const got = unwrapLines(c.lines).length;
    if (got !== c.expect) {
      failures.push(`${c.name}: ${got} line(s), expected ${c.expect}`);
    }
  }

  return {
    template: "line joining",
    failures,
    stats: `${cases.length} cases`,
  };
}

(async () => {
  const only = process.argv[2];
  const names = only ? [only] : Object.keys(TEMPLATES);
  const results: Result[] = [only ? null : checkLayoutRules()].filter(
    (r): r is Result => r !== null,
  );

  for (const name of names) {
    try {
      results.push(await checkTemplate(name));
    } catch (err) {
      results.push({
        template: name,
        failures: [`build/extract threw: ${(err as Error).message.slice(0, 120)}`],
        stats: "—",
      });
    }
  }

  let failed = 0;
  for (const r of results) {
    const ok = r.failures.length === 0;
    if (!ok) failed++;
    console.log(`\n${ok ? "PASS" : "FAIL"}  ${r.template.padEnd(9)} ${r.stats}`);
    for (const f of r.failures.slice(0, 8)) console.log(`        ${f}`);
    if (r.failures.length > 8)
      console.log(`        …and ${r.failures.length - 8} more`);
  }
  console.log(
    `\n${results.length - failed}/${results.length} templates pass. PDFs in scripts/corpus/out/`,
  );
  process.exit(failed > 0 ? 1 : 0);
})();

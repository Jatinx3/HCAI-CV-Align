/**
 * Provision a cohort of participant accounts in one go.
 *
 * Usage:
 *   npm run provision:batch -- --count 20
 *   npm run provision:batch -- --count 20 --prefix pilot --domain study.local
 *   npm run provision:batch -- --count 5 --start 21          # add to a cohort
 *   npm run provision:batch -- --count 20 --out credentials.csv
 *
 * Every account is a study participant, so each one gets a guided session with
 * a counterbalanced order. Passwords are generated, printed once, and stored
 * only as hashes — there is no way to recover one afterwards, so keep what this
 * prints.
 *
 * Existing accounts are left alone rather than reset. Re-running after a
 * participant has started would otherwise invalidate the credentials they were
 * given halfway through a session, and would say nothing about which of the two
 * it had happened to.
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomInt } from "node:crypto";

const prisma = new PrismaClient();

/**
 * Passwords a participant has to type from a printed sheet, once, under mild
 * time pressure. Ambiguous characters are left out — no 0/O, 1/l/I — because
 * the cost of a mistyped password here is a confused participant and a minute
 * of a researcher's attention, not a security incident.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function password(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function parseArgs(argv: string[]) {
  const args = {
    count: 20,
    start: 1,
    prefix: "p",
    domain: "study.local",
    out: null as string | null,
  };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--count") args.count = Number(next);
    else if (argv[i] === "--start") args.start = Number(next);
    else if (argv[i] === "--prefix") args.prefix = next;
    else if (argv[i] === "--domain") args.domain = next;
    else if (argv[i] === "--out") args.out = next;
  }
  return args;
}

async function main() {
  const { count, start, prefix, domain, out } = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    console.error("--count must be a whole number between 1 and 200");
    process.exit(1);
  }

  const created: { email: string; password: string }[] = [];
  const skipped: string[] = [];

  for (let n = start; n < start + count; n++) {
    // Zero-padded so a sorted list of twenty stays in order.
    const email =
      `${prefix}${String(n).padStart(2, "0")}@${domain}`.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      skipped.push(email);
      continue;
    }
    const plain = password();
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hash(plain, 12),
        studyParticipant: true,
      },
    });
    created.push({ email, password: plain });
  }

  if (created.length) {
    const width = Math.max(...created.map((c) => c.email.length));
    console.log(`\nProvisioned ${created.length} participant account(s):\n`);
    for (const c of created) {
      console.log(`  ${c.email.padEnd(width)}   ${c.password}`);
    }
  }
  if (skipped.length) {
    console.log(
      `\nLeft alone (already exist): ${skipped.join(", ")}`,
    );
    console.log(
      "Delete an account to reissue it, or use --start to continue the series.",
    );
  }

  if (out && created.length) {
    writeFileSync(
      out,
      ["email,password", ...created.map((c) => `${c.email},${c.password}`)].join(
        "\n",
      ) + "\n",
      "utf-8",
    );
    console.log(`\nWritten to ${out}`);
    console.log(
      "That file holds working credentials in plain text. Keep it off the repository and destroy it once the sessions are done.",
    );
  }

  console.log(
    "\nPasswords are shown once. Only their hashes are stored, so nothing here can be recovered later.",
  );

  const participants = await prisma.user.count({
    where: { studyParticipant: true },
  });
  console.log(`Participant accounts now in the database: ${participants}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

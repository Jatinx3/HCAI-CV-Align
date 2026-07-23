/**
 * Researcher account provisioning.
 *
 * Usage:
 *   npm run provision -- --email participant1@study.local --participant
 *   npm run provision -- --email general@example.com
 *   npm run provision -- --email p2@study.local --participant --password chosen-pass
 *
 * Prints the generated password once — record it; only the hash is stored.
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const args: { email?: string; password?: string; participant: boolean } = {
    participant: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--password") args.password = argv[++i];
    else if (argv[i] === "--participant") args.participant = true;
  }
  return args;
}

async function main() {
  const { email, password, participant } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error(
      "Usage: npm run provision -- --email <email> [--participant] [--password <password>]",
    );
    process.exit(1);
  }

  const normalized = email.toLowerCase().trim();
  const plain = password ?? randomBytes(9).toString("base64url");
  const passwordHash = await hash(plain, 12);

  const user = await prisma.user.upsert({
    where: { email: normalized },
    create: { email: normalized, passwordHash, studyParticipant: participant },
    update: { passwordHash, studyParticipant: participant },
  });

  console.log("Account provisioned:");
  console.log(`  email:            ${user.email}`);
  console.log(`  studyParticipant: ${user.studyParticipant}`);
  console.log(`  password:         ${plain}`);
  console.log("(Password shown once — store it now.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Build the sheet handed to participants: login, password, and the code the
 * feedback form asks for.
 *
 *   npm run sheet -- --credentials credentials.csv --out participants.csv
 *
 * The code is the tail of the study session id, and a session is normally
 * created the first time somebody signs in — which means the code does not
 * exist until they arrive, and cannot be printed on the slip they are given.
 * This opens each participant's session ahead of time so the code can travel
 * with the login. The app finds the waiting session rather than making a new
 * one, so the code shown on screen at the end is the same code.
 *
 * Passwords are not recoverable from the database; only their hashes are
 * stored. They come from the CSV that provision-batch printed once, and this
 * script only joins the two together.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { participantCode } from "../src/lib/study-shared";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Keep the two arms level as sessions are opened, the same rule the app uses. */
async function suggestOrder(): Promise<string> {
  const [oneClickFirst, humanFirst] = await Promise.all([
    prisma.studySession.count({ where: { assignedOrder: "ONE_CLICK_FIRST" } }),
    prisma.studySession.count({ where: { assignedOrder: "HUMAN_CENTERED_FIRST" } }),
  ]);
  if (oneClickFirst < humanFirst) return "ONE_CLICK_FIRST";
  if (humanFirst < oneClickFirst) return "HUMAN_CENTERED_FIRST";
  return Math.random() < 0.5 ? "ONE_CLICK_FIRST" : "HUMAN_CENTERED_FIRST";
}

async function main() {
  const credentialsPath = arg("credentials");
  const outPath = arg("out") ?? "participants.csv";

  const passwords = new Map<string, string>();
  if (credentialsPath) {
    const rows = readFileSync(credentialsPath, "utf-8").trim().split("\n").slice(1);
    for (const row of rows) {
      const [email, password] = row.split(",");
      if (email && password) passwords.set(email.trim(), password.trim());
    }
  }

  const users = await prisma.user.findMany({
    where: { studyParticipant: true },
    orderBy: { email: "asc" },
  });

  const out: string[] = ["email,password,participant_code"];
  let opened = 0;

  for (const user of users) {
    let session = await prisma.studySession.findFirst({
      where: { userId: user.id, completedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (!session) {
      session = await prisma.studySession.create({
        data: { userId: user.id, assignedOrder: await suggestOrder() },
      });
      opened += 1;
    }
    const code = participantCode(session.id);
    const password = passwords.get(user.email) ?? "";
    out.push(`${user.email},${password},${code}`);
    console.log(`  ${user.email.padEnd(22)} ${password.padEnd(13)} ${code}`);
  }

  writeFileSync(outPath, out.join("\n") + "\n", "utf-8");
  console.log(
    `\n${users.length} participants, ${opened} session${opened === 1 ? "" : "s"} opened.`,
  );
  console.log(`Written to ${outPath}`);
  if (!credentialsPath) {
    console.log(
      "No --credentials given, so the password column is empty. Passwords exist" +
        " only in the file provision-batch printed; they cannot be read back.",
    );
  }
  console.log(
    "\nThis file holds working logins in plain text. Keep it off the repository" +
      " and destroy it once the sessions are done.",
  );
}

main().finally(() => prisma.$disconnect());

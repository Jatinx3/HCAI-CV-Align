/**
 * Export the study data as CSV, keyed so it joins to the feedback form.
 *
 *   npm run export-study            # writes to ./study-export/
 *   npm run export-study -- --out /path/to/dir
 *
 * Three files, one row per thing analysed:
 *
 *   sessions.csv  one row per participant — the code the form asks for, the
 *                 assigned order, whether the handoff was reached, the local
 *                 preference backup.
 *   steps.csv     one row per mode step — which CV and which JD, time on task,
 *                 time to first action, how the export turned out.
 *   events.csv    one row per recorded action.
 *
 * `participant_code` is the join key: the same value the participant enters in
 * Microsoft Forms. Download the form's responses as a spreadsheet and match on
 * that column.
 *
 * The exported CV text is deliberately not included. It is the participant's
 * document, it is already in the database if it is needed, and a CSV of CVs is
 * a file that gets emailed around.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { participantCode } from "../src/lib/study-shared";

const prisma = new PrismaClient();

function csv(rows: Record<string, string | number | null>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => cell(r[c] ?? null)).join(",")),
  ].join("\n");
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const outDir = outIndex > -1 ? process.argv[outIndex + 1] : "study-export";
  mkdirSync(outDir, { recursive: true });

  const sessions = await prisma.studySession.findMany({
    include: { modeSteps: { orderBy: { startedAt: "asc" } } },
    orderBy: { startedAt: "asc" },
  });

  const sessionRows = sessions.map((s) => ({
    participant_code: participantCode(s.id),
    session_id: s.id,
    account_id: s.userId,
    assigned_order: s.assignedOrder,
    started_at: iso(s.startedAt),
    handoff_reached_at: iso(s.feedbackHandoffReachedAt),
    local_preference: s.localPreference,
    steps_completed: s.modeSteps.filter((m) => m.endedAt).length,
  }));

  const stepRows = sessions.flatMap((s) =>
    s.modeSteps.map((m) => ({
      participant_code: participantCode(s.id),
      step_id: m.id,
      step_index: m.stepIndex,
      mode: m.mode,
      cv_file: m.cvFileName,
      cv_format: m.cvFormat,
      jd_chars: m.jdText?.length ?? 0,
      conservatism: m.conservatism,
      started_at: iso(m.startedAt),
      ended_at: iso(m.endedAt),
      time_on_task_ms: m.endedAt
        ? m.endedAt.getTime() - m.startedAt.getTime()
        : null,
      time_to_first_action_ms: m.timeToFirstActionMs,
      completed: m.endedAt ? 1 : 0,
    })),
  );

  const events = await prisma.telemetryEvent.findMany({
    orderBy: { createdAt: "asc" },
  });
  const codeFor = new Map(sessions.map((s) => [s.id, participantCode(s.id)]));
  const eventRows = events.map((e) => ({
    participant_code: e.studySessionId
      ? (codeFor.get(e.studySessionId) ?? "")
      : "",
    step_id: e.modeStepId,
    type: e.type,
    at: iso(e.createdAt),
    payload: e.payload,
  }));

  writeFileSync(join(outDir, "sessions.csv"), csv(sessionRows), "utf-8");
  writeFileSync(join(outDir, "steps.csv"), csv(stepRows), "utf-8");
  writeFileSync(join(outDir, "events.csv"), csv(eventRows), "utf-8");

  console.log(`Wrote to ${outDir}/`);
  console.log(`  sessions.csv  ${sessionRows.length} participants`);
  console.log(`  steps.csv     ${stepRows.length} mode steps`);
  console.log(`  events.csv    ${eventRows.length} events`);
  if (sessionRows.length) {
    const oneClickFirst = sessionRows.filter(
      (r) => r.assigned_order === "ONE_CLICK_FIRST",
    ).length;
    console.log(
      `\nCounterbalancing: ${oneClickFirst} one-click first, ${sessionRows.length - oneClickFirst} human-centered first`,
    );
    const reached = sessionRows.filter((r) => r.handoff_reached_at).length;
    console.log(`Reached the feedback handoff: ${reached}/${sessionRows.length}`);
  }
  await prisma.$disconnect();
}

main();

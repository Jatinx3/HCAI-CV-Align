import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { studyStepData } from "@/lib/study";
import { recordEvent } from "@/lib/telemetry";

export const runtime = "nodejs";

/**
 * POST /api/mode-step  { cvId, jdText, mode }
 *
 * Records the start of a rewrite attempt: which CV, which JD, which mode.
 * The study explicitly may pair one CV with two different JDs, so the JD is
 * recorded per step rather than on the CV.
 */
export async function POST(request: Request) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }
  const user = authed.user;

  let body: { cvId?: string; jdText?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cvId, jdText, mode } = body;
  if (!cvId || !jdText?.trim()) {
    return NextResponse.json(
      { error: "cvId and jdText are required." },
      { status: 400 },
    );
  }
  if (mode !== "HUMAN_CENTERED" && mode !== "ONE_CLICK") {
    return NextResponse.json(
      { error: "mode must be HUMAN_CENTERED or ONE_CLICK." },
      { status: 400 },
    );
  }

  const doc = await prisma.cvDocument.findFirst({
    where: { id: cvId, userId: user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "CV not found" }, { status: 404 });
  }

  // For a study participant the step belongs to the guided session and must be
  // the mode assigned for it; the assignment is not the participant's to make.
  const study = await studyStepData(user.id, user.studyParticipant);
  if (!study.ok) {
    return NextResponse.json({ error: study.error }, { status: 409 });
  }

  const step = await prisma.modeStep.create({
    data: {
      userId: user.id,
      mode,
      cvDocumentId: doc.id,
      cvFileName: doc.fileName,
      cvFormat: doc.format,
      jdText,
      ...(study.data ?? {}),
    },
  });

  await recordEvent({
    userId: user.id,
    type: "mode_started",
    modeStepId: step.id,
    studySessionId: step.studySessionId,
    payload: { mode, format: doc.format, jdChars: jdText.length },
  });

  return NextResponse.json({ id: step.id });
}

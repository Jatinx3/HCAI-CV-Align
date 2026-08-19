import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  isClientEventType,
  markFirstAction,
  recordEvent,
  type EventPayload,
} from "@/lib/telemetry";

export const runtime = "nodejs";

/**
 * POST /api/telemetry  { stepId, type, payload? }
 *
 * The browser reports what the participant did; everything else about the
 * event is established here. The step must belong to the caller, the type must
 * be one a client is allowed to report, and the payload is reduced to scalars,
 * so a page cannot write arbitrary content into the research record.
 */
export async function POST(request: Request) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }

  let body: { stepId?: string; type?: string; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isClientEventType(body.type)) {
    return NextResponse.json({ error: "Unknown event type" }, { status: 400 });
  }

  const step = await prisma.modeStep.findFirst({
    where: { id: body.stepId, userId: authed.user.id },
    select: { id: true, studySessionId: true },
  });
  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  // Scalars only, and a fixed number of them: identifiers, counts, flags.
  const payload: EventPayload = {};
  if (body.payload && typeof body.payload === "object") {
    for (const [key, value] of Object.entries(body.payload).slice(0, 8)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        payload[key.slice(0, 40)] =
          typeof value === "string" ? value.slice(0, 120) : value;
      }
    }
  }

  await recordEvent({
    userId: authed.user.id,
    type: body.type,
    modeStepId: step.id,
    studySessionId: step.studySessionId,
    payload,
  });
  await markFirstAction(step.id, body.type);

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/study/preference  { sessionId, preference }
 *
 * The local backup of the forced-choice preference. Writable only by the
 * participant whose session it is, and only for one of the two modes.
 */
export async function POST(request: Request) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }

  let body: { sessionId?: string; preference?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, preference } = body;
  if (preference !== "ONE_CLICK" && preference !== "HUMAN_CENTERED") {
    return NextResponse.json(
      { error: "preference must be ONE_CLICK or HUMAN_CENTERED." },
      { status: 400 },
    );
  }

  const session = await prisma.studySession.findFirst({
    where: { id: sessionId, userId: authed.user.id },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await prisma.studySession.update({
    where: { id: session.id },
    data: { localPreference: preference },
  });

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * POST /api/mode-step  { cvId, jdText, mode }
 *
 * Records the start of a rewrite attempt: which CV, which JD, which mode.
 * The study explicitly may pair one CV with two different JDs, so the JD is
 * recorded per step rather than on the CV.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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
    where: { id: cvId, userId: session.user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "CV not found" }, { status: 404 });
  }

  const step = await prisma.modeStep.create({
    data: {
      userId: session.user.id,
      mode,
      cvDocumentId: doc.id,
      cvFileName: doc.fileName,
      cvFormat: doc.format,
      jdText,
    },
  });

  return NextResponse.json({ id: step.id });
}

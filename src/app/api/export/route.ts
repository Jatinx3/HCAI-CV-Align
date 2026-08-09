import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { exportCv, type SpanReplacement } from "@/lib/export";
import type { CvFormat } from "@/lib/extract";

export const runtime = "nodejs";

/**
 * POST /api/export
 * { cvId, replacements?, fullText?, stepId?, conservatism? }
 *
 * Exports the CV as PDF through the per-format pipeline. `replacements` are
 * accepted plain-text edits (tex/docx splicing); `fullText` is the complete
 * rewritten text (pdf template path; defaults to the stored extracted text).
 * Un-placeable edits are reported in the X-Unplaced-Count header and the
 * caller should surface them.
 *
 * When `stepId` is given, exporting also closes that ModeStep: it records the
 * end timestamp, the CV text the participant actually left with, and the
 * conservatism level in effect. Without this the human-centered arm would have
 * no completion record at all, and its time-on-task could not be measured —
 * the one-click route already closes its own step inline.
 */
export async function POST(request: Request) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }
  const user = authed.user;

  let body: {
    cvId?: string;
    replacements?: SpanReplacement[];
    fullText?: string;
    stepId?: string;
    conservatism?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.cvId) {
    return NextResponse.json({ error: "cvId is required" }, { status: 400 });
  }

  const doc = await prisma.cvDocument.findFirst({
    where: { id: body.cvId, userId: user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "CV not found" }, { status: 404 });
  }

  try {
    const result = await exportCv({
      format: doc.format as CvFormat,
      originalData: Buffer.from(doc.data),
      replacements: body.replacements ?? [],
      fullText: body.fullText ?? doc.extractedText,
    });

    // Close the step the export belongs to. Scoped by userId so one account
    // cannot close another's step.
    if (body.stepId) {
      await prisma.modeStep.updateMany({
        where: { id: body.stepId, userId: user.id },
        data: {
          endedAt: new Date(),
          finalCvText: body.fullText ?? doc.extractedText,
          ...(typeof body.conservatism === "number"
            ? { conservatism: body.conservatism }
            : {}),
        },
      });
    }

    const baseName = doc.fileName.replace(/\.[^.]+$/, "");
    return new NextResponse(new Uint8Array(result.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}-aligned.pdf"`,
        "X-Reformatted": String(result.reformatted),
        "X-Unplaced-Count": String(result.unplaced.length),
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Export failed unexpectedly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { studyStepData } from "@/lib/study";
import { exportCv } from "@/lib/export";
import type { CvFormat } from "@/lib/extract";
import {
  buildOneClickSystemPrompt,
  buildOneClickUserPrompt,
  deriveLineReplacements,
} from "@/lib/one-click";
import { complete, LlmConfigError, LlmCallError } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/one-click  { cvId, jdText }
 *
 * The thin baseline. One model call rewrites the whole CV; the result is
 * exported through the same per-format pipeline as human-centered mode. No
 * suggestions, no per-change control, no authenticity constraints. Records a
 * ModeStep (mode ONE_CLICK) with the final rewritten text. Returns the PDF.
 */
export async function POST(request: Request) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }
  const user = authed.user;

  let body: { cvId?: string; jdText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { cvId, jdText } = body;
  if (!cvId || !jdText?.trim()) {
    return NextResponse.json(
      { error: "cvId and jdText are required." },
      { status: 400 },
    );
  }

  const doc = await prisma.cvDocument.findFirst({
    where: { id: cvId, userId: user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "CV not found" }, { status: 404 });
  }

  const study = await studyStepData(user.id, user.studyParticipant, "ONE_CLICK");
  if (!study.ok) {
    return NextResponse.json({ error: study.error }, { status: 409 });
  }

  const step = await prisma.modeStep.create({
    data: {
      userId: user.id,
      mode: "ONE_CLICK",
      cvDocumentId: doc.id,
      cvFileName: doc.fileName,
      cvFormat: doc.format,
      jdText,
      ...(study.data ?? {}),
    },
  });

  let rewritten: string;
  try {
    rewritten = await complete({
      system: buildOneClickSystemPrompt(),
      user: buildOneClickUserPrompt(doc.extractedText, jdText),
      // A whole CV in one request, against a free-tier model. The route allows
      // 300s; leave headroom so the export still has time to run.
      timeoutMs: 240_000,
    });
  } catch (err) {
    if (err instanceof LlmConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message =
      err instanceof LlmCallError
        ? err.message
        : "Could not generate the rewrite.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const format = doc.format as CvFormat;
  try {
    const result = await exportCv({
      format,
      originalData: Buffer.from(doc.data),
      // tex/docx splice line-aligned edits; pdf renders the full rewrite.
      replacements:
        format === "pdf"
          ? []
          : deriveLineReplacements(doc.extractedText, rewritten),
      fullText: rewritten,
    });

    await prisma.modeStep.update({
      where: { id: step.id },
      data: { endedAt: new Date(), finalCvText: rewritten },
    });

    const baseName = doc.fileName.replace(/\.[^.]+$/, "");
    return new NextResponse(new Uint8Array(result.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}-rewritten.pdf"`,
        "X-Reformatted": String(result.reformatted),
        "X-Unplaced-Count": String(result.unplaced.length),
        "X-Mode-Step": step.id,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Export failed unexpectedly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

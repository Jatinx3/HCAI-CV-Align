import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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
    where: { id: cvId, userId: session.user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "CV not found" }, { status: 404 });
  }

  const step = await prisma.modeStep.create({
    data: {
      userId: session.user.id,
      mode: "ONE_CLICK",
      cvDocumentId: doc.id,
      cvFileName: doc.fileName,
      cvFormat: doc.format,
      jdText,
    },
  });

  let rewritten: string;
  try {
    rewritten = await complete({
      system: buildOneClickSystemPrompt(),
      user: buildOneClickUserPrompt(doc.extractedText, jdText),
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

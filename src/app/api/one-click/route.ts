import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { studyStepData } from "@/lib/study";
import { recordEvent } from "@/lib/telemetry";
import { exportCv } from "@/lib/export";
import type { CvFormat } from "@/lib/extract";
import { assembleCv, parseSections, rewritableSections } from "@/lib/sections";
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

  const study = await studyStepData(user.id, user.studyParticipant);
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

  await recordEvent({
    userId: user.id,
    type: "mode_started",
    modeStepId: step.id,
    studySessionId: step.studySessionId,
    payload: { mode: "ONE_CLICK", format: doc.format, jdChars: jdText.length },
  });

  /**
   * The contact block never goes to the model.
   *
   * The review mode has always excluded it, and the baseline sending the whole
   * document was an accident of being one call rather than a design decision.
   * It is not a hypothetical difference: asked to rewrite the document, the
   * model changed the applicant's email address to one that was not theirs,
   * which the applicant would have had no opportunity to notice. Thinness in
   * the baseline is about what it lets the user decide, not about exposing
   * their contact details to a rewrite.
   */
  const sections = parseSections(doc.extractedText);
  const header = sections.find((s) => s.kind === "header");
  const cvBody = assembleCv(rewritableSections(sections));

  let rewritten: string;
  try {
    const rewrittenBody = await complete({
      system: buildOneClickSystemPrompt(),
      user: buildOneClickUserPrompt(cvBody, jdText),
      // A whole CV in one request, against a free-tier model. The route allows
      // 300s; leave headroom so the export still has time to run.
      timeoutMs: 240_000,
    });
    // The applicant's own contact block goes back exactly as they wrote it.
    rewritten = header?.text.trim()
      ? `${header.text.trim()}\n\n${rewrittenBody.trim()}`
      : rewrittenBody;
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
      /**
       * Line-aligned edits for every format, PDF included. The baseline is
       * deliberately thin in what it lets the applicant decide, not in what it
       * produces: both modes export through the same pipeline, so a difference
       * the study measures is a difference in the interaction model rather
       * than in how well the download survived.
       */
      replacements: deriveLineReplacements(doc.extractedText, rewritten),
      fullText: rewritten,
    });

    await prisma.modeStep.update({
      where: { id: step.id },
      data: { endedAt: new Date(), finalCvText: rewritten },
    });
    await recordEvent({
      userId: user.id,
      type: "mode_completed",
      modeStepId: step.id,
      studySessionId: step.studySessionId,
      payload: {
        mode: "ONE_CLICK",
        reformatted: result.reformatted,
        unplaced: result.unplaced.length,
      },
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

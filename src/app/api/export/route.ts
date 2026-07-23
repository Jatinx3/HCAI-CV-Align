import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exportCv, type SpanReplacement } from "@/lib/export";
import type { CvFormat } from "@/lib/extract";

export const runtime = "nodejs";

/**
 * POST /api/export
 * { cvId: string, replacements?: {original, replacement}[], fullText?: string }
 *
 * Exports the CV as PDF through the per-format pipeline. `replacements` are
 * accepted plain-text edits (tex/docx splicing); `fullText` is the complete
 * rewritten text (pdf template path; defaults to the stored extracted text).
 * Un-placeable edits are reported in the X-Unplaced-Count header and the
 * caller should surface them.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    cvId?: string;
    replacements?: SpanReplacement[];
    fullText?: string;
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
    where: { id: body.cvId, userId: session.user.id },
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

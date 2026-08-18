import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  tex: "text/plain; charset=utf-8",
};

/**
 * GET /api/cv/[id]/file — the uploaded document, exactly as it arrived.
 *
 * The verification screen shows what the assistant parsed, which is the thing
 * worth checking before any model runs. But a participant who uploads a PDF
 * and is shown a re-typeset reading view reasonably asks why it does not look
 * like their CV, so the original is served alongside it rather than described.
 *
 * Scoped to the owner: a document id is a cuid, not an authorisation.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }

  const { id } = await params;
  const doc = await prisma.cvDocument.findFirst({
    where: { id, userId: authed.user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "CV not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": CONTENT_TYPE[doc.format] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      // The participant's own document: never cached by a shared proxy.
      "Cache-Control": "private, no-store",
    },
  });
}

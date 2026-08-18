import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { detectFormat, extractText } from "@/lib/extract";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }
  const user = authed.user;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 10 MB)" },
      { status: 413 },
    );
  }

  const data = Buffer.from(await file.arrayBuffer());
  const format = detectFormat(file.name, data);
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a .pdf, .docx, or .tex CV." },
      { status: 415 },
    );
  }

  let extractedText: string;
  try {
    extractedText = await extractText(format, data);
  } catch {
    return NextResponse.json(
      { error: `Could not read this ${format} file. Is it valid?` },
      { status: 422 },
    );
  }

  if (!extractedText || extractedText.length < 20) {
    return NextResponse.json(
      {
        error:
          "No readable text found in this file (is it a scanned/image-only PDF?).",
      },
      { status: 422 },
    );
  }

  const doc = await prisma.cvDocument.create({
    data: {
      userId: user.id,
      fileName: file.name,
      format,
      data,
      extractedText,
    },
  });

  return NextResponse.json({
    id: doc.id,
    fileName: doc.fileName,
    format: doc.format,
    extractedText: doc.extractedText,
    /**
     * A PDF keeps its own design unless an accepted change cannot be made to
     * fit the lines it replaces, at which point the whole document is
     * re-typeset rather than left half original and half ours. Said in advance
     * because it is a real possibility, not a remote one — and it was a
     * certainty before in-place editing worked.
     */
    reformatNotice:
      format === "pdf"
        ? "Your PDF keeps its own design: changes are edited into the file itself. If a change cannot be made to fit the space it replaces, the whole CV is re-typeset into a clean template instead, and you will be told when that happens."
        : null,
  });
}

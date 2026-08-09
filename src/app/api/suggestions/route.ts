import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseSections, rewritableSections } from "@/lib/sections";
import {
  buildSystemPrompt,
  buildUserPrompt,
  extractJson,
  isConservatismLevel,
  validateGaps,
  validateSuggestions,
} from "@/lib/suggestions";
import { activeModel, complete, LlmConfigError, LlmCallError } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/suggestions  { cvId, jdText, conservatism }
 *
 * Human-centered mode. Each CV section is analysed against the JD
 * independently — never a monolithic rewrite. Suggestions that violate the
 * contract (no explanation, no JD requirement, quoted text absent, no actual
 * change) are dropped by the validator and never reach the user.
 *
 * Responds with a stream of newline-delimited JSON events rather than one
 * final payload, for two reasons. Sections are analysed one at a time, because
 * firing every section at once is exactly what free-tier providers rate-limit;
 * and a run takes minutes, so the participant needs to see which section is
 * being worked on instead of an opaque spinner.
 */
export async function POST(request: Request) {
  const authed = await requireUser();
  if (!authed.ok) {
    return NextResponse.json({ error: authed.error }, { status: authed.status });
  }
  const user = authed.user;

  let body: { cvId?: string; jdText?: string; conservatism?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cvId, jdText, conservatism } = body;
  if (!cvId) {
    return NextResponse.json({ error: "cvId is required" }, { status: 400 });
  }
  if (!jdText?.trim()) {
    return NextResponse.json(
      { error: "A job description is required." },
      { status: 400 },
    );
  }
  if (!isConservatismLevel(conservatism)) {
    return NextResponse.json(
      { error: "conservatism must be an integer from 1 to 5." },
      { status: 400 },
    );
  }

  const doc = await prisma.cvDocument.findFirst({
    where: { id: cvId, userId: user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "CV not found" }, { status: 404 });
  }

  const allSections = parseSections(doc.extractedText);
  const targets = rewritableSections(allSections);
  if (targets.length === 0) {
    return NextResponse.json(
      {
        error:
          "No rewritable sections were found in this CV. Check the extracted text.",
      },
      { status: 422 },
    );
  }

  const system = buildSystemPrompt(conservatism);
  const model = activeModel();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      let droppedInvalid = 0;
      const failures: { sectionId: string; reason: string }[] = [];

      send({
        type: "start",
        model,
        conservatism,
        total: targets.length,
        sections: allSections.map((s) => ({
          id: s.id,
          kind: s.kind,
          heading: s.heading,
        })),
      });

      for (let i = 0; i < targets.length; i++) {
        const section = targets[i];
        send({
          type: "progress",
          sectionId: section.id,
          heading: section.heading || section.kind,
          index: i,
          total: targets.length,
        });

        try {
          const raw = await complete({
            system,
            user: buildUserPrompt(section, jdText),
          });
          const parsed = extractJson(raw);
          const outcome = validateSuggestions(parsed, section);
          const gaps = validateGaps(parsed, section);
          droppedInvalid += outcome.rejected.length;

          send({
            type: "section",
            sectionId: section.id,
            suggestions: outcome.suggestions,
            gaps,
            dropped: outcome.rejected.length,
          });
        } catch (err) {
          if (err instanceof LlmConfigError) {
            // Misconfiguration affects every section — stop, don't grind
            // through the rest producing identical failures.
            send({ type: "fatal", error: err.message });
            controller.close();
            return;
          }
          const reason =
            err instanceof LlmCallError
              ? err.message
              : err instanceof Error && err.message.includes("JSON")
                ? "Model response was not valid JSON."
                : "Model call failed.";
          failures.push({ sectionId: section.id, reason });
          send({ type: "section_error", sectionId: section.id, reason });
        }
      }

      send({ type: "done", model, droppedInvalid, failures });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Proxies that buffer would defeat the point of streaming progress.
      "X-Accel-Buffering": "no",
    },
  });
}

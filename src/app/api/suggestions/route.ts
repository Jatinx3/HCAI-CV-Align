import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSections, rewritableSections } from "@/lib/sections";
import {
  buildSystemPrompt,
  buildUserPrompt,
  extractJson,
  isConservatismLevel,
  validateSuggestions,
  type Suggestion,
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
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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
    where: { id: cvId, userId: session.user.id },
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
  const suggestions: Suggestion[] = [];
  const failures: { sectionId: string; reason: string }[] = [];
  let droppedInvalid = 0;

  // Sections are analysed independently and in parallel; one failing section
  // must not lose the others.
  const results = await Promise.allSettled(
    targets.map(async (section) => {
      const raw = await complete({
        system,
        user: buildUserPrompt(section, jdText),
      });
      return { section, raw };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const section = targets[i];
    if (result.status === "rejected") {
      const err = result.reason;
      if (err instanceof LlmConfigError) {
        // Misconfiguration affects every section — fail loudly, not silently.
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      failures.push({
        sectionId: section.id,
        reason:
          err instanceof LlmCallError ? err.message : "Model call failed.",
      });
      continue;
    }
    try {
      const parsed = extractJson(result.value.raw);
      const outcome = validateSuggestions(parsed, section);
      suggestions.push(...outcome.suggestions);
      droppedInvalid += outcome.rejected.length;
    } catch {
      failures.push({
        sectionId: section.id,
        reason: "Model response was not valid JSON.",
      });
    }
  }

  if (suggestions.length === 0 && failures.length === targets.length) {
    return NextResponse.json(
      {
        error:
          failures[0]?.reason ??
          "Could not generate suggestions. Please try again.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    sections: allSections,
    suggestions,
    // Research transparency: report what was discarded rather than hiding it.
    droppedInvalid,
    failures,
    model: activeModel(),
    conservatism,
  });
}

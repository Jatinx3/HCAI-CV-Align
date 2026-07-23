import type { CvFormat } from "@/lib/extract";
import {
  compileTex,
  replaceTexSpans,
  type SpanReplacement,
  type TexSpliceResult,
} from "./tex";
import { applyDocxReplacements, docxToPdf } from "./docx";
import { renderCleanPdf } from "./pdf";

export type { SpanReplacement };

export type ExportResult = {
  pdf: Buffer;
  /** Accepted changes that could not be placed back into the original
      structure (tex/docx paths). Surfaced to the user, never silent. */
  unplaced: SpanReplacement[];
  /** True when the output is a re-laid-out clean template rather than the
      original design (always true for pdf uploads). */
  reformatted: boolean;
};

/**
 * Shared per-format export pipeline (both rewrite modes use this).
 *
 * - tex: splice replacements into the untouched source, recompile (Tectonic).
 * - docx: rewrite text runs in place, convert via LibreOffice headless.
 * - pdf: render the rewritten full text into a clean standard template.
 *
 * `replacements` carry the accepted plain-text edits; `fullText` is the
 * complete rewritten text (required for the pdf path, and the fallback the
 * caller can use if too many spans fail to place).
 */
export async function exportCv(opts: {
  format: CvFormat;
  originalData: Buffer;
  replacements: SpanReplacement[];
  fullText: string;
}): Promise<ExportResult> {
  switch (opts.format) {
    case "tex": {
      const spliced: TexSpliceResult = replaceTexSpans(
        opts.originalData.toString("utf-8"),
        opts.replacements,
      );
      const pdf = await compileTex(spliced.source);
      return { pdf, unplaced: spliced.unplaced, reformatted: false };
    }
    case "docx": {
      const spliced = await applyDocxReplacements(
        opts.originalData,
        opts.replacements,
      );
      const pdf = await docxToPdf(spliced.data);
      return { pdf, unplaced: spliced.unplaced, reformatted: false };
    }
    case "pdf": {
      const pdf = await renderCleanPdf(opts.fullText);
      return { pdf, unplaced: [], reformatted: true };
    }
  }
}

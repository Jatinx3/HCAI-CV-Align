import type { CvFormat } from "@/lib/extract";
import {
  compileTex,
  pdfPageCount,
  replaceTexSpans,
  TexCompileError,
  type SpanReplacement,
  type TexSpliceResult,
} from "./tex";
import { applyDocxReplacements, docxToPdf } from "./docx";
import { renderCleanPdf } from "./pdf";
import { editPdfInPlace, verifyInPlace } from "./pdf-inplace";

export type { SpanReplacement };

export type ExportResult = {
  pdf: Buffer;
  /** Accepted changes that could not be placed back into the original
      structure (tex/docx paths). Surfaced to the user, never silent. */
  unplaced: SpanReplacement[];
  /** True when the output is a re-laid-out clean template rather than the
      original design. */
  reformatted: boolean;
  /** Why a PDF fell back to the clean template, when it did. */
  reformatReason?: string;
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
      try {
        const pdf = await compileTex(spliced.source);
        return { pdf, unplaced: spliced.unplaced, reformatted: false };
      } catch (err) {
        /**
         * A .tex CV that will not compile used to be the end of the road: the
         * participant saw a shell command and got no document. Their own
         * template can depend on a package, a font or a class the engine here
         * does not have, and none of that is their fault or something they can
         * fix mid-session.
         *
         * The clean template is the same guaranteed path the PDF route already
         * falls back to. They lose their own design, they are told they lost
         * it, and they still leave with the tailored CV they came for.
         */
        if (!(err instanceof TexCompileError)) throw err;
        // No compiled original to measure, so there is no page count to match.
        // renderCleanPdf falls back to its densest setting rather than dropping
        // anything, which is the same bargain the PDF path already makes when
        // it cannot read the original's length.
        return {
          pdf: await renderCleanPdf(opts.fullText, 1),
          unplaced: spliced.unplaced,
          reformatted: true,
          reformatReason: err.message,
        };
      }
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
      /**
       * Try to keep the user's own design by editing the accepted changes into
       * the uploaded file, and verify the result before returning it. In-place
       * editing of an arbitrary PDF cannot be made reliable — subsetted fonts,
       * no reflow — and its failures are silent, so a clean reformat is kept as
       * the guaranteed path underneath. The caller is told which one it got.
       */
      // The uploaded file sets the length the rewrite has to fit: a one-page
      // CV that comes back two pages long reads as damage even when every word
      // survived.
      const originalPages = await pdfPageCount(opts.originalData).catch(
        () => 1,
      );

      // On by default now that redaction removes the original run rather than
      // covering it. PDF_INPLACE_EDIT=false forces the clean template.
      /**
       * With nothing to place, in-place editing has nothing to do and returns
       * the file untouched — which is correct for a CV with no accepted
       * changes, and silently wrong for a whole-document rewrite that arrives
       * as `fullText` with no spans. One-click did exactly that, and its PDF
       * output came back byte-identical to the upload.
       */
      if (
        process.env.PDF_INPLACE_EDIT === "false" ||
        opts.replacements.length === 0
      ) {
        return {
          pdf: await renderCleanPdf(opts.fullText, originalPages),
          unplaced: [],
          reformatted: true,
          reformatReason: "in-place PDF editing is disabled",
        };
      }

      try {
        const edit = await editPdfInPlace(opts.originalData, opts.replacements);
        if (edit.ok) {
          const check = await verifyInPlace(
            edit.pdf,
            opts.originalData,
            opts.replacements.filter((r) => !edit.unplaced.includes(r)),
          );
          if (check.ok) {
            return {
              pdf: edit.pdf,
              unplaced: edit.unplaced,
              reformatted: false,
            };
          }
          return {
            pdf: await renderCleanPdf(opts.fullText, originalPages),
            unplaced: [],
            reformatted: true,
            reformatReason: check.reason,
          };
        }
        return {
          pdf: await renderCleanPdf(opts.fullText, originalPages),
          unplaced: [],
          reformatted: true,
          reformatReason: edit.reason,
        };
      } catch (err) {
        return {
          pdf: await renderCleanPdf(opts.fullText, originalPages),
          unplaced: [],
          reformatted: true,
          reformatReason: (err as Error).message.slice(0, 80),
        };
      }
    }
  }
}

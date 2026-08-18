import { PDFDocument, StandardFonts, type PDFFont, rgb } from "pdf-lib";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { SpanReplacement } from "./index";

/**
 * Edit accepted changes into the uploaded PDF, keeping its own design.
 *
 * The first attempt at this was abandoned, and the reason is worth keeping:
 * pdf-lib can draw over a text run but cannot delete one, so the original
 * wording stayed in the text layer. Applicant tracking systems read that layer
 * rather than the pixels, which would have handed a recruiter's software both
 * the old and the new wording while the page looked correct on screen.
 *
 * MuPDF applies real redactions — the glyphs are removed from the content
 * stream, which `verifyInPlace` below confirms by reading the output back. So
 * the sequence is: redact the original run with MuPDF, then draw the
 * replacement into the space it occupied with pdf-lib.
 *
 * What this still cannot do is reflow. A PDF holds positioned glyphs, not
 * paragraphs, so the replacement has to fit the lines the original occupied.
 * When it does not fit — or when the text needs glyphs a standard PDF font
 * cannot draw — the change is reported as unplaced and the caller falls back
 * to the clean template for the whole document. A page that is half the
 * author's design and half ours is worse than either.
 */

export type InPlaceResult =
  | { ok: true; pdf: Buffer; applied: number; unplaced: SpanReplacement[] }
  | { ok: false; reason: string };

/** One line of the original, captured before anything is redacted. */
type SourceLine = {
  page: number;
  /** Baseline in MuPDF's top-left space. */
  baseline: number;
  x0: number;
  x1: number;
  size: number;
  family: string;
  weight: string;
  style: string;
};

type Quad = [number, number, number, number, number, number, number, number];

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** A positioned text run of the original, as pdf.js reports it. */
type Fragment = { page: number; x: number; baseline: number; text: string };

/**
 * Text runs with their true baselines.
 *
 * MuPDF is what can delete a run, but the `y` it reports for a line sits about
 * a point above the baseline, and drawing there leaves the replacement riding
 * high against the lines around it. pdf.js reports the text-space origin of
 * each run, which is the baseline pdf-lib draws from, so each library is used
 * for the thing it is exact at: MuPDF for the redaction, pdf.js for placement.
 */
async function readFragments(data: Buffer): Promise<Fragment[]> {
  const fragments: Fragment[] = [];
  let page = -1;
  await pdfParse(data, {
    pagerender: (p: {
      getTextContent: () => Promise<{
        items: { str: string; transform: number[] }[];
      }>;
    }) => {
      page += 1;
      const current = page;
      return p.getTextContent().then((content) => {
        for (const item of content.items) {
          if (!item.str.trim()) continue;
          fragments.push({
            page: current,
            x: item.transform[4],
            baseline: item.transform[5],
            text: item.str,
          });
        }
        return "";
      });
    },
  });
  return fragments;
}

/**
 * Load mupdf at call time rather than at module scope.
 *
 * It is ESM-only and runs a top-level await to instantiate its WebAssembly, so
 * a CommonJS `require` of it fails — and the corpus scripts load this module
 * through a CommonJS transform. The import is built with `new Function` so that
 * transform cannot rewrite it into something that resolves against a data URL.
 */
const loadMupdf = new Function(
  'return import("mupdf")',
) as () => Promise<typeof import("mupdf")>;

/**
 * Characters a standard PDF font can draw. Anything outside WinAnsi would
 * throw at draw time, which is not a failure worth risking on a participant.
 */
function isEncodable(text: string): boolean {
  return /^[\x20-\x7E -ÿ–—‘’“”•·]*$/.test(
    text,
  );
}

/**
 * The closest standard font to the one the original run was set in.
 *
 * The document's own font cannot be reused: it is embedded as a subset holding
 * only the glyphs the original text needed, so a rewrite would ask it for
 * letters it does not contain. Matching the family, weight and slope keeps the
 * replaced line in the same key as its neighbours even though the face differs.
 */
function standardFontFor(line: SourceLine): StandardFonts {
  const bold = line.weight.toLowerCase() === "bold";
  const italic = line.style.toLowerCase().includes("italic");
  const family = line.family.toLowerCase();

  if (family.includes("mono")) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (family.includes("serif") && !family.includes("sans")) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/** Greedy wrap at the width available on each line. */
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  widths: number[],
): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const available = widths[Math.min(lines.length, widths.length - 1)];
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= available) {
      current = candidate;
      continue;
    }
    if (!current) return null; // a single word wider than the column
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

type Match = {
  quads: Quad[];
  lines: SourceLine[];
  page: number;
};

/** Where a replacement's original text sits, and how it is set. */
function findMatch(
  pageIndex: number,
  quads: Quad[],
  sourceLines: SourceLine[],
): Match | null {
  if (!quads.length) return null;
  const lines: SourceLine[] = [];

  for (const quad of quads) {
    const top = Math.min(quad[1], quad[5]);
    const bottom = Math.max(quad[1], quad[5]);
    const line = sourceLines.find(
      (l) => l.page === pageIndex && l.baseline >= top - 1 && l.baseline <= bottom + 2,
    );
    if (!line) return null;
    lines.push(line);
  }
  return { quads, lines, page: pageIndex };
}

export async function editPdfInPlace(
  original: Buffer,
  replacements: SpanReplacement[],
): Promise<InPlaceResult> {
  if (replacements.length === 0) {
    return { ok: true, pdf: original, applied: 0, unplaced: [] };
  }

  const mupdf = await loadMupdf();
  const fragments = await readFragments(original).catch(() => [] as Fragment[]);

  let doc: InstanceType<typeof mupdf.PDFDocument>;
  try {
    doc = mupdf.Document.openDocument(
      original,
      "application/pdf",
    ) as InstanceType<typeof mupdf.PDFDocument>;
  } catch (err) {
    return {
      ok: false,
      reason: `could not be opened for editing (${(err as Error).message.slice(0, 60)})`,
    };
  }

  const pageCount = doc.countPages();
  const sourceLines: SourceLine[] = [];
  for (let p = 0; p < pageCount; p++) {
    const page = doc.loadPage(p);
    const structured = JSON.parse(
      page.toStructuredText("preserve-whitespace").asJSON(),
    ) as {
      blocks?: {
        lines?: {
          x: number;
          y: number;
          bbox: { x: number; y: number; w: number; h: number };
          font?: { family?: string; weight?: string; style?: string; size?: number };
        }[];
      }[];
    };
    for (const block of structured.blocks ?? []) {
      for (const line of block.lines ?? []) {
        sourceLines.push({
          page: p,
          baseline: line.y,
          x0: line.bbox.x,
          x1: line.bbox.x + line.bbox.w,
          size: line.font?.size ?? line.bbox.h,
          family: line.font?.family ?? "sans-serif",
          weight: line.font?.weight ?? "normal",
          style: line.font?.style ?? "normal",
        });
      }
    }
  }

  const matches = new Map<SpanReplacement, Match>();
  const unplaced: SpanReplacement[] = [];

  for (const rep of replacements) {
    if (!isEncodable(rep.replacement)) {
      unplaced.push(rep);
      continue;
    }
    let found: Match | null = null;
    for (let p = 0; p < pageCount && !found; p++) {
      const page = doc.loadPage(p);
      const hits = page.search(norm(rep.original)) as Quad[][];
      if (hits.length) found = findMatch(p, hits[0], sourceLines);
    }
    if (!found) {
      unplaced.push(rep);
      continue;
    }
    matches.set(rep, found);
  }

  if (matches.size === 0) {
    return {
      ok: false,
      reason: "none of the accepted changes could be located in the original layout",
    };
  }

  // Redact every located run, then flatten the redactions page by page. This
  // removes the glyphs rather than covering them.
  const touchedPages = new Set<number>();
  for (const match of matches.values()) {
    const page = doc.loadPage(match.page);
    const annot = page.createAnnotation("Redact");
    annot.setQuadPoints(match.quads);
    touchedPages.add(match.page);
  }
  for (const p of touchedPages) {
    doc.loadPage(p).applyRedactions(false);
  }

  const redacted = Buffer.from(doc.saveToBuffer("").asUint8Array());

  let out: PDFDocument;
  try {
    out = await PDFDocument.load(redacted);
  } catch (err) {
    return {
      ok: false,
      reason: `redacted document could not be reopened (${(err as Error).message.slice(0, 50)})`,
    };
  }

  const fontCache = new Map<StandardFonts, PDFFont>();
  const fontFor = async (name: StandardFonts) => {
    const cached = fontCache.get(name);
    if (cached) return cached;
    const embedded = await out.embedFont(name);
    fontCache.set(name, embedded);
    return embedded;
  };

  const pages = out.getPages();
  let applied = 0;

  for (const [rep, match] of matches) {
    const page = pages[match.page];
    if (!page) {
      unplaced.push(rep);
      continue;
    }
    const first = match.lines[0];
    const font = await fontFor(standardFontFor(first));

    // The column the original occupied: the first output line starts where the
    // original run started, later ones at the left edge of the block.
    const left = Math.min(...match.lines.map((l) => l.x0));
    const right = Math.max(...match.lines.map((l) => l.x1));
    const startX = Math.min(...match.quads[0].filter((_, i) => i % 2 === 0));
    const widths = [right - startX, ...match.lines.slice(1).map(() => right - left)];
    if (widths.length < match.lines.length) widths.push(right - left);

    // Fit into the lines the original used. Shrinking is allowed within
    // reason; past that the text would collide with the line beneath it.
    let size = first.size;
    let laidOut = wrap(rep.replacement, font, size, widths);
    while (
      (laidOut === null || laidOut.length > match.lines.length) &&
      size > first.size * 0.9
    ) {
      size -= 0.25;
      laidOut = wrap(rep.replacement, font, size, widths);
    }
    if (laidOut === null || laidOut.length > match.lines.length) {
      unplaced.push(rep);
      continue;
    }

    const height = page.getHeight();
    laidOut.forEach((text, i) => {
      const line = match.lines[i];
      // pdf-lib measures from the bottom of the page, MuPDF from the top.
      const fromMupdf = height - line.baseline;
      // Prefer the baseline pdf.js reports for the run being replaced: it is
      // the same quantity pdf-lib draws from, so the replacement sits on the
      // line rather than a point above it.
      const quad = match.quads[i];
      const near = fragments.find(
        (f) =>
          f.page === match.page &&
          Math.abs(f.baseline - fromMupdf) <= 4 &&
          Math.abs(f.x - Math.min(quad[0], quad[4])) <= 14,
      );
      page.drawText(text, {
        x: i === 0 ? startX : left,
        y: near ? near.baseline : fromMupdf,
        size,
        font,
        color: rgb(0, 0, 0),
      });
    });
    applied += 1;
  }

  if (applied === 0) {
    return {
      ok: false,
      reason: "no accepted change fitted the space it had in the original layout",
    };
  }

  const bytes = await out.save();
  return { ok: true, pdf: Buffer.from(bytes), applied, unplaced };
}

/**
 * Confirm the edited document says what it should before it is handed over.
 * Checks the page count is unchanged, that each applied change is now present
 * in the extracted text, and that no replaced original survives.
 */
export async function verifyInPlace(
  edited: Buffer,
  originalPdf: Buffer,
  applied: SpanReplacement[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const [before, after] = await Promise.all([
      pdfParse(originalPdf),
      pdfParse(edited),
    ]);
    if (before.numpages !== after.numpages) {
      return { ok: false, reason: "page count changed" };
    }
    const text = norm(after.text);
    for (const rep of applied) {
      if (!text.includes(norm(rep.replacement))) {
        return { ok: false, reason: "an applied change is missing from the output" };
      }
      if (text.includes(norm(rep.original))) {
        return { ok: false, reason: "replaced text is still present in the output" };
      }
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `output could not be read back (${(err as Error).message.slice(0, 50)})`,
    };
  }
}

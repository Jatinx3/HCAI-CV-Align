import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { SpanReplacement } from "./index";

/**
 * Edit accepted changes into the uploaded PDF, keeping its own design.
 *
 * DISABLED BY DEFAULT — set PDF_INPLACE_EDIT=true to attempt it. Kept because
 * the attempt and its verification are the evidence for why the export path
 * reformats instead, and because they become useful the moment a real
 * redaction tool is available.
 *
 * A PDF holds positioned glyph runs, not text. Without a way to rewrite the
 * page content stream, a change can only be made by covering the original run
 * and drawing new wording over it — and covering is not deleting. The original
 * words remain in the file and are still extracted by anything that reads it.
 *
 * For a CV that is worse than reformatting. Applicant tracking systems read
 * the text layer, not the pixels, so a "preserved" CV would present a
 * recruiter's software with both the old and the new wording at once, while
 * looking correct to the person who downloaded it. Verification below catches
 * exactly this, which is why every corpus template currently falls back.
 *
 * Doing this properly needs true redaction: parsing the content stream and
 * removing the text-showing operators for the replaced run, rather than
 * painting over them.
 */

export type InPlaceResult =
  | { ok: true; pdf: Buffer; applied: number; unplaced: SpanReplacement[] }
  | { ok: false; reason: string };

type Fragment = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

/** Text runs of the document, with the position of each. */
async function readFragments(data: Buffer): Promise<Fragment[]> {
  const fragments: Fragment[] = [];
  let pageNumber = -1;

  await pdfParse(data, {
    pagerender: (page: {
      getTextContent: (o: object) => Promise<{
        items: { str: string; width?: number; height?: number; transform: number[] }[];
      }>;
    }) => {
      pageNumber += 1;
      const current = pageNumber;
      return page
        .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
        .then((content) => {
          for (const item of content.items) {
            if (!item.str.trim()) continue;
            fragments.push({
              page: current,
              x: item.transform[4],
              y: item.transform[5],
              width: item.width ?? 0,
              height: item.height ?? (Math.abs(item.transform[3]) || 10),
              text: item.str,
            });
          }
          return "";
        });
    },
  });

  return fragments;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Locate the run of fragments on one line whose combined text matches the
 * original. Only a contiguous run on a single line can be replaced: a span
 * that wraps has no single rectangle to draw into.
 */
function locate(fragments: Fragment[], original: string): Fragment[] | null {
  const target = norm(original);
  if (!target) return null;

  const byLine = new Map<string, Fragment[]>();
  for (const f of fragments) {
    const k = `${f.page}:${Math.round(f.y)}`;
    byLine.set(k, [...(byLine.get(k) ?? []), f]);
  }

  for (const line of byLine.values()) {
    const items = [...line].sort((a, b) => a.x - b.x);
    for (let i = 0; i < items.length; i++) {
      let combined = "";
      for (let j = i; j < items.length; j++) {
        combined += (combined && !combined.endsWith(" ") ? " " : "") + items[j].text;
        const c = norm(combined);
        if (c === target) return items.slice(i, j + 1);
        if (c.length > target.length + 4) break;
      }
    }
  }
  return null;
}

/** Characters a standard PDF font can draw. */
function isEncodable(text: string): boolean {
  // WinAnsi covers Latin-1 plus common punctuation; anything outside it would
  // throw at draw time, which is not a failure worth risking on a participant.
  return /^[\x20-\x7E -ÿ–—‘’“”•·]*$/.test(
    text,
  );
}

export async function editPdfInPlace(
  original: Buffer,
  replacements: SpanReplacement[],
): Promise<InPlaceResult> {
  if (replacements.length === 0) {
    return { ok: true, pdf: original, applied: 0, unplaced: [] };
  }

  let fragments: Fragment[];
  let doc: PDFDocument;
  try {
    fragments = await readFragments(original);
    doc = await PDFDocument.load(original, { ignoreEncryption: false });
  } catch (err) {
    return {
      ok: false,
      reason: `could not be opened for editing (${(err as Error).message.slice(0, 60)})`,
    };
  }

  if (doc.isEncrypted) return { ok: false, reason: "the PDF is encrypted" };

  const pages = doc.getPages();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const unplaced: SpanReplacement[] = [];
  let applied = 0;

  for (const rep of replacements) {
    if (!isEncodable(rep.replacement)) {
      unplaced.push(rep);
      continue;
    }
    const run = locate(fragments, rep.original);
    if (!run) {
      unplaced.push(rep);
      continue;
    }

    const page = pages[run[0].page];
    if (!page) {
      unplaced.push(rep);
      continue;
    }

    const x = Math.min(...run.map((f) => f.x));
    const right = Math.max(...run.map((f) => f.x + f.width));
    const y = run[0].y;
    const size = Math.max(6, Math.min(...run.map((f) => f.height)));
    const available = right - x;

    // The replacement has to fit the space the original occupied. Shrinking is
    // allowed within reason; past that the row would collide with its
    // neighbour, so the change is reported rather than drawn.
    const font: PDFFont = /^[A-Z0-9 ,.\-/]+$/.test(run.map((f) => f.text).join(""))
      ? bold
      : regular;
    let fontSize = size;
    let width = font.widthOfTextAtSize(rep.replacement, fontSize);
    while (width > available && fontSize > size * 0.82) {
      fontSize -= 0.25;
      width = font.widthOfTextAtSize(rep.replacement, fontSize);
    }
    if (width > available) {
      unplaced.push(rep);
      continue;
    }

    // Cover the original run, then draw the new wording in its place.
    page.drawRectangle({
      x: x - 0.5,
      y: y - size * 0.28,
      width: available + 1.5,
      height: size * 1.22,
      color: rgb(1, 1, 1),
    });
    page.drawText(rep.replacement, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0.08, 0.08, 0.08),
    });
    applied += 1;
  }

  if (applied === 0) {
    return {
      ok: false,
      reason: "none of the accepted changes could be placed in the original layout",
    };
  }

  const bytes = await doc.save();
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

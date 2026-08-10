import mammoth from "mammoth";
// Import the implementation directly: pdf-parse's index.js runs debug code
// when loaded outside a parent module context.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export type CvFormat = "pdf" | "docx" | "tex";

const MAGIC = {
  pdf: Buffer.from("%PDF"),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // .docx is a zip
};

// Format detection: extension first, then magic bytes as a cross-check.
// Returns null when the file is not one of the three supported formats
// or when extension and content disagree.
export function detectFormat(fileName: string, data: Buffer): CvFormat | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    return data.subarray(0, 4).equals(MAGIC.pdf) ? "pdf" : null;
  }
  if (ext === "docx") {
    return data.subarray(0, 4).equals(MAGIC.zip) ? "docx" : null;
  }
  if (ext === "tex") {
    // .tex is plain text; reject binary-looking content.
    const sample = data.subarray(0, 1024);
    return sample.includes(0) ? null : "tex";
  }
  return null;
}

export async function extractText(
  format: CvFormat,
  data: Buffer,
): Promise<string> {
  switch (format) {
    case "pdf": {
      const result = await pdfParse(data, { pagerender: renderPageWithColumns });
      return normalize(result.text);
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer: data });
      return normalize(result.value);
    }
    case "tex":
      return normalize(stripTex(data.toString("utf-8")));
  }
}

/**
 * Read a PDF page as positioned text rather than as a stream of words.
 *
 * A résumé is a two-column layout: a role on the left, its dates hard against
 * the right margin. Default extraction returns the reading order and drops the
 * whitespace between the columns, so "Senior Software Engineer" and "Sept 2021
 * – July 2024" arrive glued into one string, and no amount of pattern matching
 * on the result can reliably say where one ends and the other begins.
 *
 * The page itself knows: every text item carries its x position and width. A
 * gap far wider than the spaces inside a line is a column boundary, and is
 * emitted as a tab for the layout to split on.
 */
type PdfTextItem = { str: string; width?: number; transform: number[] };

/** Vertical slack, in PDF units, within which items count as one line. */
const LINE_TOLERANCE = 2.5;

function renderPageWithColumns(pageData: {
  getTextContent: (opts: object) => Promise<{ items: PdfTextItem[] }>;
}): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((content) => {
      // Group items into lines by vertical position, with a tolerance. Items
      // on one visual line are rarely at an identical y — a superscript, a
      // different font, or plain rounding puts them a fraction apart — and
      // grouping on the exact value splits a heading into "Pro" and
      // "fessional Summary" on separate lines.
      type Piece = { x: number; w: number; str: string };
      const placed: { y: number; items: Piece[] }[] = [];
      for (const item of content.items) {
        if (!item.str) continue;
        const y = item.transform[5];
        const piece = { x: item.transform[4], w: item.width ?? 0, str: item.str };
        const row = placed.find((r) => Math.abs(r.y - y) <= LINE_TOLERANCE);
        if (row) row.items.push(piece);
        else placed.push({ y, items: [piece] });
      }

      const lines: string[] = [];
      for (const row of placed.sort((a, b) => b.y - a.y)) {
        const items = row.items.sort((a, b) => a.x - b.x);

        // A column gap is judged against this line's own typography, so the
        // threshold holds for a heading and for small print alike.
        const widths = items.filter((i) => i.str.trim()).map((i) => i.w / Math.max(i.str.length, 1));
        const charWidth =
          widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : 5;
        const columnGap = Math.max(8, charWidth * 4);

        let line = "";
        let prevEnd: number | null = null;
        for (const it of items) {
          if (prevEnd !== null) {
            const gap = it.x - prevEnd;
            if (gap >= columnGap) line += "\t";
            else if (gap > charWidth * 0.3 && !/\s$/.test(line) && !/^\s/.test(it.str))
              line += " ";
          }
          line += it.str;
          prevEnd = it.x + it.w;
        }
        lines.push(line);
      }
      return lines.join("\n");
    });
}

/**
 * Rough plain-text view of a .tex source for analysis and preview. The export
 * pipeline works on the untouched original source; this is only what the model
 * and the preview read.
 *
 * Two rules matter. Only the document body is considered — a preamble is full
 * of lengths and font declarations whose arguments are not prose, and reading
 * them yields "-3.0pt" and "ffi" where a CV should be. And a command's braced
 * argument is kept rather than dropped: résumé templates carry their content
 * inside custom macros (\resumeItem{…}, \resumeSubheading{…}{…}), so discarding
 * brace groups discards the CV itself.
 */
function stripTex(src: string): string {
  let s = src.replace(/\r\n/g, "\n");

  // Body only. Without \begin{document} (a fragment, or an \input file) the
  // whole source is used, which is the best available guess.
  const begin = s.indexOf("\\begin{document}");
  if (begin !== -1) s = s.slice(begin + "\\begin{document}".length);
  const end = s.indexOf("\\end{document}");
  if (end !== -1) s = s.slice(0, end);

  return (
    s
      .replace(/(?<!\\)%.*$/gm, "") // comments
      // Links: keep the label, drop the target.
      .replace(/\\href\{[^}]*\}\s*\{/g, "{")
      .replace(/\\url\{([^}]*)\}/g, "$1")
      // Spacing and box commands take lengths, not prose. Their arguments must
      // go with them, or "\vspace{1pt}" contributes "1pt" to the CV.
      .replace(
        /\\(vspace|hspace|vskip|hskip|smallskip|medskip|bigskip|setlength|addtolength|rule|raisebox|scalebox|resizebox|includegraphics|label|pagestyle|thispagestyle|hfill|vfill|phantom|hphantom|vphantom)\*?(\s*\[[^\]]*\])?(\s*\{[^{}]*\})*/g,
        " ",
      )
      // Bullets, including the wrapper macros résumé templates define for them
      // (\resumeItem, \cvitem). The negative lookahead keeps list *scaffolding*
      // such as \resumeItemListStart out of the bullet rule; the generic
      // command pass below removes those.
      .replace(/\\[a-zA-Z]*[Ii]tem(?![a-zA-Z])\s*/g, "\n• ")
      .replace(/\\\\(\s*\[[^\]]*\])?/g, "\n") // explicit line breaks
      .replace(/\\(begin|end)\{[^}]*\}(\[[^\]]*\])?/g, "\n") // environments
      // Adjacent brace groups are separate fields of a résumé macro
      // (title / date / organisation), not one run of text. A group ending in
      // a colon is the exception — "\textbf{Databases:}{ MongoDB, …}" is one
      // label-and-value line, and splitting it strands every label.
      .replace(/([^:])\}\s*\{/g, "$1}\n{")
      // Command names and their optional arguments; braced content stays.
      .replace(/\\[a-zA-Z@]+\*?(\s*\[[^\]]*\])?/g, " ")
      .replace(/\\[^a-zA-Z]/g, " ") // escaped punctuation: \& \% \_ \#
      .replace(/\$[^$]*\$/g, " ") // inline math
      .replace(/[{}]/g, " ")
      .replace(/[&~]/g, " ") // tabular separators, ties
      .replace(/^[ \t]*[|•]\s*$/gm, "") // rules and orphaned bullets
  );
}

function normalize(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      // Icon fonts (fontawesome and friends) have no Unicode meaning, so they
      // extract as control characters or private-use glyphs. Left in, they
      // become lines like "#" or "ï" sitting above the contact details.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000-\uF8FF\uFFFD]/g, "")
      // LaTeX en/em dashes survive extraction as ASCII runs.
      .replace(/(\S)\s*---\s*(\S)/g, "$1—$2")
      .replace(/(\S)\s*--\s*(\S)/g, "$1–$2")
      // Tabs mark column boundaries the page geometry revealed; only runs of
      // spaces are collapsed, and a tab absorbs any spaces around it.
      .replace(/ +/g, " ")
      .replace(/ *\t+ */g, "\t")
      .replace(/ ?\n ?/g, "\n")
      // A bullet glyph extracted onto its own line belongs to the text that
      // follows it; left alone it is discarded as stray punctuation and the
      // list becomes a run of paragraphs.
      .replace(/^([\u2022\u25AA\u25CF\u25E6])[ \t]*\n+/gmu, "$1 ")
      // A line left holding nothing but stray punctuation was an icon.
      .replace(/^[^\p{L}\p{N}]{1,6}$/gmu, "")
      // An icon that mapped onto a printable accented letter survives as a
      // lone glyph in front of the detail it labelled ("ï linkedin.com/…").
      .replace(/^(?![\u2022\u25AA\u25CF\u25E6\u2013\u2014])[^\x00-\x7F]\s+(?=\S)/gmu, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

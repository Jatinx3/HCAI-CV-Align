import { compileTex, escapeTexText, pdfPageCount } from "./tex";
import { layoutCv, type CvBlock } from "../cv-layout";

/**
 * .pdf path — best effort, explicit reformat. The rewritten plain text is
 * rendered into a clean standard resume template and compiled with Tectonic.
 * This is disclosed to the user at upload time: a PDF upload is reformatted,
 * not cloned.
 *
 * The structure comes from layoutCv, the same function the on-screen preview
 * renders from. Both used to walk the lines themselves and repeatedly drifted
 * apart — one would treat a line as a heading while the other set it as body
 * text — so the document a participant reviewed was not the one they
 * downloaded. There is now a single description of the CV and two renderers
 * for it.
 */

/**
 * How tightly the clean template is set.
 *
 * A résumé is written to fill its page. Re-typesetting one at comfortable
 * book margins pushes the last few lines onto a second sheet, which reads as
 * the tool having mangled the CV even when every word survived: a one-page CV
 * came back two pages long after two accepted edits.
 *
 * So the template has a range of densities rather than one, and the exporter
 * picks the loosest that still fits the page count the person uploaded. The
 * tightest here is about as dense as a résumé is set in practice; below that
 * the honest answer is that the CV is two pages long.
 */
type Density = {
  margin: string;
  /** Space above a new entry — a role, a degree, a project. */
  entryGap: string;
  /** Space above a body paragraph. */
  paraGap: string;
  itemsep: string;
  listTop: string;
  sectionSkip: string;
  linespread: string;
};

/**
 * The loosest setting is résumé-normal, not article-normal. Book margins of
 * 2.2cm were the old fixed geometry, and they cost a page: the same CV that
 * fits on one sheet at the margins résumés are actually set with needed two.
 */
const DENSITIES: Density[] = [
  { margin: "1.4cm", entryGap: "2.5pt", paraGap: "1.5pt", itemsep: "0.5pt", listTop: "1.5pt", sectionSkip: "6pt", linespread: "1.0" },
  { margin: "1.3cm", entryGap: "2pt", paraGap: "1.2pt", itemsep: "0.3pt", listTop: "1.2pt", sectionSkip: "5pt", linespread: "0.99" },
  { margin: "1.2cm", entryGap: "1.5pt", paraGap: "1pt", itemsep: "0.2pt", listTop: "1pt", sectionSkip: "4.5pt", linespread: "0.98" },
  { margin: "1.1cm", entryGap: "1.2pt", paraGap: "0.8pt", itemsep: "0pt", listTop: "0.8pt", sectionSkip: "4pt", linespread: "0.96" },
  { margin: "1.0cm", entryGap: "1pt", paraGap: "0.5pt", itemsep: "0pt", listTop: "0.6pt", sectionSkip: "3.5pt", linespread: "0.94" },
];

export function renderCvTemplate(text: string, density = DENSITIES[0]): string {
  const doc = layoutCv(text);

  const header: string[] = [
    "\\begin{center}",
    `{\\LARGE\\bfseries ${escapeTexText(doc.name)}}`,
  ];
  if (doc.subtitle) {
    header.push(`\\\\[3pt]{\\large ${escapeTexText(doc.subtitle)}}`);
  }
  if (doc.contact.length > 0) {
    const line = doc.contact
      .map((c) => escapeTexText(c))
      .join(" $\\cdot$ ");
    header.push(`\\\\[4pt]{\\small ${line}}`);
  }
  header.push("\\end{center}");

  return `\\documentclass[10pt]{article}
\\usepackage[a4paper,margin=${density.margin}]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\definecolor{rule}{HTML}{888888}
\\newcommand{\\cvsection}[1]{\\vspace{${density.sectionSkip}}{\\large\\bfseries #1}\\\\[-8pt]{\\color{rule}\\rule{\\linewidth}{0.4pt}}\\vspace{2pt}}
\\setlength{\\parindent}{0pt}
% Every block ends with \\par, so a document-wide \\parskip is charged forty
% times over and costs most of a page on its own. Spacing is set per block
% instead, where the amount can match what the block is.
\\setlength{\\parskip}{0pt}
\\linespread{${density.linespread}}\\selectfont
\\setlist[itemize]{leftmargin=1.2em,itemsep=${density.itemsep},topsep=${density.listTop},parsep=0pt}
\\pagestyle{empty}
\\begin{document}
${header.join("\n")}
${doc.blocks.map((b) => renderBlock(b, density)).join("\n")}
\\end{document}
`;
}

function renderBlock(block: CvBlock, d: Density): string {
  switch (block.kind) {
    case "heading":
      return `\\cvsection{${escapeTexText(block.text)}}`;
    case "entry": {
      const left = escapeTexText(block.left);
      const right = escapeTexText(block.right);
      // A sub-line belongs to the entry above it and takes no gap of its own.
      const gap = block.secondary ? "" : `\\vspace{${d.entryGap}}`;
      // A technology stack is set on the line below its title, in italic. Set
      // opposite the title with \hfill it would run past the right margin —
      // TeX would print it anyway, over the edge of the page.
      if (block.stacked) {
        return `${gap}\\textbf{${left}}\\par\\textit{${right}}\\par`;
      }
      // The sub-line of an entry — an institution under a degree, an employer
      // under a role — is set in italic, as résumé layouts do.
      return block.secondary
        ? `\\textit{${left}}\\hfill\\textit{${right}}\\par`
        : `${gap}\\textbf{${left}}\\hfill\\textbf{${right}}\\par`;
    }
    case "list":
      return [
        // Spacing comes from \setlist in the preamble, so one density setting
        // governs every list in the document.
        "\\begin{itemize}",
        ...block.items.map((item) => `\\item ${escapeTexText(item)}`),
        "\\end{itemize}",
      ].join("\n");
    case "paragraph":
      return `\\vspace{${d.paraGap}}${escapeTexText(block.text)}\\par`;
  }
}

/**
 * Compile the clean template, tightening it until it fits.
 *
 * `targetPages` is the page count of the document the person uploaded. Their
 * CV was written to fit that many pages, and a rewrite of a few lines should
 * not change it — coming back a page longer reads as damage, whatever the
 * words say. Each attempt is a compile, so the loop stops at the first fit.
 */
export async function renderCleanPdf(
  text: string,
  targetPages?: number,
): Promise<Buffer> {
  const target = targetPages && targetPages > 0 ? targetPages : 1;

  let best: { pdf: Buffer; pages: number } | null = null;
  for (const density of DENSITIES) {
    const pdf = await compileTex(renderCvTemplate(text, density));
    const pages = await pdfPageCount(pdf);
    if (pages <= target) return pdf;
    if (!best || pages < best.pages) best = { pdf, pages };
  }
  // Genuinely longer than the original: return the densest setting rather than
  // dropping content to make it fit.
  return best!.pdf;
}

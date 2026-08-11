import { compileTex, escapeTexText } from "./tex";
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

export function renderCvTemplate(text: string): string {
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
\\usepackage[a4paper,margin=2.2cm]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\definecolor{rule}{HTML}{888888}
\\newcommand{\\cvsection}[1]{\\vspace{6pt}{\\large\\bfseries #1}\\\\[-8pt]{\\color{rule}\\rule{\\linewidth}{0.4pt}}\\vspace{2pt}}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{3pt}
\\pagestyle{empty}
\\begin{document}
${header.join("\n")}
${doc.blocks.map(renderBlock).join("\n")}
\\end{document}
`;
}

function renderBlock(block: CvBlock): string {
  switch (block.kind) {
    case "heading":
      return `\\cvsection{${escapeTexText(block.text)}}`;
    case "entry": {
      const left = escapeTexText(block.left);
      const right = escapeTexText(block.right);
      // A technology stack is set on the line below its title, in italic. Set
      // opposite the title with \hfill it would run past the right margin —
      // TeX would print it anyway, over the edge of the page.
      if (block.stacked) {
        return `\\textbf{${left}}\\par\\textit{${right}}\\par`;
      }
      // The sub-line of an entry — an institution under a degree, an employer
      // under a role — is set in italic, as résumé layouts do.
      return block.secondary
        ? `\\textit{${left}}\\hfill\\textit{${right}}\\par`
        : `\\textbf{${left}}\\hfill\\textbf{${right}}\\par`;
    }
    case "list":
      return [
        "\\begin{itemize}[leftmargin=1.2em,itemsep=1pt,topsep=2pt]",
        ...block.items.map((item) => `\\item ${escapeTexText(item)}`),
        "\\end{itemize}",
      ].join("\n");
    case "paragraph":
      return `${escapeTexText(block.text)}\\par`;
  }
}

/** Render rewritten plain text into a clean standard resume PDF. */
export async function renderCleanPdf(text: string): Promise<Buffer> {
  return compileTex(renderCvTemplate(text));
}

import { compileTex, escapeTexText } from "./tex";
import {
  BULLET,
  isHeading,
  normaliseHeading,
  splitEntry,
  unwrapLines,
} from "../cv-layout";

/**
 * .pdf path — best effort, explicit reformat. The rewritten plain text is
 * rendered into a clean standard resume template and compiled with Tectonic.
 * This is disclosed to the user at upload time: a PDF upload is reformatted,
 * not cloned.
 *
 * Heuristics on the plain text:
 * - first non-empty line = name (title)
 * - short ALL-CAPS or Title-Case-only lines = section headings
 * - lines starting with a bullet marker = itemized lists
 */

export function renderCvTemplate(text: string): string {
  const raw = text.replace(/\r\n/g, "\n").split("\n");

  // First non-empty line is treated as the person's name.
  let nameIdx = raw.findIndex((l) => l.trim().length > 0);
  if (nameIdx === -1) nameIdx = 0;
  const name = escapeTexText(raw[nameIdx]?.trim() ?? "Curriculum Vitae");

  // Same unwrapping as the on-screen preview, so the download matches it —
  // applied below the name only, mirroring layoutCv.
  const lines = [raw[nameIdx] ?? "", ...unwrapLines(raw.slice(nameIdx + 1))];
  nameIdx = 0;

  const body: string[] = [];
  let inList = false;
  let lastWasEntry = false;
  const closeList = () => {
    if (inList) {
      body.push("\\end{itemize}");
      inList = false;
    }
  };

  for (let i = nameIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) {
      closeList();
      body.push("");
      continue;
    }
    if (isHeading(t)) {
      closeList();
      body.push(`\\cvsection{${escapeTexText(normaliseHeading(t))}}`);
      lastWasEntry = false;
      continue;
    }
    if (BULLET.test(t)) {
      if (!inList) {
        body.push("\\begin{itemize}[leftmargin=1.2em,itemsep=1pt,topsep=2pt]");
        inList = true;
      }
      body.push(`\\item ${escapeTexText(t.replace(BULLET, ""))}`);
      // Bullets end an entry pair: the next title is a new role, not the
      // sub-line of the previous one.
      lastWasEntry = false;
      continue;
    }
    closeList();

    // Restore the two-column entry row that text extraction flattened.
    const entry = splitEntry(t);
    if (entry) {
      const left = escapeTexText(entry.left);
      const right = escapeTexText(entry.right);
      body.push(
        lastWasEntry
          ? `\\textit{${left}}\\hfill\\textit{${right}}\\par`
          : `\\textbf{${left}}\\hfill\\textbf{${right}}\\par`,
      );
      lastWasEntry = !lastWasEntry;
      continue;
    }

    lastWasEntry = false;
    body.push(`${escapeTexText(t)}\\par`);
  }
  closeList();

  return `\\documentclass[10pt]{article}
\\usepackage[a4paper,margin=2.2cm]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage{titlesec}
\\definecolor{rule}{HTML}{888888}
\\newcommand{\\cvsection}[1]{\\vspace{6pt}{\\large\\bfseries #1}\\\\[-8pt]{\\color{rule}\\rule{\\linewidth}{0.4pt}}\\vspace{2pt}}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{3pt}
\\pagestyle{empty}
\\begin{document}
{\\LARGE\\bfseries ${name}}\\\\[10pt]
${body.join("\n")}
\\end{document}
`;
}

/** Render rewritten plain text into a clean standard resume PDF. */
export async function renderCleanPdf(text: string): Promise<Buffer> {
  return compileTex(renderCvTemplate(text));
}

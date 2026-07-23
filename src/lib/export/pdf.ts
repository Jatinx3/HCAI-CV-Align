import { compileTex, escapeTexText } from "./tex";

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

const BULLET = /^\s*[•\-–*]\s+/;

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 48 || BULLET.test(t)) return false;
  const caps = t === t.toUpperCase() && /[A-Z]/.test(t);
  const knownHeading =
    /^(summary|profile|experience|work experience|employment|skills|education|projects|certifications|publications|awards|interests|references|languages)$/i.test(
      t,
    );
  return caps || knownHeading;
}

export function renderCvTemplate(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  // First non-empty line is treated as the person's name.
  let nameIdx = lines.findIndex((l) => l.trim().length > 0);
  if (nameIdx === -1) nameIdx = 0;
  const name = escapeTexText(lines[nameIdx]?.trim() ?? "Curriculum Vitae");

  const body: string[] = [];
  let inList = false;
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
      body.push(`\\cvsection{${escapeTexText(titleCase(t))}}`);
      continue;
    }
    if (BULLET.test(t)) {
      if (!inList) {
        body.push("\\begin{itemize}[leftmargin=1.2em,itemsep=1pt,topsep=2pt]");
        inList = true;
      }
      body.push(`\\item ${escapeTexText(t.replace(BULLET, ""))}`);
      continue;
    }
    closeList();
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

function titleCase(s: string): string {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Render rewritten plain text into a clean standard resume PDF. */
export async function renderCleanPdf(text: string): Promise<Buffer> {
  return compileTex(renderCvTemplate(text));
}

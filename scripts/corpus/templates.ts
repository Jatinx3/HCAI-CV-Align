/**
 * Résumé templates that differ in the ways that actually break extraction:
 * how the right-hand column is positioned (\hfill, tabular, tabularx, or a
 * literal separator), whether the header is centred, how bullets are marked,
 * and how tight the typography is.
 *
 * These are not cosmetic variations. Each one produces a different geometry
 * for the same content, which is precisely what the pipeline has to survive.
 */
import type { CorpusCv } from "./content";

const esc = (s: string) =>
  s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    // A literal en-dash in the source produces a glyph with no reliable
    // ToUnicode entry; LaTeX's own "--" round-trips through extraction.
    .replace(/\u2013/g, "--")
    .replace(/\u2014/g, "---");

type Builder = (cv: CorpusCv) => string;

const PREAMBLE = (opts: {
  margin: string;
  size: string;
  extra?: string;
}) => `\\documentclass[${opts.size}]{article}
\\usepackage[a4paper,margin=${opts.margin}]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage{tabularx}
\\setlength{\\parindent}{0pt}
\\pagestyle{empty}
${opts.extra ?? ""}`;

/** Dates pushed right with \hfill — the most common single-column pattern. */
const classic: Builder = (cv) => `${PREAMBLE({ margin: "2cm", size: "10pt" })}
\\newcommand{\\cvsec}[1]{\\par\\vspace{8pt}{\\large\\bfseries #1}\\\\[-6pt]\\rule{\\linewidth}{0.4pt}\\vspace{2pt}}
\\begin{document}
{\\LARGE\\bfseries ${esc(cv.name)}}\\\\[2pt]
${cv.subtitle ? `${esc(cv.subtitle)}\\\\[2pt]` : ""}
${cv.contact.map(esc).join(" $\\cdot$ ")}
${cv.sections
  .map(
    (s) => `\\cvsec{${esc(s.heading)}}
${(s.paragraphs ?? []).map((p) => `${esc(p)}\\par`).join("\n")}
${(s.labelled ?? []).map((l) => `\\textbf{${esc(l.label)}:} ${esc(l.value)}\\par`).join("\n")}
${(s.entries ?? [])
  .map(
    (e) => `\\textbf{${esc(e.left)}}\\hfill\\textbf{${esc(e.right)}}\\par
${e.subLeft ? `\\textit{${esc(e.subLeft)}}\\hfill\\textit{${esc(e.subRight ?? "")}}\\par` : ""}
${e.bullets.length ? `\\begin{itemize}[leftmargin=1.2em,itemsep=1pt,topsep=2pt]\n${e.bullets.map((b) => `\\item ${esc(b)}`).join("\n")}\n\\end{itemize}` : ""}`,
  )
  .join("\n")}`,
  )
  .join("\n")}
\\end{document}`;

/** Two-column rows built with tabular* — the "Jake's résumé" arrangement. */
const jakes: Builder = (cv) => `${PREAMBLE({ margin: "1.6cm", size: "11pt" })}
\\newcommand{\\cvsec}[1]{\\par\\vspace{6pt}{\\large\\scshape #1}\\\\[-6pt]\\rule{\\linewidth}{0.6pt}\\vspace{1pt}}
\\newcommand{\\row}[4]{%
\\begin{tabular*}{\\linewidth}[t]{l@{\\extracolsep{\\fill}}r}
\\textbf{#1} & \\textbf{#2} \\\\
\\textit{#3} & \\textit{#4} \\\\
\\end{tabular*}\\vspace{-2pt}}
\\begin{document}
\\begin{center}
{\\Huge\\scshape ${esc(cv.name)}}\\\\ \\vspace{2pt}
${cv.subtitle ? `${esc(cv.subtitle)}\\\\ \\vspace{2pt}` : ""}
\\small ${cv.contact.map(esc).join(" $|$ ")}
\\end{center}
${cv.sections
  .map(
    (s) => `\\cvsec{${esc(s.heading)}}
${(s.paragraphs ?? []).map((p) => `${esc(p)}\\par`).join("\n")}
${(s.labelled ?? []).map((l) => `\\textbf{${esc(l.label)}:} ${esc(l.value)}\\par`).join("\n")}
${(s.entries ?? [])
  .map(
    (e) => `\\row{${esc(e.left)}}{${esc(e.right)}}{${esc(e.subLeft ?? "")}}{${esc(e.subRight ?? "")}}
${e.bullets.length ? `\\begin{itemize}[leftmargin=1.4em,itemsep=0pt,topsep=1pt,label=$\\bullet$]\n${e.bullets.map((b) => `\\item\\small ${esc(b)}`).join("\n")}\n\\end{itemize}` : ""}`,
  )
  .join("\n")}`,
  )
  .join("\n")}
\\end{document}`;

/** Right column via tabularx, tighter leading, en-dash bullets. */
const tabular: Builder = (cv) => `${PREAMBLE({ margin: "1.8cm", size: "10pt" })}
\\newcommand{\\cvsec}[1]{\\par\\vspace{7pt}{\\bfseries\\uppercase{#1}}\\\\[-7pt]\\rule{\\linewidth}{0.4pt}}
\\begin{document}
{\\LARGE ${esc(cv.name)}} \\hfill {\\small ${esc(cv.contact[2] ?? "")}}\\\\
{\\small ${esc(cv.contact.slice(0, 2).join(" \\textbullet\\ "))}} \\hfill {\\small ${esc(cv.contact[3] ?? "")}}
${cv.sections
  .map(
    (s) => `\\cvsec{${esc(s.heading)}}
${(s.paragraphs ?? []).map((p) => `${esc(p)}\\par`).join("\n")}
${(s.labelled ?? []).map((l) => `\\textbf{${esc(l.label)}:} ${esc(l.value)}\\par`).join("\n")}
${(s.entries ?? [])
  .map(
    (e) => `\\begin{tabularx}{\\linewidth}{@{}Xr@{}}
\\textbf{${esc(e.left)}} & ${esc(e.right)} \\\\
${e.subLeft ? `\\textit{${esc(e.subLeft)}} & \\textit{${esc(e.subRight ?? "")}} \\\\` : ""}
\\end{tabularx}
${e.bullets.length ? `\\begin{itemize}[leftmargin=1.2em,itemsep=0pt,topsep=1pt,label=--]\n${e.bullets.map((b) => `\\item ${esc(b)}`).join("\n")}\n\\end{itemize}` : ""}`,
  )
  .join("\n")}`,
  )
  .join("\n")}
\\end{document}`;

/** No rules, no bold columns — dates inline after a separator. ATS-plain. */
const plain: Builder = (cv) => `${PREAMBLE({ margin: "2.4cm", size: "11pt" })}
\\begin{document}
${esc(cv.name)}\\\\
${cv.subtitle ? `${esc(cv.subtitle)}\\\\` : ""}
${cv.contact.map(esc).join(", ")}
${cv.sections
  .map(
    (s) => `\\vspace{10pt}
${esc(s.heading.toUpperCase())}\\par\\vspace{3pt}
${(s.paragraphs ?? []).map((p) => `${esc(p)}\\par`).join("\n")}
${(s.labelled ?? []).map((l) => `${esc(l.label)}: ${esc(l.value)}\\par`).join("\n")}
${(s.entries ?? [])
  .map(
    (e) => `${esc(e.left)} | ${esc(e.right)}\\par
${e.subLeft ? `${esc(e.subLeft)} | ${esc(e.subRight ?? "")}\\par` : ""}
${e.bullets.map((b) => `- ${esc(b)}\\par`).join("\n")}`,
  )
  .join("\n")}`,
  )
  .join("\n")}
\\end{document}`;

/** Dense: small type, narrow margins, long lines that wrap hard. */
const dense: Builder = (cv) => `${PREAMBLE({ margin: "1.2cm", size: "9pt" })}
\\newcommand{\\cvsec}[1]{\\par\\vspace{5pt}{\\bfseries #1}\\\\[-7pt]\\rule{\\linewidth}{0.3pt}}
\\begin{document}
\\begin{center}{\\Large\\bfseries ${esc(cv.name)}}\\\\ {\\footnotesize ${cv.contact.map(esc).join(" \\textbullet\\ ")}}\\end{center}
${cv.sections
  .map(
    (s) => `\\cvsec{${esc(s.heading)}}
${(s.paragraphs ?? []).map((p) => `{\\footnotesize ${esc(p)}}\\par`).join("\n")}
${(s.labelled ?? []).map((l) => `{\\footnotesize \\textbf{${esc(l.label)}:} ${esc(l.value)}}\\par`).join("\n")}
${(s.entries ?? [])
  .map(
    (e) => `\\textbf{\\footnotesize ${esc(e.left)}}\\hfill{\\footnotesize ${esc(e.right)}}\\par
${e.subLeft ? `{\\footnotesize\\itshape ${esc(e.subLeft)}}\\hfill{\\footnotesize\\itshape ${esc(e.subRight ?? "")}}\\par` : ""}
${e.bullets.length ? `\\begin{itemize}[leftmargin=1em,itemsep=0pt,topsep=0pt,parsep=0pt]\n${e.bullets.map((b) => `\\item {\\footnotesize ${esc(b)}}`).join("\n")}\n\\end{itemize}` : ""}`,
  )
  .join("\n")}`,
  )
  .join("\n")}
\\end{document}`;

export const TEMPLATES: Record<string, Builder> = {
  classic,
  jakes,
  tabular,
  plain,
  dense,
};

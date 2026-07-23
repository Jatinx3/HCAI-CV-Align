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
      const result = await pdfParse(data);
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

// Rough plain-text view of a .tex source for analysis/preview.
// The export pipeline (Phase 4) works on the untouched original source.
function stripTex(src: string): string {
  return src
    .replace(/(?<!\\)%.*$/gm, "") // comments
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, "\n")
    .replace(/\\(section|subsection|subsubsection)\*?\{([^}]*)\}/g, "\n$2\n")
    .replace(/\\(textbf|textit|emph|underline|texttt|mbox)\{([^}]*)\}/g, "$2")
    .replace(/\\href\{[^}]*\}\{([^}]*)\}/g, "$1")
    .replace(/\\item/g, "\n• ")
    .replace(/\\\\(\[[^\]]*\])?/g, "\n")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, " ") // other commands
    .replace(/[{}]/g, "")
    .replace(/\$[^$]*\$/g, "");
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

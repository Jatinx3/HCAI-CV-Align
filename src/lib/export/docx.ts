import { execFile } from "child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import JSZip from "jszip";
import { stripLeadingListMarker, type SpanReplacement } from "./tex";

const execFileAsync = promisify(execFile);

/**
 * .docx path — high fidelity. Text is rewritten inside the existing
 * word/document.xml, paragraph by paragraph, keeping paragraph and run
 * styles. When an edit touches a paragraph, the paragraph's full new text is
 * written into its first run (mid-paragraph character formatting within an
 * edited paragraph is the accepted loss; unedited paragraphs are untouched).
 * LibreOffice headless then converts the result to PDF.
 */

const SOFFICE_CANDIDATES = [
  "soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
];

export type DocxSpliceResult = {
  data: Buffer;
  applied: SpanReplacement[];
  unplaced: SpanReplacement[];
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// One <w:t> node with its position inside the paragraph XML.
type TextNode = { start: number; end: number; inner: string };

function findTextNodes(paragraphXml: string): TextNode[] {
  const nodes: TextNode[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraphXml))) {
    nodes.push({ start: m.index, end: re.lastIndex, inner: m[1] });
  }
  return nodes;
}

// Rewrite one paragraph's XML so its visible text becomes `newText`,
// preserving the first <w:t>'s attributes/run and emptying the others.
function setParagraphText(paragraphXml: string, newText: string): string {
  const nodes = findTextNodes(paragraphXml);
  if (nodes.length === 0) return paragraphXml;

  let out = "";
  let cursor = 0;
  nodes.forEach((node, i) => {
    out += paragraphXml.slice(cursor, node.start);
    const nodeXml = paragraphXml.slice(node.start, node.end);
    const openTag = nodeXml.slice(0, nodeXml.indexOf(">") + 1);
    // xml:space="preserve" keeps leading/trailing spaces intact.
    const openWithSpace = openTag.includes("xml:space")
      ? openTag
      : openTag.replace(/^<w:t/, '<w:t xml:space="preserve"');
    out += `${openWithSpace}${i === 0 ? escapeXml(newText) : ""}</w:t>`;
    cursor = node.end;
  });
  out += paragraphXml.slice(cursor);
  return out;
}

/**
 * Apply plain-text span replacements to a .docx file. Matching happens on
 * paragraph text (concatenated runs, XML-unescaped); a span may not cross a
 * paragraph boundary. Unplaced spans are reported for graceful degradation.
 */
export async function applyDocxReplacements(
  data: Buffer,
  replacements: SpanReplacement[],
): Promise<DocxSpliceResult> {
  const zip = await JSZip.loadAsync(data);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Not a valid .docx: word/document.xml missing");
  let xml = await docFile.async("string");

  const applied: SpanReplacement[] = [];
  const pending = replacements.filter((r) => {
    if (!r.original || r.original === r.replacement) {
      applied.push(r);
      return false;
    }
    return true;
  });

  // Process paragraph by paragraph.
  xml = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    if (pending.length === 0) return paragraphXml;
    const nodes = findTextNodes(paragraphXml);
    if (nodes.length === 0) return paragraphXml;
    const text = unescapeXml(nodes.map((n) => n.inner).join(""));

    let newText = text;
    let touched = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const r = pending[i];
      if (newText.includes(r.original)) {
        newText = newText.replace(r.original, stripLeadingListMarker(r.replacement));
        applied.push(r);
        pending.splice(i, 1);
        touched = true;
      }
    }
    return touched ? setParagraphText(paragraphXml, newText) : paragraphXml;
  });

  zip.file("word/document.xml", xml);
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return { data: out, applied, unplaced: pending };
}

async function findSoffice(): Promise<string> {
  for (const candidate of SOFFICE_CANDIDATES) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 30_000 });
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "LibreOffice (soffice) not found — install it to export .docx CVs as PDF.",
  );
}

/** Convert a .docx buffer to PDF via LibreOffice headless. */
export async function docxToPdf(data: Buffer): Promise<Buffer> {
  const soffice = await findSoffice();
  const dir = await mkdtemp(join(tmpdir(), "cvdocx-"));
  try {
    const inPath = join(dir, "cv.docx");
    await writeFile(inPath, data);
    await execFileAsync(
      soffice,
      [
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        inPath,
      ],
      { timeout: 180_000, env: { ...process.env, HOME: dir } },
    );
    const produced = (await readdir(dir)).find((f) => f.endsWith(".pdf"));
    if (!produced) throw new Error("LibreOffice produced no PDF");
    return await readFile(join(dir, produced));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

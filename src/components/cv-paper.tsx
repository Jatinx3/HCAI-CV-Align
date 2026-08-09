"use client";

import { useMemo } from "react";
import { layoutCv } from "@/lib/cv-layout";

/**
 * The CV shown as a document rather than as extracted text.
 *
 * A monospace dump of the parsed text is honest but it is not what the person
 * is making — they are making a CV, and judging whether a change reads well
 * depends on seeing it set as a document. The proportions, margins, and
 * heading rules mirror the LaTeX template the export pipeline compiles, so
 * what is previewed is close to what is downloaded.
 *
 * The sheet keeps paper colours in both themes, the way a PDF viewer does:
 * the document is not part of the interface's surface, it is the artefact.
 */
export default function CvPaper({
  text,
  highlights = [],
  className = "",
}: {
  text: string;
  /** Accepted replacement strings to mark, so changes are findable in context. */
  highlights?: string[];
  className?: string;
}) {
  const doc = useMemo(() => layoutCv(text), [text]);

  return (
    <div className={`cv-mat ${className}`}>
      <article className="cv-paper" aria-label="Your CV as it will be laid out">
        <h1 className="cv-name">{doc.name}</h1>
        {doc.contact.length > 0 && (
          <p className="cv-contact">{doc.contact.join("  ·  ")}</p>
        )}

        {doc.blocks.map((block, i) => {
          if (block.kind === "heading") {
            return (
              <h2 key={i} className="cv-heading">
                {block.text}
              </h2>
            );
          }
          if (block.kind === "list") {
            return (
              <ul key={i} className="cv-list">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Marked text={item} highlights={highlights} />
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <p key={i} className="cv-para">
              <Marked text={block.text} highlights={highlights} />
            </p>
          );
        })}
      </article>
    </div>
  );
}

/** Marks accepted replacements so the user can see their own changes in place. */
function Marked({ text, highlights }: { text: string; highlights: string[] }) {
  const parts = useMemo(() => {
    const hit = highlights.find((h) => h.trim() && text.includes(h.trim()));
    if (!hit) return null;
    const h = hit.trim();
    const at = text.indexOf(h);
    return [text.slice(0, at), h, text.slice(at + h.length)] as const;
  }, [text, highlights]);

  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <mark className="cv-mark">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

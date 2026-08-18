/**
 * Locating a suggestion's quoted original inside the CV text.
 *
 * Models re-wrap text: a quote that is character-identical in content may
 * differ from the source in line breaks and runs of spaces. Validation,
 * the "can this still be applied" check, and the actual replacement must all
 * answer this question the same way — when they disagree, the user is told a
 * change cannot be applied while the validator has already accepted it, or
 * worse, accepts a change that then silently fails to appear in their CV.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Anchor = { start: number; end: number };

/** Find `original` in `text`, tolerating differences in whitespace only. */
function locateOriginal(text: string, original: string): Anchor | null {
  const needle = original.trim();
  if (!needle) return null;

  const direct = text.indexOf(needle);
  if (direct !== -1) return { start: direct, end: direct + needle.length };

  const pattern = needle.split(/\s+/).map(escapeRegex).join("\\s+");
  const match = new RegExp(pattern).exec(text);
  return match
    ? { start: match.index, end: match.index + match[0].length }
    : null;
}

export function containsOriginal(text: string, original: string): boolean {
  return locateOriginal(text, original) !== null;
}

/**
 * Replace the first occurrence of `original` with `replacement`, matching the
 * same way `locateOriginal` does. Returns the text unchanged when the original
 * is no longer present, so callers can detect a no-op.
 */
export function applyReplacement(
  text: string,
  original: string,
  replacement: string,
): string {
  const at = locateOriginal(text, original);
  if (!at) return text;
  return text.slice(0, at.start) + replacement + text.slice(at.end);
}

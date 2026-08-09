/**
 * Word-level diff for suggestion cards.
 *
 * Showing the original and the proposal as two blocks of prose makes the user
 * re-read both and spot the difference themselves — which is precisely the
 * work the interface should be doing for them. Marking the changed words is
 * what makes a suggestion reviewable at a glance, and reviewability is the
 * precondition for meaningful accept/reject.
 */

export type DiffOp = { kind: "equal" | "insert" | "delete"; text: string };

/** Split into words while keeping the whitespace that follows each one. */
function tokenize(s: string): string[] {
  return s.match(/\S+\s*/g) ?? [];
}

/**
 * Longest common subsequence over word tokens. CV lines are short (tens of
 * words), so the quadratic table is not a concern here.
 */
export function wordDiff(original: string, suggested: string): DiffOp[] {
  const a = tokenize(original);
  const b = tokenize(suggested);

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i].trim() === b[j].trim()
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (kind: DiffOp["kind"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.kind === kind) last.text += text;
    else ops.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].trim() === b[j].trim()) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("delete", a[i]);
      i++;
    } else {
      push("insert", b[j]);
      j++;
    }
  }
  while (i < a.length) push("delete", a[i++]);
  while (j < b.length) push("insert", b[j++]);

  return ops;
}

/**
 * Locate a JD requirement inside the job description text so it can be shown
 * in context. Falls back to a case-insensitive search, then to the longest
 * run of words that does appear — models quote requirements approximately.
 */
export function findInJd(
  jdText: string,
  requirement: string,
): { start: number; end: number } | null {
  const needle = requirement.trim();
  if (!needle) return null;

  const direct = jdText.indexOf(needle);
  if (direct !== -1) return { start: direct, end: direct + needle.length };

  const lower = jdText.toLowerCase();
  const ci = lower.indexOf(needle.toLowerCase());
  if (ci !== -1) return { start: ci, end: ci + needle.length };

  // Progressively drop trailing words until something matches.
  const words = needle.split(/\s+/);
  for (let take = words.length - 1; take >= 2; take--) {
    const probe = words.slice(0, take).join(" ").toLowerCase();
    const at = lower.indexOf(probe);
    if (at !== -1) return { start: at, end: at + probe.length };
  }
  return null;
}

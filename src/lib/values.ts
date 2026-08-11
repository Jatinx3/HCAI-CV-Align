/**
 * The VSD values the prototype is designed around, in one place.
 *
 * The review screen labels the affordance that delivers each value, and the
 * legend at the top of that screen explains what the labels mean. Both read
 * from here so the claim a chip makes and the claim the legend makes cannot
 * drift apart — a mismatch would be a transparency failure in the very
 * feature meant to demonstrate transparency.
 *
 * Deliberately not used on the one-click screen. That mode is the commercial
 * baseline; annotating it with values would blunt the contrast the study
 * measures.
 */

export type ValueId = "transparency" | "control" | "authenticity" | "usability";

export type CvValue = {
  id: ValueId;
  /** Shown on the chip. */
  label: string;
  /** What the user is owed under this value, in their words, not the thesis's. */
  claim: string;
  /** How this screen delivers it — the legend entry. */
  delivered: string;
};

export const VALUES: Record<ValueId, CvValue> = {
  transparency: {
    id: "transparency",
    label: "Transparency",
    claim:
      "You can see why every change is proposed, and check it against the job description yourself.",
    delivered:
      "Every suggestion names the requirement it addresses, links to that requirement in the job description, and explains itself in plain language. A suggestion missing either is not shown to you at all.",
  },
  control: {
    id: "control",
    label: "User control",
    claim:
      "Every change is yours to accept, edit, reject, or undo. Nothing is applied automatically.",
    delivered:
      "You decide each suggestion one at a time, set how assertive the assistant is, and can take any decision back. Your original CV is never overwritten.",
  },
  authenticity: {
    id: "authenticity",
    label: "Authenticity",
    claim:
      "The assistant may only rework what your CV already says. It never invents credentials.",
    delivered:
      "Proposals that add anything you did not write are discarded before they reach you. Requirements your CV does not evidence are named as gaps rather than quietly filled in.",
  },
  usability: {
    id: "usability",
    label: "Usability",
    claim: "The work should be readable and never leave you stuck.",
    delivered:
      "Your CV is analysed a section at a time so results arrive as they are ready, changes are shown as a word-level diff rather than two blocks of prose, and every screen offers a way forward.",
  },
};

export const VALUE_ORDER: ValueId[] = [
  "transparency",
  "control",
  "authenticity",
  "usability",
];

/**
 * Trust is deliberately absent from the list above. It has no feature of its
 * own: it is expected to emerge from the four values that do, and it is what
 * the study measures rather than something the interface can assert.
 */
export const TRUST_NOTE =
  "Trust has no feature of its own here. It is meant to follow from the four above — and it is what this study is measuring, not something the app can claim for itself.";

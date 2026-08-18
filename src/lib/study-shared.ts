/**
 * The parts of the study session that both sides need: what the two orders
 * are, what the two modes are called, and which mode a step maps to.
 *
 * Kept apart from study.ts because that module is server-only — the session
 * state it computes must never be derivable in the browser — while the review
 * screen and the feedback form still have to name the mode the participant is
 * on. Client-safe by construction: no imports, no database.
 */

export type StudyOrder = "ONE_CLICK_FIRST" | "HUMAN_CENTERED_FIRST";
export type StudyMode = "ONE_CLICK" | "HUMAN_CENTERED";

export const MODE_LABEL: Record<StudyMode, string> = {
  ONE_CLICK: "One-click rewrite",
  HUMAN_CENTERED: "Review each change",
};

export function modeForStep(order: StudyOrder, stepIndex: number): StudyMode {
  const first: StudyMode =
    order === "ONE_CLICK_FIRST" ? "ONE_CLICK" : "HUMAN_CENTERED";
  const second: StudyMode =
    first === "ONE_CLICK" ? "HUMAN_CENTERED" : "ONE_CLICK";
  return stepIndex === 1 ? first : second;
}

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

/**
 * The code that joins a participant's form answers to what they did here.
 *
 * The external form is a separate system: responses arrive with no idea which
 * session produced them, and a within-subjects comparison is worthless if the
 * preference cannot be paired with the behaviour. Derived from the session id
 * rather than stored, so there is no second identifier to keep in step, and
 * short enough that somebody types it correctly.
 *
 * It identifies a session, not a person. Nothing in it is derived from a name,
 * an email, or anything else about the participant.
 */
export function participantCode(sessionId: string): string {
  return sessionId.slice(-6).toUpperCase();
}

/**
 * The feedback form link, carrying the code when the researcher's URL says
 * where it goes. Microsoft Forms can generate a pre-filled link; putting
 * {code} where the answer belongs makes the join automatic, and leaving it out
 * falls back to the participant typing the code shown on screen.
 */
export function feedbackFormUrl(
  template: string | undefined,
  sessionId: string,
): string | null {
  if (!template) return null;
  return template.includes("{code}")
    ? template.replace("{code}", encodeURIComponent(participantCode(sessionId)))
    : template;
}

export function modeForStep(order: StudyOrder, stepIndex: number): StudyMode {
  const first: StudyMode =
    order === "ONE_CLICK_FIRST" ? "ONE_CLICK" : "HUMAN_CENTERED";
  const second: StudyMode =
    first === "ONE_CLICK" ? "HUMAN_CENTERED" : "ONE_CLICK";
  return stepIndex === 1 ? first : second;
}

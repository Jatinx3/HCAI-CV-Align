import "server-only";
import { prisma } from "./prisma";
import type { StudyMode, StudyOrder } from "./study-shared";

export { MODE_LABEL, modeForStep } from "./study-shared";
export type { StudyMode, StudyOrder } from "./study-shared";

/**
 * The guided session.
 *
 * A participant uses both rewrite modes before giving comparative feedback,
 * chooses which to try first, and may run either of them as many times as they
 * want before finishing. The guidance is in the destination — both modes, then
 * one comparison — not in the route taken to it.
 *
 * The order is therefore observed rather than manipulated. The server still
 * computes a balanced suggestion when the session opens, and records it, so the
 * analysis can report what was suggested alongside what was chosen and say
 * whether the two arms ended up level. What it no longer does is refuse a mode.
 */

export type ModeProgress = Record<StudyMode, number>;

export type StudyState = {
  sessionId: string;
  /** The balanced order the app suggested. Not enforced. */
  suggestedOrder: StudyOrder;
  /** Completed runs of each mode. Either may be more than one. */
  completed: ModeProgress;
  /** The mode the participant finished first, once one is finished. */
  observedFirst: StudyMode | null;
  /** A step started and not finished, to resume rather than start again. */
  resumeStepId: string | null;
  /** Both modes used at least once: the comparison can be made. */
  canFinish: boolean;
  /** The participant has been sent to the feedback form. */
  handoffReached: boolean;
};

/**
 * Suggest the order that is currently behind.
 *
 * Kept even though participants choose for themselves: it costs nothing, it
 * keeps the two arms roughly level when people take the suggestion, and the
 * count is what tells the researcher whether the sample has drifted.
 */
export async function suggestOrder(): Promise<StudyOrder> {
  const [oneClickFirst, humanFirst] = await Promise.all([
    prisma.studySession.count({ where: { assignedOrder: "ONE_CLICK_FIRST" } }),
    prisma.studySession.count({
      where: { assignedOrder: "HUMAN_CENTERED_FIRST" },
    }),
  ]);
  if (oneClickFirst < humanFirst) return "ONE_CLICK_FIRST";
  if (humanFirst < oneClickFirst) return "HUMAN_CENTERED_FIRST";
  return Math.random() < 0.5 ? "ONE_CLICK_FIRST" : "HUMAN_CENTERED_FIRST";
}

export async function studyState(userId: string): Promise<StudyState> {
  let session = await prisma.studySession.findFirst({
    where: { userId, completedAt: null },
    orderBy: { startedAt: "desc" },
    include: { modeSteps: { orderBy: { startedAt: "asc" } } },
  });

  if (!session) {
    const created = await prisma.studySession.create({
      data: { userId, assignedOrder: await suggestOrder() },
    });
    session = { ...created, modeSteps: [] };
  }

  const done = session.modeSteps.filter((s) => s.endedAt);
  const completed: ModeProgress = {
    ONE_CLICK: done.filter((s) => s.mode === "ONE_CLICK").length,
    HUMAN_CENTERED: done.filter((s) => s.mode === "HUMAN_CENTERED").length,
  };
  const unfinished = session.modeSteps.find((s) => !s.endedAt);

  return {
    sessionId: session.id,
    suggestedOrder: session.assignedOrder as StudyOrder,
    completed,
    observedFirst: (done[0]?.mode as StudyMode) ?? null,
    resumeStepId: unfinished?.id ?? null,
    canFinish: completed.ONE_CLICK > 0 && completed.HUMAN_CENTERED > 0,
    handoffReached: session.feedbackHandoffReachedAt !== null,
  };
}

/**
 * Attach a starting step to the guided session.
 *
 * No mode is refused. The step index is the position in the session, so a
 * participant who runs the review mode three times leaves three numbered steps
 * rather than three indistinguishable ones. Returns null for a general user,
 * whose steps carry no session and no index.
 */
export async function studyStepData(
  userId: string,
  studyParticipant: boolean,
): Promise<
  | { ok: true; data: { studySessionId: string; stepIndex: number } | null }
  | { ok: false; error: string }
> {
  if (!studyParticipant) return { ok: true, data: null };

  const state = await studyState(userId);
  const taken = await prisma.modeStep.count({
    where: { studySessionId: state.sessionId },
  });
  return {
    ok: true,
    data: { studySessionId: state.sessionId, stepIndex: taken + 1 },
  };
}

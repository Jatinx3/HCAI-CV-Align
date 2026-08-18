import "server-only";
import { prisma } from "./prisma";
import { MODE_LABEL, modeForStep, type StudyMode, type StudyOrder } from "./study-shared";

/**
 * The guided within-subjects session.
 *
 * A participant meets both rewrite modes in one sitting, in an order the
 * server assigns, and finishes at a single comparative feedback handoff. The
 * order is the experimental control: whoever sees per-suggestion review first
 * may judge the baseline more harshly afterwards, so the design cannot remove
 * that carry-over, only balance it and record which way round each participant
 * met the two systems.
 *
 * Every decision here is made server-side. The client is told which mode it is
 * on, never asked, because a participant who could pick their own order would
 * make the counterbalancing meaningless.
 */

export { MODE_LABEL, modeForStep } from "./study-shared";
export type { StudyMode, StudyOrder } from "./study-shared";

/**
 * Assign the order that is currently behind.
 *
 * Alternating strictly would let a participant infer the next assignment, and
 * randomising alone drifts at this sample size — 20 to 30 people can easily
 * split 18/7. Counting first and taking the minority keeps the two arms level;
 * ties are broken at random so the sequence is not predictable.
 */
export async function assignOrder(): Promise<StudyOrder> {
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

export type StudyState = {
  sessionId: string;
  order: StudyOrder;
  /** Which of the two steps the participant is on, 1 or 2. */
  stepIndex: 1 | 2;
  mode: StudyMode;
  /** An unfinished step to resume rather than start again. */
  resumeStepId: string | null;
  /** Both modes done: the participant belongs at the feedback handoff. */
  finished: boolean;
};

/**
 * The participant's current position, creating the session on first arrival.
 *
 * A step counts as done when its ModeStep has an end time, which both modes
 * set when the participant exports a finished CV. A step that was started and
 * abandoned is resumed rather than duplicated, so a browser reload in the
 * middle of a task does not cost the work or corrupt the record.
 */
export async function studyState(userId: string): Promise<StudyState> {
  let session = await prisma.studySession.findFirst({
    where: { userId, completedAt: null },
    orderBy: { startedAt: "desc" },
    include: { modeSteps: true },
  });

  if (!session) {
    const created = await prisma.studySession.create({
      data: { userId, assignedOrder: await assignOrder() },
    });
    session = { ...created, modeSteps: [] };
  }

  const order = session.assignedOrder as StudyOrder;
  const stepFor = (index: number) =>
    session.modeSteps.find((s) => s.stepIndex === index);

  const first = stepFor(1);
  const second = stepFor(2);

  const stepIndex: 1 | 2 = first?.endedAt ? 2 : 1;
  const current = stepIndex === 1 ? first : second;

  return {
    sessionId: session.id,
    order,
    stepIndex,
    mode: modeForStep(order, stepIndex),
    resumeStepId: current && !current.endedAt ? current.id : null,
    finished: Boolean(first?.endedAt && second?.endedAt),
  };
}

/**
 * Attach a starting mode step to the guided session, refusing a mode that is
 * not the one assigned for this step. Returns null for a general user, whose
 * steps carry no session and no index.
 */
export async function studyStepData(
  userId: string,
  studyParticipant: boolean,
  mode: StudyMode,
): Promise<
  | { ok: true; data: { studySessionId: string; stepIndex: number } | null }
  | { ok: false; error: string }
> {
  if (!studyParticipant) return { ok: true, data: null };

  const state = await studyState(userId);
  if (state.finished) {
    return {
      ok: false,
      error: "Both parts of this session are complete. Continue to the feedback form.",
    };
  }
  if (mode !== state.mode) {
    return {
      ok: false,
      error: `This session is on ${MODE_LABEL[state.mode]} for step ${state.stepIndex}.`,
    };
  }
  return {
    ok: true,
    data: { studySessionId: state.sessionId, stepIndex: state.stepIndex },
  };
}

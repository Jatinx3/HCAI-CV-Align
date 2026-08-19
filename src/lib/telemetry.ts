import "server-only";
import { prisma } from "./prisma";

/**
 * Research instrumentation (RO3), and nothing else.
 *
 * This exists because what participants report and what they do come apart:
 * people say they weigh a suggestion and accept it in a second, and self-report
 * cannot separate the two. It is not an accountability feature, not an audit
 * trail, and not a record anyone but the researcher will read.
 *
 * Three rules follow from that, and they are enforced here rather than left to
 * each call site. Events carry identifiers, counts and timings — never CV or
 * job-description text, which already lives on the mode step and does not need
 * a second copy scattered through a log. The type is drawn from a fixed list,
 * so a client cannot invent categories that later have to be cleaned out of
 * the analysis. And recording never fails the thing it is recording: a
 * participant's accepted change must not be lost because a log write did.
 */

export const EVENT_TYPES = [
  "mode_started",
  "mode_completed",
  "suggestions_generated",
  "suggestion_accepted",
  "suggestion_rejected",
  "suggestion_edited",
  "suggestion_undone",
  "original_revealed",
  "jd_requirement_opened",
  "conservatism_changed",
  "export_downloaded",
  "handoff_reached",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Events a participant's browser may report. The rest are server-side facts. */
export const CLIENT_EVENT_TYPES: EventType[] = [
  "suggestion_accepted",
  "suggestion_rejected",
  "suggestion_edited",
  "suggestion_undone",
  "original_revealed",
  "jd_requirement_opened",
  "conservatism_changed",
];

export function isClientEventType(value: unknown): value is EventType {
  return (
    typeof value === "string" &&
    (CLIENT_EVENT_TYPES as string[]).includes(value)
  );
}

/** Identifiers, counts and timings — never document text. */
export type EventPayload = Record<string, string | number | boolean | null>;

const MAX_PAYLOAD_CHARS = 600;

export async function recordEvent(event: {
  userId: string;
  type: EventType;
  modeStepId?: string | null;
  studySessionId?: string | null;
  payload?: EventPayload;
}): Promise<void> {
  try {
    const payload = event.payload
      ? JSON.stringify(event.payload).slice(0, MAX_PAYLOAD_CHARS)
      : null;
    await prisma.telemetryEvent.create({
      data: {
        userId: event.userId,
        type: event.type,
        modeStepId: event.modeStepId ?? null,
        studySessionId: event.studySessionId ?? null,
        payload,
      },
    });
  } catch {
    // Deliberately swallowed. A failed write costs one row of research data;
    // a thrown error would cost the participant the action they just took.
  }
}

/**
 * Time from the step opening to the participant's first decision on it.
 *
 * Recorded once, and only from events that are actually decisions — revealing
 * the original wording or reading a requirement is not one. Coarse by design:
 * the interval between two timestamps the server already holds, with no
 * keystroke or mouse logging anywhere in the application.
 */
const FIRST_ACTION_TYPES: EventType[] = [
  "suggestion_accepted",
  "suggestion_rejected",
  "suggestion_edited",
];

export async function markFirstAction(
  modeStepId: string,
  type: EventType,
): Promise<void> {
  if (!FIRST_ACTION_TYPES.includes(type)) return;
  try {
    const step = await prisma.modeStep.findUnique({
      where: { id: modeStepId },
      select: { startedAt: true, timeToFirstActionMs: true },
    });
    if (!step || step.timeToFirstActionMs !== null) return;
    await prisma.modeStep.update({
      where: { id: modeStepId },
      data: { timeToFirstActionMs: Date.now() - step.startedAt.getTime() },
    });
  } catch {
    // Same reasoning as above.
  }
}

import Link from "next/link";
import { MODE_LABEL, type StudyMode, type StudyOrder, modeForStep } from "@/lib/study-shared";

/**
 * Where the participant is in the guided session.
 *
 * The session is guided by its destination rather than its route: both modes,
 * then one comparison. Which to try first is the participant's choice, either
 * may be run again, and the comparison opens once each has been used at least
 * once. Stating that plainly is also what makes the choice real — somebody who
 * does not know a second system is coming cannot sensibly decide which to meet
 * first.
 */
export default function StudyBanner({
  completed,
  suggestedOrder,
  canFinish,
  resumeStepId,
}: {
  completed: Record<StudyMode, number>;
  suggestedOrder: StudyOrder;
  canFinish: boolean;
  resumeStepId: string | null;
}) {
  const started = completed.ONE_CLICK + completed.HUMAN_CENTERED > 0;
  const suggested = modeForStep(suggestedOrder, 1);

  const runs = (mode: StudyMode) => {
    const n = completed[mode];
    if (n === 0) return "not tried yet";
    return n === 1 ? "used once" : `used ${n} times`;
  };

  return (
    <section className="mb-8 border border-accent/40 bg-accent-soft p-5">
      <p className="label-caps !text-accent">Guided session</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        You will use two systems and then answer a short comparison. Start with
        whichever you prefer, and run either of them as many times as you like —
        the comparison opens once you have used both.
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {(["HUMAN_CENTERED", "ONE_CLICK"] as StudyMode[]).map((mode) => (
          <div key={mode} className="flex items-baseline gap-2">
            <dt className="font-semibold text-foreground">
              {MODE_LABEL[mode]}
            </dt>
            <dd
              className={
                completed[mode] > 0 ? "text-success" : "text-muted-foreground"
              }
            >
              {runs(mode)}
            </dd>
          </div>
        ))}
      </dl>

      {!started && (
        <p className="mt-3 text-sm text-muted-foreground">
          No preference? {MODE_LABEL[suggested]} is the suggested starting
          point, but either is fine.
        </p>
      )}

      {resumeStepId && (
        <p className="mt-3 text-sm">
          <Link
            href={`/review/${resumeStepId}`}
            className="font-semibold text-accent underline-offset-2 hover:underline"
          >
            Resume the review you already started
          </Link>
        </p>
      )}

      {canFinish && (
        <div className="mt-4 border-t border-accent/30 pt-4">
          <p className="text-sm leading-relaxed text-foreground">
            You have used both. Try either again if you want to, or go on to the
            comparison whenever you are ready.
          </p>
          <Link
            href="/study/feedback"
            className="mt-3 inline-block h-10 cursor-pointer bg-primary px-5 text-sm font-semibold leading-10 tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90"
          >
            Go to the comparison
          </Link>
        </div>
      )}
    </section>
  );
}

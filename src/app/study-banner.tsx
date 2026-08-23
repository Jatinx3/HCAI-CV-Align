import Link from "next/link";
import { MODE_LABEL, type StudyMode, type StudyOrder, modeForStep } from "@/lib/study-shared";

/**
 * Where the participant is in the guided session.
 *
 * The session is guided by its destination rather than its route: both modes on
 * the reserved model, then one comparison. Which to try first is the
 * participant's choice, either may be run again on the unlimited models, and
 * the comparison opens once each has had its reserved run. Stating that plainly
 * is also what makes the choice real — somebody who does not know a second
 * system is coming cannot sensibly decide which to meet first.
 */
export default function StudyBanner({
  completed,
  reserved,
  suggestedOrder,
  canFinish,
  resumeStepId,
}: {
  completed: Record<StudyMode, number>;
  reserved: Record<StudyMode, number>;
  suggestedOrder: StudyOrder;
  canFinish: boolean;
  resumeStepId: string | null;
}) {
  const started = completed.ONE_CLICK + completed.HUMAN_CENTERED > 0;
  const suggested = modeForStep(suggestedOrder, 1);

  const runs = (mode: StudyMode) => {
    const extra = completed[mode] - reserved[mode];
    const more = `${extra} ${extra === 1 ? "run" : "runs"}`;
    if (reserved[mode] > 0) {
      return extra > 0 ? `reserved run done · ${more} more` : "reserved run done";
    }
    // Runs on the other models count as having tried it, but the sentence has
    // to keep saying what is still outstanding, or somebody reads "tried" and
    // wonders why the comparison has not opened.
    return extra > 0 ? `${more} · reserved run still to do` : "not tried yet";
  };

  return (
    <section className="mb-8 border border-accent/40 bg-accent-soft p-5">
      <p className="label-caps !text-accent">Guided session</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        You will use two systems and then answer a short comparison. Start with
        whichever you prefer. Each has one run on the reserved model — that is
        the pair the comparison asks about — and you can run either of them
        again on the unlimited models as often as you like.
      </p>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {(["HUMAN_CENTERED", "ONE_CLICK"] as StudyMode[]).map((mode) => (
          <div key={mode} className="flex items-baseline gap-2">
            <dt className="font-semibold text-foreground">
              {MODE_LABEL[mode]}
            </dt>
            <dd
              className={
                reserved[mode] > 0 ? "text-success" : "text-muted-foreground"
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
        <p className="mt-4 border-t border-accent/30 pt-4 text-sm leading-relaxed text-foreground">
          You have used both on the reserved model. Try either again on the
          unlimited models if you want to, or go on to the comparison — the
          button for it is at the end of this page.
        </p>
      )}
    </section>
  );
}

/**
 * The way out of the session, placed where the participant actually is.
 *
 * This used to be a button inside the banner at the top of the page. By the
 * time it appears, the participant has just finished a rewrite and is at the
 * bottom of a long page — so the one control they need next was a full screen
 * above them, and finishing the study meant scrolling back up to look for
 * something they had no reason to expect there. Rendered after the upload form
 * instead, it is the next thing they see.
 */
export function StudyFinishPrompt() {
  return (
    <section className="mt-12 border border-accent/40 bg-accent-soft p-5">
      <p className="label-caps !text-accent">Both parts done</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground">
        You have used both systems on the reserved model. Run either of them
        again on the unlimited models if you want to, or go on to the short
        comparison whenever you are ready.
      </p>
      <Link
        href="/study/feedback"
        className="mt-4 inline-block h-11 cursor-pointer bg-primary px-6 font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90"
      >
        Go to the comparison
      </Link>
    </section>
  );
}

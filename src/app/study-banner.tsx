import Link from "next/link";
import { MODE_LABEL, type StudyMode } from "@/lib/study-shared";

/**
 * Where the participant is in the guided session.
 *
 * The order is stated plainly rather than hidden. A participant who is told
 * they will use both systems, and which one they are on now, is not being
 * deceived about the comparison they are part of, and knowing there is a
 * second part stops the first being judged as if it were the whole study.
 */
export default function StudyBanner({
  stepIndex,
  mode,
  resumeStepId,
}: {
  stepIndex: 1 | 2;
  mode: StudyMode;
  resumeStepId: string | null;
}) {
  return (
    <section className="mb-8 border border-accent/40 bg-accent-soft p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="label-caps !text-accent">
          Guided session · Part {stepIndex} of 2
        </p>
        <h2 className="font-serif text-lg font-semibold text-foreground">
          {MODE_LABEL[mode]}
        </h2>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {stepIndex === 1
          ? "You will tailor a CV twice, once with each of two systems, and then answer a short comparison. The order was assigned by the app, not chosen."
          : "This is the second of the two systems. After it you will be asked to compare them."}{" "}
        {mode === "ONE_CLICK"
          ? "This one rewrites the whole CV in a single step and downloads it."
          : "This one proposes changes one at a time, with a reason for each, and applies nothing until you accept it."}
      </p>
      {resumeStepId && (
        <p className="mt-3 text-sm">
          <Link
            href={`/review/${resumeStepId}`}
            className="font-semibold text-accent underline-offset-2 hover:underline"
          >
            Resume the part you already started
          </Link>
        </p>
      )}
    </section>
  );
}

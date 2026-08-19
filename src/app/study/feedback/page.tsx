import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { studyState, MODE_LABEL, modeForStep } from "@/lib/study";
import { recordEvent } from "@/lib/telemetry";
import PreferenceForm from "./preference-form";

/**
 * The single comparative feedback handoff.
 *
 * The study asks for one comparative judgement, made once, after both systems
 * have been used. The form itself lives outside this application: reproducing
 * it here would mean collecting the study's own outcome measures through the
 * artefact being measured, and a participant would answer questions about
 * trust inside the thing they are being asked to trust.
 *
 * What the application records is that the participant arrived, and, as a
 * local backup against the external form failing, the forced-choice preference
 * on its own.
 */
export default async function FeedbackPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.studyParticipant) redirect("/");

  const state = await studyState(session.user.id);
  if (!state.finished) redirect("/");

  // Reaching this page is the handoff. Recorded once; a reload does not
  // overwrite the time the participant first got here.
  const current = await prisma.studySession.findUnique({
    where: { id: state.sessionId },
    select: { feedbackHandoffReachedAt: true, localPreference: true },
  });
  if (!current?.feedbackHandoffReachedAt) {
    await prisma.studySession.update({
      where: { id: state.sessionId },
      data: { feedbackHandoffReachedAt: new Date() },
    });
    await recordEvent({
      userId: session.user.id,
      type: "handoff_reached",
      studySessionId: state.sessionId,
      payload: { order: state.order, formConfigured: Boolean(process.env.STUDY_FEEDBACK_FORM_URL) },
    });
  }

  const formUrl = process.env.STUDY_FEEDBACK_FORM_URL;
  const first = modeForStep(state.order, 1);
  const second = modeForStep(state.order, 2);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-1 bg-accent" aria-hidden="true" />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <p className="truncate font-serif text-lg font-semibold tracking-tight text-foreground">
            CV <span className="text-accent">·</span> JD{" "}
            <span className="font-normal italic">Alignment Assistant</span>
          </p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="h-9 cursor-pointer border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
        <p className="label-caps">Both parts complete</p>
        <h1 className="mt-2 font-serif text-[2.25rem] font-semibold leading-[1.15] tracking-tight text-foreground">
          One last step
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          You tailored your CV twice: first with{" "}
          <strong className="font-semibold text-foreground">
            {MODE_LABEL[first]}
          </strong>
          , then with{" "}
          <strong className="font-semibold text-foreground">
            {MODE_LABEL[second]}
          </strong>
          . The last step is a short form comparing the two. It is hosted
          outside this app, so your answers are not tied to what you did here
          beyond the account you signed in with.
        </p>

        <div className="mt-8 border border-border bg-surface p-5 sm:p-6">
          {formUrl ? (
            <>
              <p className="text-sm leading-relaxed text-foreground">
                The form takes about five minutes. It asks which system you
                preferred and why, and how the two compared on trust, control,
                transparency and authenticity.
              </p>
              <a
                href={formUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block h-11 cursor-pointer bg-primary px-6 font-semibold leading-[2.75rem] tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90"
              >
                Open the feedback form
              </a>
            </>
          ) : (
            <>
              <p className="font-semibold text-foreground">
                The feedback form is not configured yet
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Ask the researcher for the link. Your two tailoring sessions are
                already recorded, so nothing is lost.
              </p>
            </>
          )}
        </div>

        <PreferenceForm
          sessionId={state.sessionId}
          saved={current?.localPreference ?? null}
        />

        <p className="mt-10 text-sm text-faint-foreground">
          Finished with the app?{" "}
          <Link href="/" className="text-accent underline-offset-2 hover:underline">
            Back to the start
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

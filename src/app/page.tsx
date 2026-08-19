import { auth, signOut } from "@/lib/auth";
import { studyState } from "@/lib/study";
import UploadForm from "./upload-form";
import StudyBanner from "./study-banner";

export default async function Home() {
  const session = await auth();

  /**
   * A study participant is shown where they are in the session and decides
   * what to do next; a general user sees none of it. The session opens on
   * first arrival so a suggested order exists before any work is done, and
   * nothing here redirects: being sent to the comparison the moment the second
   * mode finishes would take away the "run it again" the session promises.
   */
  const study =
    session?.user?.studyParticipant && session.user.id
      ? await studyState(session.user.id)
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-1 bg-accent" aria-hidden="true" />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate font-serif text-lg font-semibold tracking-tight text-foreground">
              CV <span className="text-accent">·</span> JD{" "}
              <span className="font-normal italic">Alignment Assistant</span>
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {session?.user.email}
              {session?.user.studyParticipant && (
                <span className="ml-2 border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">
                  study participant
                </span>
              )}
            </p>
          </div>
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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-12 max-w-2xl">
          <p className="label-caps">Tailoring, on your terms</p>
          <h1 className="mt-2 font-serif text-[2.5rem] font-semibold leading-[1.15] tracking-tight text-foreground">
            Align your CV with a job description
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            Upload your CV and paste the job description you’re applying for.
            The assistant helps you present what’s already there —{" "}
            <em className="font-serif">honestly</em>.
          </p>
        </div>
        {study && (
          <StudyBanner
            completed={study.completed}
            suggestedOrder={study.suggestedOrder}
            canFinish={study.canFinish}
            resumeStepId={study.resumeStepId}
          />
        )}
        <UploadForm studyParticipant={Boolean(study)} />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
          <p className="text-sm text-faint-foreground">
            MSc research prototype. Your CV and interactions are stored for
            research only.
          </p>
        </div>
      </footer>
    </div>
  );
}

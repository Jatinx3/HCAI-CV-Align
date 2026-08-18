import { notFound } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSections } from "@/lib/sections";
import ReviewClient from "./review-client";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ stepId: string }>;
}) {
  const { stepId } = await params;
  const session = await auth();
  if (!session?.user) notFound();

  const step = await prisma.modeStep.findFirst({
    where: { id: stepId, userId: session.user.id },
    include: { cvDocument: true },
  });
  if (!step?.cvDocument || !step.jdText) notFound();

  const sections = parseSections(step.cvDocument.extractedText);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-1 bg-accent" aria-hidden="true" />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate font-serif text-lg font-semibold tracking-tight text-foreground">
              <Link href="/" className="hover:underline underline-offset-4">
                CV <span className="text-accent">·</span> JD{" "}
                <span className="font-normal italic">Alignment Assistant</span>
              </Link>
            </p>
            <p className="truncate text-sm text-muted-foreground">
              Reviewing {step.cvFileName} · {session.user.email}
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

      <ReviewClient
        stepId={step.id}
        cvId={step.cvDocument.id}
        jdText={step.jdText}
        initialSections={sections}
        format={step.cvDocument.format}
        guided={step.studySessionId !== null}
      />
    </div>
  );
}

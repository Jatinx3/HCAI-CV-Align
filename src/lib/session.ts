import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Resolve the signed-in user, verifying the account still exists.
 *
 * A JWT stays valid after the account it names is gone — the database is
 * reprovisioned, a participant record is removed between sessions. The token
 * still passes middleware, so the request reaches a route handler and only
 * fails deep inside Prisma as a foreign-key violation, which surfaces to the
 * participant as an unexplained failure. Checking here turns that into an
 * honest "sign in again".
 */
export type SessionUser = {
  id: string;
  email: string;
  studyParticipant: boolean;
};

export type AuthOutcome =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401; error: string };

export async function requireUser(): Promise<AuthOutcome> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, studyParticipant: true },
  });
  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "Your session refers to an account that no longer exists. Sign out and sign in again.",
    };
  }

  return { ok: true, user };
}

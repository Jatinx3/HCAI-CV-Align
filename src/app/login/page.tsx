"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

/**
 * Where to land after signing in — a path on this site, never a URL.
 *
 * Auth.js writes the callback into the query string when it bounces someone to
 * the login page, and behind a reverse proxy it built that from the address the
 * server binds to rather than the address the participant typed: signing in
 * sent them to https://0.0.0.0:3000/, which resolves to nothing.
 *
 * Only the path is kept, and only when it looks like a path. A query parameter
 * is under the control of whoever sends the link, so anything else in there is
 * either wrong or an attempt to bounce a participant off the study onto another
 * site with a convincing referrer.
 */
function safeCallback(raw: string | null): string {
  if (!raw) return "/";
  // A protocol-relative "//evil.example" is a URL, not a path, despite starting
  // with a slash.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    // "javascript:alert(1)" is a URL that parses quite happily, with a pathname
    // of "alert(1)"; without this it would come back out as a relative path.
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") ? path : "/";
  } catch {
    return "/";
  }
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallback(searchParams.get("callbackUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      setError(
        "That email and password don’t match an account. Check both and try again.",
      );
      setSubmitting(false);
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="border-t-2 border-accent pt-6">
          <p className="label-caps">MSc research study</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.15] tracking-tight text-foreground">
            CV <span className="text-accent">·</span> JD{" "}
            <span className="font-normal italic">Alignment Assistant</span>
          </h1>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            A research prototype for the MSc in Human-Centred AI at TU Dublin.
            It compares two ways of tailoring a CV to a job description.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-10 flex flex-col gap-5 border border-border bg-surface p-7 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="label-caps !text-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 border border-border-strong bg-surface px-3 text-base text-foreground transition-colors duration-150 focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="label-caps !text-foreground">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 border border-border-strong bg-surface px-3 text-base text-foreground transition-colors duration-150 focus:border-accent"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm leading-relaxed text-danger"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 h-11 cursor-pointer bg-primary font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm leading-relaxed text-faint-foreground">
          Accounts are set up by the researcher — there is no public sign-up.
          Contact them if you need access.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

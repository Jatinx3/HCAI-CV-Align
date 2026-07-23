"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
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
          <p className="label-caps">Research prototype</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.15] tracking-tight text-foreground">
            Your CV,{" "}
            <em className="font-normal italic text-accent">aligned</em> —<br />
            never invented.
          </h1>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Tailor your CV to a job description with every change explained and
            you in control of each one.
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

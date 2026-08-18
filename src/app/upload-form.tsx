"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CvPaper from "@/components/cv-paper";

type UploadResult = {
  id: string;
  fileName: string;
  format: string;
  extractedText: string;
  reformatNotice: string | null;
};

const FORMAT_FIDELITY: Record<string, string> = {
  tex: "LaTeX source — your formatting is preserved exactly on export.",
  docx: "Word document — styles are preserved; minor reflow possible on export.",
  pdf: "PDF — changes are edited into your own file, keeping your design; a change that cannot fit falls back to a clean template.",
};

const PRINCIPLES = [
  {
    n: "01",
    title: "Every change explained",
    text: "Each suggestion names the exact job-description requirement it addresses.",
  },
  {
    n: "02",
    title: "You decide everything",
    text: "Nothing is applied automatically — you accept, reject, or edit each change.",
  },
  {
    n: "03",
    title: "Nothing invented",
    text: "The assistant only rephrases what your CV already says. It never adds skills or experience.",
  },
];

function IconFile({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function IconAlert({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export default function UploadForm({
  guidedMode,
}: {
  /**
   * In a guided study session, the mode assigned for the step the participant
   * is on. Only that mode is offered: the order is the experimental control
   * and is not the participant's to choose.
   */
  guidedMode?: "ONE_CLICK" | "HUMAN_CENTERED";
} = {}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [jdText, setJdText] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  type FormError = { title: string; detail: string; retry?: () => void };
  const [error, setError] = useState<FormError | null>(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [oneClicking, setOneClicking] = useState(false);
  const [oneClickNote, setOneClickNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<"document" | "text" | "original">(
    "document",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function startHumanCentered() {
    if (!result) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/mode-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cvId: result.id,
          jdText,
          mode: "HUMAN_CENTERED",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError({
          title: "Couldn\u2019t start the review",
          detail: json.error ?? "Could not start the review.",
          retry: startHumanCentered,
        });
        setStarting(false);
        return;
      }
      router.push(`/review/${json.id}`);
    } catch {
      setError({
        title: "Couldn\u2019t start the review",
        detail: "Could not start the review. Check your connection.",
        retry: startHumanCentered,
      });
      setStarting(false);
    }
  }

  async function runOneClick() {
    if (!result) return;
    setOneClicking(true);
    setError(null);
    setOneClickNote(null);
    try {
      const res = await fetch("/api/one-click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvId: result.id, jdText }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError({
          title: "Couldn\u2019t rewrite your CV",
          detail: j.error ?? "One-click rewrite failed.",
          retry: runOneClick,
        });
        setOneClicking(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${result.fileName.replace(/\.[^.]+$/, "")}-rewritten.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setOneClickNote("Rewritten CV downloaded.");
      // In a guided session the download is the end of this step, so send the
      // participant back to the session, which decides what comes next.
      if (guidedMode) router.refresh();
    } catch {
      setError({
        title: "Couldn\u2019t rewrite your CV",
        detail: "One-click rewrite failed. Check your connection.",
        retry: runOneClick,
      });
    } finally {
      setOneClicking(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const body = new FormData();
    body.append("file", file);

    try {
      const res = await fetch("/api/cv", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError({
          title: "Couldn\u2019t read that file",
          detail: json.error ?? "Upload failed. Please try again.",
        });
      } else {
        setResult(json);
      }
    } catch {
      setError({
        title: "Couldn\u2019t read that file",
        detail: "Upload failed. Check your connection and try again.",
      });
    } finally {
      setUploading(false);
    }
  }

  function clearUpload() {
    setResult(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-12">
      {/* The design stance, stated up front — transparency about what this
          tool will and won't do, before any AI runs.

          Hidden on the one-click step of a guided session. These three claims
          describe the human-centered mode, and showing them to a participant
          about to use the baseline would sell the prototype's values while
          they judged the system that deliberately lacks them. */}
      <section
        aria-label="How this assistant works"
        className={guidedMode === "ONE_CLICK" ? "hidden" : undefined}
      >
        <div className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
          {PRINCIPLES.map((item) => (
            <div key={item.n} className="bg-surface p-5">
              <p className="font-serif text-sm italic text-accent">{item.n}</p>
              <h3 className="mt-1 font-serif text-[17px] font-semibold text-foreground">
                {item.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={handleSubmit} className="flex flex-col gap-10">
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3 border-b border-border pb-2">
            <span className="label-caps !text-accent">Step 01</span>
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              Your CV
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Accepted formats and how much of your original layout survives
            export:{" "}
            <span className="whitespace-nowrap">
              <strong className="font-mono text-xs uppercase">tex</strong> —
              exact
            </span>
            {", "}
            <span className="whitespace-nowrap">
              <strong className="font-mono text-xs uppercase">docx</strong> —
              styles kept, minor reflow
            </span>
            {", "}
            <span className="whitespace-nowrap">
              <strong className="font-mono text-xs uppercase">pdf</strong> —
              edited in place, clean template if a change will not fit
            </span>
            .
          </p>
          <label
            htmlFor="cv-file"
            className="flex cursor-pointer items-center gap-4 border-2 border-dashed border-border-strong bg-surface px-5 py-6 transition-colors duration-200 hover:border-accent"
          >
            <IconFile className="h-9 w-9 shrink-0 text-faint-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] font-semibold text-foreground">
                {file ? file.name : "Choose your CV file"}
              </span>
              <span className="text-sm text-muted-foreground">
                {file
                  ? `${(file.size / 1024).toFixed(0)} KB — click to change`
                  : "Stored only for this study, never shared."}
              </span>
            </span>
          </label>
          <input
            ref={fileInputRef}
            id="cv-file"
            type="file"
            accept=".pdf,.docx,.tex"
            required
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="sr-only"
          />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3 border-b border-border pb-2">
            <span className="label-caps !text-accent">Step 02</span>
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              The job description
            </h2>
          </div>
          <label
            htmlFor="jd"
            className="text-sm leading-relaxed text-muted-foreground"
          >
            Paste the full text of the job advert you want to tailor this CV
            against. More detail gives better-grounded suggestions.
          </label>
          <textarea
            id="jd"
            required
            rows={9}
            placeholder="Paste the job description here…"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            className="border border-border-strong bg-surface p-4 text-[15px] leading-relaxed text-foreground transition-colors duration-150 focus:border-accent"
          />
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={uploading || !file}
            className="h-11 cursor-pointer bg-primary px-7 font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50"
          >
            {uploading ? "Reading your CV…" : "Upload and read CV"}
          </button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {uploading
              ? "Extracting text — nothing is sent to the AI yet."
              : ""}
          </span>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 border-l-2 border-danger bg-danger-soft p-4"
        >
          <IconAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div>
            {/* The heading follows what actually failed. A rewrite that timed
                out is not a file that could not be read, and sending someone
                to re-check their CV over it wastes their time. */}
            <p className="font-semibold text-danger">{error.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-danger">
              {error.detail}
            </p>
            {error.retry && (
              <button
                type="button"
                onClick={error.retry}
                className="mt-3 h-9 cursor-pointer border border-danger px-4 text-sm font-semibold text-danger transition-colors duration-150 hover:bg-danger/10"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {result && (
        <section
          aria-label="What was read from your CV"
          className="flex flex-col gap-5 border border-border bg-surface p-7"
        >
          <div className="flex flex-wrap items-center gap-3">
            <IconCheck className="h-5 w-5 text-success" />
            <p className="font-semibold text-foreground">{result.fileName}</p>
            <span className="border border-accent/40 bg-accent-soft px-2 py-0.5 font-mono text-xs font-semibold uppercase text-accent">
              {result.format}
            </span>
            <button
              type="button"
              onClick={clearUpload}
              className="ml-auto cursor-pointer text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline"
            >
              Use a different file
            </button>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {FORMAT_FIDELITY[result.format]}
          </p>

          {result.reformatNotice && (
            <div className="flex items-start gap-3 border-l-2 border-warning bg-warning-soft p-3">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-sm leading-relaxed text-warning">
                {result.reformatNotice}
              </p>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="label-caps">Verification</p>
                <h3 className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground">
                  What the assistant will work from
                </h3>
              </div>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => setPreview("document")}
                  aria-pressed={preview === "document"}
                  className={`cursor-pointer border px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
                    preview === "document"
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border-strong text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Document
                </button>
                <button
                  type="button"
                  onClick={() => setPreview("text")}
                  aria-pressed={preview === "text"}
                  className={`cursor-pointer border px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
                    preview === "text"
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border-strong text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Extracted text
                </button>
                {/* A PDF can be shown exactly as it arrived. The parsed view
                    is still the default, because what the assistant will work
                    from is the thing worth checking. */}
                {result.format === "pdf" && (
                  <button
                    type="button"
                    onClick={() => setPreview("original")}
                    aria-pressed={preview === "original"}
                    className={`cursor-pointer border px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
                      preview === "original"
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border-strong text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Your file
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {preview === "document"
                ? "Your CV as the assistant has understood it. Check the sections and wording look right before continuing."
                : preview === "original"
                  ? "The file you uploaded, unchanged. Accepted changes are edited into this document, so it keeps its own design."
                  : "The exact text read from your file. If something important is missing, try a different format of your CV."}
            </p>
            {preview === "document" ? (
              <CvPaper
                text={result.extractedText}
                className="mt-3 max-h-96 border border-border"
              />
            ) : preview === "original" ? (
              // <object> falls back to its children where a browser cannot
              // render a PDF inline, so the view is never a dead end.
              <object
                data={`/api/cv/${result.id}/file`}
                type="application/pdf"
                title="Your uploaded CV"
                className="mt-3 h-96 w-full border border-border bg-[#6b6b66]"
              >
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Your browser can’t display PDFs inline.
                  </p>
                  <a
                    href={`/api/cv/${result.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="h-10 cursor-pointer bg-primary px-5 text-sm font-semibold leading-10 text-on-primary"
                  >
                    Open it in a new tab
                  </a>
                </div>
              </object>
            ) : (
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap border border-border bg-background p-4 text-[13px] leading-relaxed text-foreground">
                {result.extractedText}
              </pre>
            )}
          </div>

          <div className="border-t border-border pt-5">
            <p className="label-caps">
              {guidedMode ? "This part of the session" : "Choose how to rewrite"}
            </p>
            {!jdText.trim() && (
              <p className="mt-2 text-sm text-muted-foreground">
                Paste a job description above to continue.
              </p>
            )}
            <div
              className={`mt-3 grid gap-4 ${guidedMode ? "" : "sm:grid-cols-2"}`}
            >
              {/* Human-centered — the prototype. In a guided session only the
                  mode assigned for this step is offered; the participant does
                  not choose the order. */}
              <div
                className={`flex-col border border-border p-4 ${
                  guidedMode === "ONE_CLICK" ? "hidden" : "flex"
                }`}
              >
                <h3 className="font-serif text-lg font-semibold text-foreground">
                  Review each change
                </h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
                  See every proposed change with the reason for it, and accept,
                  edit, or reject each one. Nothing is applied without you.
                </p>
                <button
                  type="button"
                  onClick={startHumanCentered}
                  disabled={starting || !jdText.trim()}
                  className="mt-4 h-11 cursor-pointer bg-primary px-6 font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50"
                >
                  {starting ? "Opening review…" : "Review suggestions"}
                </button>
              </div>

              {/* One-click — the deliberately thin baseline. */}
              <div
                className={`flex-col border border-border p-4 ${
                  guidedMode === "HUMAN_CENTERED" ? "hidden" : "flex"
                }`}
              >
                <h3 className="font-serif text-lg font-semibold text-foreground">
                  One-click rewrite
                </h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
                  Get a fully rewritten CV in one step — no review, no
                  explanations, downloaded straight away.
                </p>
                <button
                  type="button"
                  onClick={runOneClick}
                  disabled={oneClicking || !jdText.trim()}
                  className="mt-4 h-11 cursor-pointer border border-border-strong px-6 font-semibold text-foreground transition-colors duration-150 hover:bg-background disabled:cursor-default disabled:opacity-50"
                >
                  {oneClicking ? "Rewriting…" : "Rewrite and download"}
                </button>
                {oneClickNote && (
                  <p
                    className="mt-2 text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    {oneClickNote}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

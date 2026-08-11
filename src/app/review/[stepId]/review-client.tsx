"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CvSection } from "@/lib/sections";
import { assembleCv } from "@/lib/sections";
import { wordDiff, findInJd } from "@/lib/diff";
import { applyReplacement, containsOriginal } from "@/lib/anchor";
import CvPaper from "@/components/cv-paper";
import { ValueLegend, ValueTag } from "@/components/value-tag";
import {
  CONSERVATISM_LEVELS,
  type ConservatismLevel,
  type Gap,
  type Suggestion,
} from "@/lib/suggestions";

type Decision = "pending" | "accepted" | "rejected";

/**
 * A change the user has accepted and that is now part of their working CV.
 *
 * Kept separately from the current round of suggestions on purpose. Accepted
 * changes belong to the user, not to the model run that proposed them, so
 * regenerating at a different conservatism level must not silently undo work
 * the user already approved.
 */
type AppliedEdit = {
  suggestionId: string;
  sectionId: string;
  original: string;
  replacement: string;
  jdRequirement: string;
  /** Whether the user rewrote the proposal before accepting it. */
  edited: boolean;
  /** Conservatism level in effect when this was accepted. */
  conservatism: ConservatismLevel;
};

const SECTION_LABEL: Record<string, string> = {
  summary: "Summary",
  experience: "Experience",
  skills: "Skills",
  education: "Education",
  other: "Other",
  header: "Header",
};

export default function ReviewClient({
  stepId,
  cvId,
  jdText,
  initialSections,
  format,
}: {
  stepId: string;
  cvId: string;
  jdText: string;
  initialSections: CvSection[];
  format: string;
}) {
  const [conservatism, setConservatism] = useState<ConservatismLevel>(3);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [applied, setApplied] = useState<AppliedEdit[]>([]);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Record<string, string>>({});

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    index: number;
    total: number;
    heading: string;
  } | null>(null);
  const [meta, setMeta] = useState<{
    droppedInvalid: number;
    failures: { sectionId: string; reason: string }[];
    model: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const [rail, setRail] = useState<"cv" | "jd">("cv");
  const [cvView, setCvView] = useState<"document" | "text">("document");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  /** The CV text this preview was compiled from; a later edit makes it stale. */
  const [pdfFor, setPdfFor] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [jdFocus, setJdFocus] = useState<string | null>(null);
  const jdMarkRef = useRef<HTMLElement | null>(null);

  /**
   * The working CV is derived, never mutated in place: the original sections
   * plus every accepted change, applied in order. Nothing the user has not
   * approved can reach it, and any decision can be taken back.
   */
  const workingSections = useMemo(() => {
    const working = initialSections.map((s) => ({ ...s }));
    for (const edit of applied) {
      const target = working.find((w) => w.id === edit.sectionId);
      if (!target) continue;
      target.text = applyReplacement(
        target.text,
        edit.original,
        edit.replacement,
      );
    }
    return working;
  }, [initialSections, applied]);

  const workingCv = useMemo(
    () => assembleCv(workingSections),
    [workingSections],
  );

  const decisionOf = useCallback(
    (id: string): Decision =>
      applied.some((e) => e.suggestionId === id)
        ? "accepted"
        : rejected.has(id)
          ? "rejected"
          : "pending",
    [applied, rejected],
  );

  /** A suggestion whose quoted original is no longer present cannot be applied. */
  const unappliable = useCallback(
    (s: Suggestion) => {
      if (decisionOf(s.id) === "accepted") return false;
      const section = workingSections.find((w) => w.id === s.sectionId);
      return !section || !containsOriginal(section.text, s.original);
    },
    [workingSections, decisionOf],
  );

  const acceptedCount = suggestions.filter(
    (s) => decisionOf(s.id) === "accepted",
  ).length;
  const rejectedCount = suggestions.filter(
    (s) => decisionOf(s.id) === "rejected",
  ).length;
  const pendingCount = suggestions.length - acceptedCount - rejectedCount;

  function accept(s: Suggestion, text?: string) {
    setRejected((prev) => {
      const next = new Set(prev);
      next.delete(s.id);
      return next;
    });
    setApplied((prev) => [
      ...prev.filter((e) => e.suggestionId !== s.id),
      {
        suggestionId: s.id,
        sectionId: s.sectionId,
        original: s.original,
        replacement: text ?? s.suggested,
        jdRequirement: s.jdRequirement,
        edited: text !== undefined && text !== s.suggested,
        conservatism,
      },
    ]);
  }

  function reject(s: Suggestion) {
    setApplied((prev) => prev.filter((e) => e.suggestionId !== s.id));
    setRejected((prev) => new Set(prev).add(s.id));
  }

  function undo(s: Suggestion) {
    setApplied((prev) => prev.filter((e) => e.suggestionId !== s.id));
    setRejected((prev) => {
      const next = new Set(prev);
      next.delete(s.id);
      return next;
    });
  }

  function showInJd(requirement: string) {
    setJdFocus(requirement);
    setRail("jd");
  }

  useEffect(() => {
    if (jdFocus && rail === "jd") {
      jdMarkRef.current?.scrollIntoView({ block: "center" });
    }
  }, [jdFocus, rail]);

  /**
   * Read the newline-delimited event stream, applying each section's results
   * as they arrive. Accepted changes are deliberately left untouched here.
   */
  async function generate() {
    setRunning(true);
    setError(null);
    setSuggestions([]);
    setGaps([]);
    setRejected(new Set());
    setMeta(null);
    setProgress(null);

    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvId, jdText, conservatism }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Could not generate suggestions.");
        return;
      }
      if (!res.body) {
        setError("The server returned an empty response.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          switch (event.type) {
            case "progress":
              setProgress({
                index: event.index as number,
                total: event.total as number,
                heading: event.heading as string,
              });
              break;
            case "section":
              setSuggestions((prev) => [
                ...prev,
                ...(event.suggestions as Suggestion[]),
              ]);
              setGaps((prev) => [...prev, ...(event.gaps as Gap[])]);
              break;
            case "fatal":
              setError(event.error as string);
              break;
            case "done":
              setMeta({
                droppedInvalid: event.droppedInvalid as number,
                failures: event.failures as {
                  sectionId: string;
                  reason: string;
                }[],
                model: event.model as string,
              });
              break;
          }
        }
      }
    } catch {
      setError("Lost connection while analysing. Your accepted changes are safe.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  /**
   * Compile the real PDF and show it inline. Deliberately omits stepId: this
   * is a preview, and previewing must not record the participant as having
   * finished the step.
   */
  async function previewPdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cvId,
          replacements: applied.map((e) => ({
            original: e.original,
            replacement: e.replacement,
          })),
          fullText: workingCv,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setPdfError(j.error ?? "Could not build the preview.");
        return;
      }
      const blob = await res.blob();
      setPdfUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setPdfFor(workingCv);
    } catch {
      setPdfError("Could not build the preview. Check your connection.");
    } finally {
      setPdfLoading(false);
    }
  }

  function closePdf() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setPdfFor(null);
  }

  // A preview compiled before the latest decision would misrepresent the CV.
  const pdfCurrent = pdfUrl !== null && pdfFor === workingCv;

  async function exportPdf() {
    setExporting(true);
    setExportNote(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cvId,
          stepId,
          conservatism,
          replacements: applied.map((e) => ({
            original: e.original,
            replacement: e.replacement,
          })),
          fullText: workingCv,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setExportNote(j.error ?? "Export failed.");
        return;
      }
      const unplaced = Number(res.headers.get("X-Unplaced-Count") ?? "0");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cv-aligned.pdf";
      a.click();
      URL.revokeObjectURL(url);
      setExportNote(
        unplaced > 0
          ? `Downloaded. ${unplaced} accepted change${unplaced === 1 ? "" : "s"} could not be placed back into your original layout and ${unplaced === 1 ? "is" : "are"} missing from the PDF.`
          : "Downloaded.",
      );
    } catch {
      setExportNote("Export failed. Check your connection.");
    } finally {
      setExporting(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Suggestion[]>();
    for (const s of suggestions) {
      const list = map.get(s.sectionId) ?? [];
      list.push(s);
      map.set(s.sectionId, list);
    }
    return map;
  }, [suggestions]);

  const gapsBySection = useMemo(() => {
    const map = new Map<string, Gap[]>();
    for (const g of gaps) {
      const list = map.get(g.sectionId) ?? [];
      list.push(g);
      map.set(g.sectionId, list);
    }
    return map;
  }, [gaps]);

  const level = CONSERVATISM_LEVELS.find((l) => l.value === conservatism)!;
  const hasRun = meta !== null || suggestions.length > 0;

  return (
    <>
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 pb-28 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10 lg:pb-10">
        {/* ── Suggestions column ─────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-8">
          <section className="border border-border bg-surface p-5 sm:p-6">
            <p className="label-caps">Step 03</p>
            <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-foreground">
              Review suggestions
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Each suggestion names the job-description requirement it addresses
              and why it helps. Nothing changes your CV until you accept it, and
              you can undo any decision.
            </p>

            <ValueLegend />

            <div className="mt-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label
                  htmlFor="conservatism"
                  className="label-caps !text-foreground"
                >
                  How assertive should suggestions be?
                </label>
                <ValueTag id="control" />
              </div>
              <input
                id="conservatism"
                type="range"
                min={1}
                max={5}
                step={1}
                value={conservatism}
                disabled={running}
                onChange={(e) =>
                  setConservatism(Number(e.target.value) as ConservatismLevel)
                }
                className="mt-3 w-full accent-[var(--accent)] disabled:opacity-50"
                aria-describedby="conservatism-hint"
              />
              <div className="mt-1 flex justify-between text-xs text-faint-foreground">
                <span>Conservative</span>
                <span>Assertive</span>
              </div>
              <p id="conservatism-hint" className="mt-2 text-sm text-foreground">
                <strong>{level.label}</strong>{" "}
                <span className="text-muted-foreground">— {level.hint}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
                <ValueTag id="authenticity" />
                <span>
                  At every level the assistant may only rework what your CV
                  already says.
                </span>
              </p>
            </div>

            <button
              onClick={generate}
              disabled={running}
              className="mt-5 h-11 w-full cursor-pointer bg-primary px-6 font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50 sm:w-auto"
            >
              {running
                ? "Analysing…"
                : hasRun
                  ? "Regenerate at this level"
                  : "Get suggestions"}
            </button>

            {running && progress && (
              <div className="mt-4" aria-live="polite">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-foreground">
                    Analysing{" "}
                    <strong className="font-semibold">{progress.heading}</strong>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {progress.index + 1} of {progress.total}
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden bg-border"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.index}
                  aria-label="Sections analysed"
                >
                  <div
                    className="h-full bg-accent transition-[width] duration-300"
                    style={{
                      width: `${(progress.index / progress.total) * 100}%`,
                    }}
                  />
                </div>
                <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-xs leading-relaxed text-muted-foreground">
                  <ValueTag id="usability" />
                  <span>
                    Sections are analysed one at a time against the job
                    description. Results appear as each one finishes.
                  </span>
                </p>
              </div>
            )}

            {hasRun && !running && (
              <>
                <p
                  className="mt-3 text-sm text-muted-foreground"
                  aria-live="polite"
                >
                  Regenerating proposes a fresh set at the new level. Changes you
                  have already accepted stay in your working CV.
                </p>
                <p className="mt-2 hidden text-xs text-faint-foreground sm:block">
                  With a suggestion focused: <Key>A</Key> accept, <Key>E</Key>{" "}
                  edit, <Key>R</Key> reject, <Key>U</Key> undo.
                </p>
              </>
            )}
          </section>

          {error && (
            <div
              role="alert"
              className="border-l-2 border-danger bg-danger-soft p-4"
            >
              <p className="font-semibold text-danger">
                Couldn’t generate suggestions
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-danger">
                {error}
              </p>
              <button
                onClick={generate}
                className="mt-3 h-9 cursor-pointer border border-danger px-4 text-sm font-semibold text-danger transition-colors duration-150 hover:bg-danger/10"
              >
                Try again
              </button>
            </div>
          )}

          {meta && (meta.droppedInvalid > 0 || meta.failures.length > 0) && (
            <div className="border-l-2 border-warning bg-warning-soft p-4 text-sm leading-relaxed text-warning">
              {meta.droppedInvalid > 0 && (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <ValueTag id="transparency" />
                  <span>
                  {meta.droppedInvalid} proposed change
                  {meta.droppedInvalid === 1 ? " was" : "s were"} discarded for
                  not meeting the transparency rules — a suggestion must quote
                  your real text, explain itself, and cite a job-description
                  requirement.
                  </span>
                </p>
              )}
              {meta.failures.length > 0 && (
                <p className={meta.droppedInvalid > 0 ? "mt-1" : ""}>
                  {meta.failures.length} section
                  {meta.failures.length === 1 ? "" : "s"} could not be analysed:{" "}
                  {meta.failures[0].reason}
                </p>
              )}
            </div>
          )}

          {!hasRun && !running && !error && (
            <div className="border border-dashed border-border-strong bg-surface p-8 text-center">
              <p className="font-serif text-lg font-semibold text-foreground">
                Nothing analysed yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
                Choose how assertive you want the assistant to be, then ask for
                suggestions. Your CV is not changed until you accept something.
              </p>
              <ValueTag id="control" className="mt-3" />
            </div>
          )}

          {hasRun && suggestions.length === 0 && !running && (
            <div className="border border-border bg-surface p-6">
              <p className="font-serif text-lg font-semibold text-foreground">
                No suggestions for this job description
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                At this level the assistant found nothing it could improve
                without inventing content. Try a more assertive level, or a job
                description with more detail.
              </p>
              <ValueTag id="authenticity" className="mt-3" />
            </div>
          )}

          {[...grouped.entries()].map(([sectionId, list]) => {
            const section = initialSections.find((s) => s.id === sectionId);
            const sectionGaps = gapsBySection.get(sectionId) ?? [];
            return (
              <section key={sectionId} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2">
                  <span className="label-caps !text-accent">
                    {SECTION_LABEL[section?.kind ?? "other"] ?? "Section"}
                  </span>
                  <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    {section?.heading || "Section"}
                  </h2>
                  <span className="ml-auto text-sm text-muted-foreground">
                    {list.length} suggestion{list.length === 1 ? "" : "s"}
                  </span>
                </div>

                {list.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    decision={decisionOf(s.id)}
                    appliedEdit={applied.find((e) => e.suggestionId === s.id)}
                    editingText={editing[s.id]}
                    unappliable={unappliable(s)}
                    onShowInJd={() => showInJd(s.jdRequirement)}
                    onStartEdit={() =>
                      setEditing((p) => ({
                        ...p,
                        [s.id]:
                          applied.find((e) => e.suggestionId === s.id)
                            ?.replacement ?? s.suggested,
                      }))
                    }
                    onEditChange={(v) =>
                      setEditing((p) => ({ ...p, [s.id]: v }))
                    }
                    onCancelEdit={() =>
                      setEditing((p) => {
                        const n = { ...p };
                        delete n[s.id];
                        return n;
                      })
                    }
                    onSaveEdit={() => {
                      accept(s, editing[s.id]);
                      setEditing((p) => {
                        const n = { ...p };
                        delete n[s.id];
                        return n;
                      });
                    }}
                    onAccept={() => accept(s)}
                    onReject={() => reject(s)}
                    onUndo={() => undo(s)}
                  />
                ))}

                {sectionGaps.length > 0 && (
                  <div className="border border-dashed border-border-strong bg-background p-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="label-caps">Not evidenced in this section</p>
                      <ValueTag id="authenticity" />
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      The assistant will not invent these. Add them yourself
                      only if they are genuinely true of you.
                    </p>
                    <ul className="mt-3 flex flex-col gap-2">
                      {sectionGaps.map((g) => (
                        <li key={g.id} className="text-sm leading-relaxed">
                          <button
                            type="button"
                            onClick={() => showInJd(g.jdRequirement)}
                            className="cursor-pointer border border-border-strong bg-surface px-2 py-0.5 text-left text-xs font-semibold text-foreground transition-colors duration-150 hover:border-accent"
                          >
                            {g.jdRequirement}
                          </button>
                          <span className="ml-2 text-muted-foreground">
                            {g.note}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* ── Right rail: working CV / job description ────────── */}
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:h-fit">
          <div className="border border-border bg-surface">
            <div
              className="flex border-b border-border"
              role="tablist"
              aria-label="Reference panel"
            >
              <RailTab
                active={rail === "cv"}
                onClick={() => setRail("cv")}
                label="Your working CV"
              />
              <RailTab
                active={rail === "jd"}
                onClick={() => setRail("jd")}
                label="Job description"
              />
            </div>

            {rail === "cv" ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2">
                  <ValueTag id="control" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {applied.length === 0
                      ? "Unchanged so far. Your original is never overwritten."
                      : `${applied.length} change${applied.length === 1 ? "" : "s"} applied.`}
                  </p>
                  <div className="ml-auto flex gap-1">
                    <ViewToggle
                      active={cvView === "document"}
                      onClick={() => setCvView("document")}
                      label="Document"
                    />
                    <ViewToggle
                      active={cvView === "text"}
                      onClick={() => setCvView("text")}
                      label="Text"
                    />
                  </div>
                </div>

                {cvView === "document" ? (
                  <CvPaper
                    text={workingCv}
                    highlights={applied.map((e) => e.replacement)}
                    className="max-h-[50vh]"
                  />
                ) : (
                  <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed text-foreground">
                    {workingCv}
                  </pre>
                )}

                <div className="border-t border-border px-5 py-3">
                  <p className="text-xs leading-relaxed text-faint-foreground">
                    {format === "pdf"
                      ? "This preview matches the clean template your PDF upload is re-laid out into on export."
                      : format === "tex"
                        ? "A reading preview. On export, changes are spliced into your original LaTeX source, so the downloaded PDF keeps your own formatting."
                        : "A reading preview. On export, changes are written back into your original Word file, so the downloaded PDF keeps your own styles."}
                  </p>
                  <button
                    onClick={previewPdf}
                    disabled={pdfLoading}
                    className="mt-2 h-9 cursor-pointer border border-border-strong px-3 text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-background disabled:cursor-default disabled:opacity-50"
                  >
                    {pdfLoading ? "Building exact PDF…" : "See the exact PDF"}
                  </button>
                  {pdfError && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      {pdfError}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <JdPanel
                jdText={jdText}
                focus={jdFocus}
                markRef={jdMarkRef}
                onClear={() => setJdFocus(null)}
              />
            )}
          </div>
          <p className="text-xs text-faint-foreground">
            Session {stepId.slice(-8)}
            {meta && <span className="ml-2 font-mono">{meta.model}</span>}
          </p>
        </aside>
      </main>

      {/* ── Sticky decision + export bar ────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-sm lg:sticky">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              <strong className="text-foreground">{applied.length}</strong>{" "}
              applied
            </span>
            {hasRun && (
              <>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{rejectedCount}</strong>{" "}
                  rejected
                </span>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{pendingCount}</strong>{" "}
                  undecided
                </span>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {exportNote && (
              <p
                className="hidden max-w-xs text-xs leading-relaxed text-muted-foreground sm:block"
                aria-live="polite"
              >
                {exportNote}
              </p>
            )}
            <button
              onClick={exportPdf}
              disabled={exporting}
              className="h-10 cursor-pointer bg-primary px-5 text-sm font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50"
            >
              {exporting ? "Building PDF…" : "Download as PDF"}
            </button>
          </div>
          {exportNote && (
            <p
              className="w-full text-xs leading-relaxed text-muted-foreground sm:hidden"
              aria-live="polite"
            >
              {exportNote}
            </p>
          )}
        </div>
      </div>

      {/* The real compiled PDF, shown rather than downloaded. */}
      {pdfCurrent && pdfUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Exact PDF preview"
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 sm:p-8"
          onClick={closePdf}
        >
          <div
            className="mx-auto flex h-full w-full max-w-4xl flex-col border border-border bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-5 py-3">
              <div>
                <p className="label-caps">Exact output</p>
                <p className="text-sm text-muted-foreground">
                  Compiled through the same pipeline as your download.
                </p>
              </div>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto h-9 cursor-pointer border border-border-strong px-4 text-sm font-semibold leading-9 text-foreground transition-colors duration-150 hover:bg-background"
              >
                Open in new tab
              </a>
              <button
                onClick={closePdf}
                className="h-9 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
              >
                Close
              </button>
            </div>
            {/* <object> degrades to its children when a browser cannot render
                PDFs inline, so the preview never becomes a dead end. */}
            <object
              data={pdfUrl}
              type="application/pdf"
              title="Exact PDF preview"
              className="min-h-0 flex-1 bg-[#6b6b66]"
            >
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Your browser can’t display PDFs inline.
                </p>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="h-10 cursor-pointer bg-primary px-5 text-sm font-semibold leading-10 text-on-primary transition-opacity duration-150 hover:opacity-90"
                >
                  Open the PDF in a new tab
                </a>
              </div>
            </object>
          </div>
        </div>
      )}
    </>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer border px-2 py-0.5 text-[11px] font-semibold transition-colors duration-150 ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border-strong text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border border-border-strong bg-background px-1 font-mono text-[10px] font-semibold text-muted-foreground">
      {children}
    </kbd>
  );
}

function RailTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 cursor-pointer px-4 py-3 text-sm font-semibold transition-colors duration-150 ${
        active
          ? "border-b-2 border-accent text-foreground"
          : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/** The job description, with the cited requirement highlighted in place. */
function JdPanel({
  jdText,
  focus,
  markRef,
  onClear,
}: {
  jdText: string;
  focus: string | null;
  markRef: React.RefObject<HTMLElement | null>;
  onClear: () => void;
}) {
  const span = focus ? findInJd(jdText, focus) : null;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-5 py-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {focus
            ? span
              ? "Highlighted: the requirement this suggestion cites."
              : "That requirement is a paraphrase — no exact match in the text."
            : "The job description your CV is being aligned against."}
        </p>
        {focus && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto shrink-0 cursor-pointer text-xs font-semibold text-accent underline-offset-2 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed text-foreground">
        {span ? (
          <>
            {jdText.slice(0, span.start)}
            <mark
              ref={markRef as React.RefObject<HTMLElement>}
              className="bg-accent-soft font-semibold text-accent"
            >
              {jdText.slice(span.start, span.end)}
            </mark>
            {jdText.slice(span.end)}
          </>
        ) : (
          jdText
        )}
      </pre>
    </>
  );
}

/** Word-level diff of the proposed change. */
function DiffView({ original, suggested }: { original: string; suggested: string }) {
  const ops = useMemo(
    () => wordDiff(original, suggested),
    [original, suggested],
  );
  return (
    <p className="text-sm leading-relaxed text-foreground">
      {ops.map((op, i) =>
        op.kind === "equal" ? (
          <span key={i}>{op.text}</span>
        ) : op.kind === "delete" ? (
          <del
            key={i}
            className="bg-danger-soft text-danger decoration-danger/50"
          >
            {op.text}
          </del>
        ) : (
          <ins
            key={i}
            className="bg-accent-soft font-medium text-accent no-underline"
          >
            {op.text}
          </ins>
        ),
      )}
    </p>
  );
}

function SuggestionCard({
  suggestion: s,
  decision,
  appliedEdit,
  editingText,
  unappliable,
  onShowInJd,
  onStartEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
  onAccept,
  onReject,
  onUndo,
}: {
  suggestion: Suggestion;
  decision: Decision;
  appliedEdit?: AppliedEdit;
  editingText?: string;
  unappliable: boolean;
  onShowInJd: () => void;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  const isEditing = editingText !== undefined;
  const applied = appliedEdit?.replacement ?? s.suggested;
  const decided = decision !== "pending";

  /**
   * Keyboard shortcuts act on the focused card only, and never while the user
   * is typing in the edit box — a global handler would swallow real input.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    if (isEditing) return;
    const target = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if (k === "a" && !decided) {
      e.preventDefault();
      onAccept();
    } else if (k === "r" && !decided) {
      e.preventDefault();
      onReject();
    } else if (k === "e" && !decided) {
      e.preventDefault();
      onStartEdit();
    } else if (k === "u" && decided) {
      e.preventDefault();
      onUndo();
    }
  }

  return (
    <article
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`Suggestion addressing ${s.jdRequirement}`}
      className={`border bg-surface p-4 transition-colors duration-150 sm:p-5 ${
        decision === "accepted"
          ? "border-accent"
          : decision === "rejected"
            ? "border-border opacity-60"
            : "border-border"
      }`}
    >
      {/* Transparency: the JD requirement is stated before the change itself. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps !text-accent">Addresses</span>
        <button
          type="button"
          onClick={onShowInJd}
          title="Show this requirement in the job description"
          className="cursor-pointer border border-accent/40 bg-accent-soft px-2 py-0.5 text-left text-xs font-semibold text-accent transition-colors duration-150 hover:border-accent"
        >
          {s.jdRequirement}
        </button>
        {decision === "accepted" && (
          <span className="ml-auto text-xs font-semibold text-success">
            {appliedEdit?.edited ? "Accepted (edited)" : "Accepted"}
          </span>
        )}
        {decision === "rejected" && (
          <span className="ml-auto text-xs font-semibold text-muted-foreground">
            Rejected
          </span>
        )}
      </div>

      {/* The change itself, as a diff — what actually differs, not two blocks
          of prose the user has to compare by eye. */}
      <div className="mt-4">
        <p className="label-caps">Proposed change</p>
        <div className="mt-1 border-l-2 border-border-strong pl-3">
          {isEditing ? (
            <textarea
              value={editingText}
              onChange={(e) => onEditChange(e.target.value)}
              rows={4}
              aria-label="Edit the proposed text"
              autoFocus
              className="w-full border border-accent bg-surface p-2 text-sm leading-relaxed text-foreground"
            />
          ) : (
            <DiffView original={s.original} suggested={applied} />
          )}
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
          Show your original wording
        </summary>
        <p className="mt-2 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
          {s.original}
        </p>
      </details>

      {/* Transparency: one chip covers both halves of the contract — the cited
          requirement above and the plain-language reason here. */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <ValueTag id="transparency" />
        <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why: </span>
          {s.explanation}
        </p>
      </div>

      {unappliable && (
        <p className="mt-3 border-l-2 border-warning bg-warning-soft p-2 text-xs leading-relaxed text-warning">
          Your CV no longer contains the wording this suggestion quotes — an
          earlier accepted change replaced it. It can’t be applied.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <ValueTag id="control" />
        <p className="text-xs leading-relaxed text-faint-foreground">
          {decided
            ? "Your decision, and you can take it back."
            : "Nothing is applied until you choose."}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {isEditing ? (
          <>
            <button
              onClick={onSaveEdit}
              className="h-10 cursor-pointer bg-primary px-4 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90"
            >
              Save and accept
            </button>
            <button
              onClick={onCancelEdit}
              className="h-10 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
            >
              Cancel
            </button>
          </>
        ) : decided ? (
          <button
            onClick={onUndo}
            className="h-10 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
          >
            Undo
          </button>
        ) : (
          <>
            <button
              onClick={onAccept}
              disabled={unappliable}
              className="h-10 cursor-pointer bg-primary px-4 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={onStartEdit}
              className="h-10 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
            >
              Edit
            </button>
            <button
              onClick={onReject}
              className="h-10 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-background"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </article>
  );
}

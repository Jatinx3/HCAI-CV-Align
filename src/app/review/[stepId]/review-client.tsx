"use client";

import { useMemo, useState } from "react";
import type { CvSection } from "@/lib/sections";
import { assembleCv } from "@/lib/sections";
import {
  CONSERVATISM_LEVELS,
  type ConservatismLevel,
  type Suggestion,
} from "@/lib/suggestions";

type Decision = "pending" | "accepted" | "rejected";

type SuggestionState = {
  decision: Decision;
  /** User-edited replacement text; falls back to the model's suggestion. */
  editedText?: string;
};

type ApiResponse = {
  sections: CvSection[];
  suggestions: Suggestion[];
  droppedInvalid: number;
  failures: { sectionId: string; reason: string }[];
  model: string;
  error?: string;
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
  const [states, setStates] = useState<Record<string, SuggestionState>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<{
    droppedInvalid: number;
    failures: { sectionId: string; reason: string }[];
    model: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  /**
   * The working CV is *derived*, never mutated in place: original sections
   * plus every accepted replacement, applied in order. That makes accept,
   * reject and undo fully reversible — the user can never lose their original.
   */
  const { workingSections, unappliable } = useMemo(() => {
    const unappliable: string[] = [];
    const working = initialSections.map((s) => ({ ...s }));
    for (const s of suggestions) {
      const st = states[s.id];
      if (st?.decision !== "accepted") continue;
      const target = working.find((w) => w.id === s.sectionId);
      if (!target) continue;
      const replacement = st.editedText ?? s.suggested;
      if (target.text.includes(s.original)) {
        target.text = target.text.replace(s.original, replacement);
      } else {
        unappliable.push(s.id);
      }
    }
    return { workingSections: working, unappliable };
  }, [initialSections, suggestions, states]);

  const workingCv = useMemo(
    () => assembleCv(workingSections),
    [workingSections],
  );

  const acceptedCount = suggestions.filter(
    (s) => states[s.id]?.decision === "accepted",
  ).length;
  const rejectedCount = suggestions.filter(
    (s) => states[s.id]?.decision === "rejected",
  ).length;
  const pendingCount = suggestions.length - acceptedCount - rejectedCount;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvId, jdText, conservatism }),
      });
      const json: ApiResponse = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not generate suggestions.");
        return;
      }
      setSuggestions(json.suggestions);
      setStates(
        Object.fromEntries(
          json.suggestions.map((s) => [s.id, { decision: "pending" as const }]),
        ),
      );
      setMeta({
        droppedInvalid: json.droppedInvalid,
        failures: json.failures,
        model: json.model,
      });
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function decide(id: string, decision: Decision, editedText?: string) {
    setStates((prev) => ({
      ...prev,
      [id]: { decision, editedText: editedText ?? prev[id]?.editedText },
    }));
  }

  async function exportPdf() {
    setExporting(true);
    setExportNote(null);
    try {
      const replacements = suggestions
        .filter((s) => states[s.id]?.decision === "accepted")
        .map((s) => ({
          original: s.original,
          replacement: states[s.id]?.editedText ?? s.suggested,
        }));

      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvId, replacements, fullText: workingCv }),
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
          ? `Downloaded. Note: ${unplaced} accepted change${unplaced === 1 ? "" : "s"} could not be placed back into the original layout and ${unplaced === 1 ? "is" : "are"} missing from the PDF.`
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

  const level = CONSERVATISM_LEVELS.find((l) => l.value === conservatism)!;

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ── Suggestions column ─────────────────────────────── */}
      <div className="flex flex-col gap-8">
        <section className="border border-border bg-surface p-6">
          <p className="label-caps">Step 03</p>
          <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Review suggestions
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Each suggestion below names the job-description requirement it
            addresses and why it helps. Nothing changes your CV until you accept
            it, and you can undo any decision.
          </p>

          <div className="mt-6">
            <label
              htmlFor="conservatism"
              className="label-caps !text-foreground"
            >
              How assertive should suggestions be?
            </label>
            <input
              id="conservatism"
              type="range"
              min={1}
              max={5}
              step={1}
              value={conservatism}
              onChange={(e) =>
                setConservatism(Number(e.target.value) as ConservatismLevel)
              }
              className="mt-3 w-full accent-[var(--accent)]"
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
            <p className="mt-1 text-sm text-muted-foreground">
              At every level the assistant may only rework what your CV already
              says.
            </p>
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="mt-5 h-11 cursor-pointer bg-primary px-6 font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50"
          >
            {loading
              ? "Analysing each section…"
              : suggestions.length
                ? "Regenerate at this level"
                : "Get suggestions"}
          </button>
          {loading && (
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
              Each section is analysed separately against the job description.
              This can take a minute.
            </p>
          )}
          {suggestions.length > 0 && !loading && (
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
              Regenerating replaces the current suggestions. Changes you have
              already accepted stay in your working CV.
            </p>
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
            <p className="mt-0.5 text-sm leading-relaxed text-danger">{error}</p>
          </div>
        )}

        {meta && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-border py-3 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">{acceptedCount}</strong>{" "}
              accepted
            </span>
            <span>
              <strong className="text-foreground">{rejectedCount}</strong>{" "}
              rejected
            </span>
            <span>
              <strong className="text-foreground">{pendingCount}</strong>{" "}
              undecided
            </span>
            <span className="ml-auto font-mono text-xs">{meta.model}</span>
          </div>
        )}

        {meta && (meta.droppedInvalid > 0 || meta.failures.length > 0) && (
          <div className="border-l-2 border-warning bg-warning-soft p-4 text-sm leading-relaxed text-warning">
            {meta.droppedInvalid > 0 && (
              <p>
                {meta.droppedInvalid} proposed change
                {meta.droppedInvalid === 1 ? " was" : "s were"} discarded for
                not meeting the transparency rules (a suggestion must quote your
                real text, explain itself, and cite a job-description
                requirement).
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

        {suggestions.length === 0 && meta && !loading && (
          <div className="border border-border bg-surface p-6">
            <p className="font-serif text-lg font-semibold text-foreground">
              No suggestions for this job description
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              At this conservatism level the assistant found nothing it could
              improve without inventing content. Try a more assertive level, or
              a job description with more detail.
            </p>
          </div>
        )}

        {[...grouped.entries()].map(([sectionId, list]) => {
          const section = initialSections.find((s) => s.id === sectionId);
          return (
            <section key={sectionId} className="flex flex-col gap-4">
              <div className="flex items-baseline gap-3 border-b border-border pb-2">
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
                  state={states[s.id] ?? { decision: "pending" }}
                  editingText={editing[s.id]}
                  unappliable={unappliable.includes(s.id)}
                  onStartEdit={() =>
                    setEditing((p) => ({
                      ...p,
                      [s.id]: states[s.id]?.editedText ?? s.suggested,
                    }))
                  }
                  onEditChange={(v) => setEditing((p) => ({ ...p, [s.id]: v }))}
                  onCancelEdit={() =>
                    setEditing((p) => {
                      const n = { ...p };
                      delete n[s.id];
                      return n;
                    })
                  }
                  onSaveEdit={() => {
                    decide(s.id, "accepted", editing[s.id]);
                    setEditing((p) => {
                      const n = { ...p };
                      delete n[s.id];
                      return n;
                    });
                  }}
                  onAccept={() => decide(s.id, "accepted")}
                  onReject={() => decide(s.id, "rejected")}
                  onUndo={() => decide(s.id, "pending")}
                />
              ))}
            </section>
          );
        })}
      </div>

      {/* ── Working CV column ──────────────────────────────── */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:h-fit">
        <div className="border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <p className="label-caps">Live</p>
            <h2 className="font-serif text-lg font-semibold tracking-tight text-foreground">
              Your working CV
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Updates as you accept changes. Your original is never overwritten.
            </p>
          </div>
          <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed text-foreground">
            {workingCv}
          </pre>
          <div className="border-t border-border px-5 py-4">
            <button
              onClick={exportPdf}
              disabled={exporting}
              className="h-11 w-full cursor-pointer bg-primary font-semibold tracking-wide text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-50"
            >
              {exporting ? "Building PDF…" : "Download as PDF"}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-faint-foreground">
              {format === "pdf"
                ? "Your PDF upload is re-laid out into a clean template."
                : format === "tex"
                  ? "Exported from your original LaTeX source — formatting preserved."
                  : "Exported from your original Word file — styles preserved."}
            </p>
            {exportNote && (
              <p
                className="mt-2 text-xs leading-relaxed text-foreground"
                aria-live="polite"
              >
                {exportNote}
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-faint-foreground">Session {stepId.slice(-8)}</p>
      </aside>
    </main>
  );
}

function SuggestionCard({
  suggestion: s,
  state,
  editingText,
  unappliable,
  onStartEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
  onAccept,
  onReject,
  onUndo,
}: {
  suggestion: Suggestion;
  state: SuggestionState;
  editingText?: string;
  unappliable: boolean;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  const isEditing = editingText !== undefined;
  const applied = state.editedText ?? s.suggested;
  const decided = state.decision !== "pending";

  return (
    <article
      className={`border bg-surface p-5 ${
        state.decision === "accepted"
          ? "border-accent"
          : state.decision === "rejected"
            ? "border-border opacity-60"
            : "border-border"
      }`}
    >
      {/* Transparency: the JD requirement is stated before the change itself. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps !text-accent">Addresses</span>
        <span className="border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
          {s.jdRequirement}
        </span>
        {state.decision === "accepted" && (
          <span className="ml-auto text-xs font-semibold text-success">
            {state.editedText ? "Accepted (edited)" : "Accepted"}
          </span>
        )}
        {state.decision === "rejected" && (
          <span className="ml-auto text-xs font-semibold text-muted-foreground">
            Rejected
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="label-caps">Your text</p>
          <p className="mt-1 border-l-2 border-border-strong pl-3 text-sm leading-relaxed text-muted-foreground">
            {s.original}
          </p>
        </div>
        <div>
          <p className="label-caps">Proposed</p>
          {isEditing ? (
            <textarea
              value={editingText}
              onChange={(e) => onEditChange(e.target.value)}
              rows={4}
              aria-label="Edit the proposed text"
              className="mt-1 w-full border border-accent bg-surface p-2 text-sm leading-relaxed text-foreground"
            />
          ) : (
            <p className="mt-1 border-l-2 border-accent pl-3 text-sm leading-relaxed text-foreground">
              {applied}
            </p>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Why: </span>
        {s.explanation}
      </p>

      {unappliable && (
        <p className="mt-3 border-l-2 border-warning bg-warning-soft p-2 text-xs leading-relaxed text-warning">
          This change overlaps another accepted change and can no longer be
          applied to your working CV.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {isEditing ? (
          <>
            <button
              onClick={onSaveEdit}
              className="h-9 cursor-pointer bg-primary px-4 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90"
            >
              Save and accept
            </button>
            <button
              onClick={onCancelEdit}
              className="h-9 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
            >
              Cancel
            </button>
          </>
        ) : decided ? (
          <button
            onClick={onUndo}
            className="h-9 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
          >
            Undo
          </button>
        ) : (
          <>
            <button
              onClick={onAccept}
              className="h-9 cursor-pointer bg-primary px-4 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90"
            >
              Accept
            </button>
            <button
              onClick={onStartEdit}
              className="h-9 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-background"
            >
              Edit
            </button>
            <button
              onClick={onReject}
              className="h-9 cursor-pointer border border-border-strong px-4 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-background"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </article>
  );
}

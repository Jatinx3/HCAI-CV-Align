"use client";

import { useState } from "react";
import { MODE_LABEL, type StudyMode } from "@/lib/study-shared";

/**
 * The forced-choice preference, kept locally as a backup.
 *
 * The external form is the instrument of record. This exists because a
 * participant who closes the tab before submitting it would otherwise leave no
 * comparative data at all, and the single question the analysis cannot do
 * without is which system they preferred. Optional, and marked as such.
 */
export default function PreferenceForm({
  sessionId,
  saved,
}: {
  sessionId: string;
  saved: string | null;
}) {
  const [choice, setChoice] = useState<string | null>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(mode: StudyMode) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/study/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, preference: mode }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Could not record that.");
        return;
      }
      setChoice(mode);
    } catch {
      setError("Could not record that. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 border border-dashed border-border-strong bg-background p-5">
      <p className="label-caps">Optional, and separate from the form</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        If you would rather answer one question here as well, which of the two
        did you prefer? The form above is still the one that matters.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(["HUMAN_CENTERED", "ONE_CLICK"] as StudyMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => choose(mode)}
            disabled={saving}
            aria-pressed={choice === mode}
            className={`h-10 cursor-pointer border px-4 text-sm font-semibold transition-colors duration-150 disabled:cursor-default disabled:opacity-50 ${
              choice === mode
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-strong text-foreground hover:bg-surface"
            }`}
          >
            {MODE_LABEL[mode]}
          </button>
        ))}
      </div>

      {choice && !error && (
        <p className="mt-3 text-sm text-success" aria-live="polite">
          Recorded. You can change it by choosing the other one.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

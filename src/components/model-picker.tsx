"use client";

import {
  MODEL_CATALOGUE,
  TIER_LABEL,
  TIER_ORDER,
  modelsByTier,
  type ModelAllowance,
  type ModelTier,
} from "@/lib/models";
import type { StudyMode } from "@/lib/study-shared";

/**
 * Which model runs, chosen by the participant.
 *
 * Shown rather than hidden. A participant told only "the AI rewrote your CV"
 * cannot tell a weak suggestion from a weak model, and the study asks them to
 * judge two interaction designs, not two vendors. Naming the model, its tier,
 * and how many runs of it remain keeps that distinction available to them.
 */

const TIER_STYLE: Record<ModelTier, string> = {
  reserved: "border-accent/40 bg-accent-soft text-accent",
  standard: "border-border-strong bg-background text-muted-foreground",
  unlimited: "border-border-strong bg-background text-muted-foreground",
};

function remainingLabel(
  allowance: ModelAllowance | undefined,
  mode: StudyMode,
): string {
  const left = allowance?.perMode[mode]?.remaining;
  if (left === null || left === undefined) return "unlimited";
  return left === 0 ? "none left" : `${left} left`;
}

export default function ModelPicker({
  value,
  onChange,
  allowances,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  allowances: ModelAllowance[];
  disabled?: boolean;
}) {
  const byId = new Map(allowances.map((a) => [a.modelId, a]));

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="label-caps">Which model should run</legend>
      <p className="text-sm leading-relaxed text-muted-foreground">
        The reserved model is the strongest one here and is kept for one run of
        each mode. The unlimited models are there so you can try a mode again as
        many times as you like before giving feedback.
      </p>

      <div className="grid gap-px overflow-hidden border border-border bg-border">
        {TIER_ORDER.flatMap((tier) =>
          modelsByTier(tier).map((m) => {
            const a = byId.get(m.id);
            const exhausted =
              a !== undefined &&
              a.perMode.HUMAN_CENTERED.remaining === 0 &&
              a.perMode.ONE_CLICK.remaining === 0;
            const selected = value === m.id;

            return (
              <label
                key={m.id}
                className={`flex cursor-pointer items-start gap-3 bg-surface p-4 transition-colors duration-150 ${
                  selected ? "bg-accent-soft" : "hover:bg-background"
                } ${exhausted ? "opacity-55" : ""}`}
              >
                <input
                  type="radio"
                  name="study-model"
                  value={m.id}
                  checked={selected}
                  onChange={() => onChange(m.id)}
                  disabled={exhausted}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent,#000)]"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {m.label}
                    </span>
                    <span
                      className={`border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${TIER_STYLE[m.tier]}`}
                    >
                      {TIER_LABEL[m.tier]}
                    </span>
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {m.blurb}
                  </span>
                  {m.quotaPerMode !== null && (
                    <span className="font-mono text-xs text-faint-foreground">
                      Review: {remainingLabel(a, "HUMAN_CENTERED")} · One-click:{" "}
                      {remainingLabel(a, "ONE_CLICK")}
                    </span>
                  )}
                </span>
              </label>
            );
          }),
        )}
      </div>
    </fieldset>
  );
}

/** True when the chosen model still has a run available for that mode. */
export function hasRun(
  allowances: ModelAllowance[],
  modelId: string,
  mode: StudyMode,
): boolean {
  const model = MODEL_CATALOGUE.find((m) => m.id === modelId);
  if (!model || model.quotaPerMode === null) return true;
  const left = allowances.find((a) => a.modelId === modelId)?.perMode[mode]
    ?.remaining;
  return left === null || left === undefined || left > 0;
}

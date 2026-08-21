/**
 * The models a participant may run, and how many times.
 *
 * Client-safe: the picker and the upload page both show what is left, so this
 * file must not import anything server-only. It carries no keys — only
 * catalogue ids, the provider strings they map to, and the allowance.
 *
 * Why an allowance at all. The study is funded out of one OpenRouter balance,
 * and participants are explicitly invited to run a mode more than once before
 * giving feedback. Unlimited repeats on the strongest model is an open tab; the
 * allowance keeps the measured comparison on one strong model and lets the
 * re-running happen on models that are cheap enough not to count.
 *
 * The tiers are named for what they grant, not for what they cost. A
 * participant needs to know that a choice is reserved or unlimited; what it
 * bills is not their concern and would be a strange thing to put in front of
 * someone being asked to judge the output on its merits.
 */

export type ModelTier = "reserved" | "standard" | "unlimited";

export type StudyModel = {
  /** Stable id. Written to ModeStep.model and to telemetry; never renamed. */
  id: string;
  /** What the provider is asked for. Safe to re-point if a model is retired. */
  providerModel: string;
  label: string;
  tier: ModelTier;
  /** One line, shown next to the choice. Written for a participant, not a dev. */
  blurb: string;
  /**
   * Successful runs allowed per mode, per participant. null is unlimited.
   *
   * Per mode rather than in total, so spending the allowance on the review mode
   * cannot leave someone unable to run the baseline they are being asked to
   * compare it against.
   */
  quotaPerMode: number | null;
};

export const TIER_LABEL: Record<ModelTier, string> = {
  reserved: "Reserved",
  standard: "Standard",
  unlimited: "Unlimited",
};

/**
 * Five models across three tiers, each measured against this pipeline on a real
 * CV — suggestions that survive the validator, not suggestions produced.
 *
 * Measured, whole CV, five sections:
 *
 *   Claude Sonnet 5          5 valid,  0 discarded,  64s
 *   Gemini 2.5 Flash         8 valid,  2 discarded,   9s
 *   Qwen3 235B               9 valid,  0 discarded,  42s
 *   Nemotron 3 Super (free)  6 valid,  2 discarded, 157s
 *   GPT-OSS 20B (free)       3 valid,  0 discarded, 282s
 *
 * The two free entries are the only free models that finished at all: GLM-5.2
 * and Gemma 4 returned 429 from their providers on every attempt, and Nemotron
 * Ultra failed three of five sections to upstream overload. They are kept
 * because a genuinely free option was asked for and because some participants
 * will want to re-run more than the cheap tier's cost justifies — but they are
 * slow enough that Qwen3 is listed first among the unlimited choices. A repeat
 * run on it costs about half a cent, which over the whole study is less than
 * the rounding on the reserved tier, and it answers in a third the time.
 */
export const MODEL_CATALOGUE: StudyModel[] = [
  {
    id: "sonnet-5",
    providerModel: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    tier: "reserved",
    blurb:
      "The strongest model here. Kept for one run of each mode — this is the pair the study asks you to compare.",
    quotaPerMode: 1,
  },
  {
    id: "gemini-flash",
    providerModel: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    tier: "standard",
    blurb:
      "A capable, very fast mid-range model. One run of each mode, if you want a second opinion.",
    quotaPerMode: 1,
  },
  {
    id: "qwen3-235b",
    providerModel: "qwen/qwen3-235b-a22b-2507",
    label: "Qwen3 235B",
    tier: "unlimited",
    blurb:
      "Run either mode as often as you like. Around a minute for a full review.",
    quotaPerMode: null,
  },
  {
    id: "nemotron-super",
    providerModel: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super",
    tier: "unlimited",
    blurb:
      "Free and unlimited. Slower — a full review takes two to three minutes.",
    quotaPerMode: null,
  },
  {
    id: "gpt-oss-20b",
    providerModel: "openai/gpt-oss-20b:free",
    label: "GPT-OSS 20B",
    tier: "unlimited",
    blurb:
      "Free and unlimited, and the slowest here — a full review can take five minutes.",
    quotaPerMode: null,
  },
];

export const DEFAULT_MODEL_ID = "sonnet-5";

export function modelById(id: string): StudyModel | undefined {
  return MODEL_CATALOGUE.find((m) => m.id === id);
}

/** Catalogue order, but grouped, so the picker reads reserved → unlimited. */
export const TIER_ORDER: ModelTier[] = ["reserved", "standard", "unlimited"];

export function modelsByTier(tier: ModelTier): StudyModel[] {
  return MODEL_CATALOGUE.filter((m) => m.tier === tier);
}

/**
 * What a participant has left, per model and per mode.
 *
 * The shape lives here rather than beside the query that fills it, because the
 * picker is a client component and must not reach into a server-only module
 * even for a type.
 */
export type ModeAllowance = {
  used: number;
  /** null where the model is unmetered. */
  remaining: number | null;
};

export type ModelAllowance = {
  modelId: string;
  perMode: Record<"HUMAN_CENTERED" | "ONE_CLICK", ModeAllowance>;
};

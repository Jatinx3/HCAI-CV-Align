import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { completeStub } from "./llm-stub";

/**
 * Single server-side LLM client with a provider switch. Never called from the
 * browser; keys are read from the environment and never sent to the client.
 *
 * The prompt and the JSON suggestion contract are provider-agnostic, so
 * switching providers is an env change only (LLM_PROVIDER).
 */

export type LlmProvider = "openrouter" | "anthropic" | "stub";

export type CompletionRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  /**
   * How long to wait for the model. One-click sends a whole CV in a single
   * request and legitimately takes longer than the per-section calls the
   * review mode makes, so the ceiling is set by the caller rather than fixed.
   */
  timeoutMs?: number;
  /**
   * Sampling temperature, for providers that still accept one.
   *
   * Left unset for a long time, which meant decoding ran at whatever default a
   * provider applied, and on a small free model that default was wide enough
   * for the same section to return two suggestions on one run and none on the
   * next. It is honoured on the OpenRouter path only: the current Claude models
   * removed sampling parameters and reject them with a 400.
   */
  temperature?: number;
};

export class LlmConfigError extends Error {}
export class LlmCallError extends Error {}

function activeProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "openrouter").toLowerCase();
  if (raw !== "openrouter" && raw !== "anthropic" && raw !== "stub") {
    throw new LlmConfigError(
      `LLM_PROVIDER must be "openrouter", "anthropic", or "stub" (got "${raw}").`,
    );
  }
  return raw;
}

/** Model id in use, for telemetry and for showing the user what produced a suggestion. */
export function activeModel(): string {
  const provider = activeProvider();
  if (provider === "stub") return "stub (offline)";
  return provider === "anthropic"
    ? (process.env.CLAUDE_MODEL ?? "claude-opus-4-8")
    : (process.env.OPENROUTER_MODEL ??
        "meta-llama/llama-3.3-70b-instruct:free");
}

export async function complete(req: CompletionRequest): Promise<string> {
  const provider = activeProvider();
  if (provider === "stub") return completeStub(req);
  return provider === "anthropic"
    ? completeAnthropic(req)
    : completeOpenRouter(req);
}

async function completeAnthropic({
  system,
  user,
  maxTokens = 16000,
}: CompletionRequest): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmConfigError(
      "ANTHROPIC_API_KEY is not set. Add it to .env, or set LLM_PROVIDER=openrouter.",
    );
  }
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: activeModel(),
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      // Effort governs how much thinking the model spends. High is the default
      // and the right setting here: a suggestion has to quote the CV exactly,
      // name a requirement from the job description, and survive the validator,
      // and a proposal that fails any of those is discarded before the
      // participant sees it, so a cheaper answer is often no answer at all.
      output_config: { effort: "high" },
      system,
      messages: [{ role: "user", content: user }],
      // No temperature. Sampling parameters were removed on the current Claude
      // models and are rejected with a 400, so the knob that exists for
      // OpenRouter deliberately does not reach this path.
    });

    if (response.stop_reason === "refusal") {
      throw new LlmCallError(
        "The model declined to process this request. Try rewording the job description.",
      );
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) {
      throw new LlmCallError("The model returned an empty response.");
    }
    return text;
  } catch (err) {
    if (err instanceof LlmCallError) throw err;
    if (err instanceof Anthropic.RateLimitError) {
      throw new LlmCallError("Rate limited by Anthropic. Wait and try again.");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new LlmCallError("ANTHROPIC_API_KEY was rejected. Check the key.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new LlmCallError(`Anthropic API error (${err.status}).`);
    }
    throw new LlmCallError("Could not reach the Anthropic API.");
  }
}

/** OpenRouter exposes an OpenAI-compatible chat-completions endpoint. */
async function completeOpenRouter({
  system,
  user,
  maxTokens = 16000,
  timeoutMs = 180_000,
  temperature,
}: CompletionRequest): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LlmConfigError(
      "OPENROUTER_API_KEY is not set. Add it to .env (get one at openrouter.ai/keys).",
    );
  }

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Optional attribution headers OpenRouter uses for its dashboards.
        "X-Title": "CV-JD Alignment Assistant (MSc research prototype)",
      },
      body: JSON.stringify({
        model: activeModel(),
        max_tokens: maxTokens,
        ...(temperature === undefined ? {} : { temperature }),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // A timeout and an unreachable host need different advice, and telling a
    // participant "could not reach" when the model was simply slow sends them
    // to check a connection that is fine.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new LlmCallError(
        `The model did not respond within ${Math.round(timeoutMs / 1000)}s. Free-tier models are slow under load — try again in a moment.`,
      );
    }
    throw new LlmCallError("Could not reach OpenRouter.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new LlmCallError("OPENROUTER_API_KEY was rejected. Check the key.");
    }
    if (response.status === 429) {
      throw new LlmCallError(
        "Rate limited by OpenRouter (free models have low limits). Wait and try again.",
      );
    }
    throw new LlmCallError(
      `OpenRouter error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (json.error) {
    throw new LlmCallError(json.error.message ?? "OpenRouter returned an error.");
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    throw new LlmCallError("OpenRouter returned an empty response.");
  }
  return text;
}

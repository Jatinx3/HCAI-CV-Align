/**
 * Confirm every model in the catalogue still exists at the provider.
 *
 *   npm run check-models
 *
 * Providers withdraw models without warning, and OpenRouter in particular
 * retires the ":free" variant of a model while keeping the paid one. That
 * happened to openai/gpt-oss-20b:free during this study: the endpoint began
 * answering 404, and it reached a participant as four of five CV sections
 * failing to analyse, halfway through a session.
 *
 * There is no version of the app that can prevent a provider doing that. What
 * it can do is tell the researcher before a participant does. Run this before
 * each session day.
 */
import { MODEL_CATALOGUE } from "../src/lib/models";

type Listed = { id: string; pricing?: { prompt?: string; completion?: string } };

async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("OPENROUTER_API_KEY is not set.");
    process.exit(2);
  }

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`Could not list models: HTTP ${res.status}`);
    process.exit(2);
  }
  const { data } = (await res.json()) as { data: Listed[] };
  const byId = new Map(data.map((m) => [m.id, m]));

  let missing = 0;
  for (const model of MODEL_CATALOGUE) {
    const listed = byId.get(model.providerModel);
    const per1m = (v?: string) => (Number(v ?? 0) * 1e6).toFixed(3);
    if (!listed) {
      missing += 1;
      console.log(`  GONE   ${model.label} (${model.providerModel})`);
      // The most common cause is exactly one character of difference.
      const alt = model.providerModel.endsWith(":free")
        ? model.providerModel.replace(/:free$/, "")
        : `${model.providerModel}:free`;
      if (byId.has(alt)) console.log(`         still available as: ${alt}`);
    } else {
      console.log(
        `  ok     ${model.label.padEnd(18)} ${model.providerModel.padEnd(40)}` +
          ` in $${per1m(listed.pricing?.prompt)} out $${per1m(listed.pricing?.completion)}`,
      );
    }
  }

  if (missing > 0) {
    console.log(
      `\n${missing} model${missing === 1 ? "" : "s"} in the catalogue no longer exist.` +
        ` Participants choosing them will see their sections fail.`,
    );
    process.exit(1);
  }
  console.log(`\nAll ${MODEL_CATALOGUE.length} models available.`);
}

main();

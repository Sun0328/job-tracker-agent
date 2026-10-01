import { loadEnv } from "@/cli/args";
import { chat, deepSeekConfigured, deepSeekModel, listModels } from "@/infra/llm/deepseek";

async function main() {
  loadEnv();

  if (!deepSeekConfigured()) {
    console.log("DEEPSEEK_API_KEY is empty — the agent will run in demo mode.");
    return;
  }

  const configured = deepSeekModel();
  console.log("configured model: " + configured);

  const models = await listModels();
  console.log("models this key can call: " + (models.join(", ") || "(none reported)"));

  if (!models.includes(configured)) {
    console.log("\nWARNING: " + configured + " is not in that list. Set DEEPSEEK_MODEL to one of them.");
    process.exitCode = 1;
    return;
  }

  const result = await chat([{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 256 });
  console.log("live call ok: " + JSON.stringify(result.content.trim()) + " (" + result.usage.totalTokens + " tokens, " + result.durationMs + "ms, finish=" + result.finishReason + ")");
}

main().catch((error) => {
  console.error("model check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

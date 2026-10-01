import type { TokenUsage } from "@/domain";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Called with each streamed fragment. Passing it turns streaming on. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  usage: TokenUsage;
  model: string;
  durationMs: number;
  finishReason: string | null;
  /** deepseek-flash is a reasoning model: it spends completion tokens thinking before it answers. */
  reasoningChars: number;
  /** That thinking, as text: why it answered the way it did. Empty for a non-reasoning model. */
  reasoning: string;
}

/**
 * A reasoning model can burn the whole budget on reasoning and return empty
 * content with finish_reason "length". Budgets must leave room for both.
 */
const MIN_MAX_TOKENS = 1500;

const DEFAULT_MODEL = "deepseek-chat";
const TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

export function deepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
}

export function deepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

function baseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
}

function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function readUsage(payload: unknown): TokenUsage {
  const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })?.usage;
  if (!usage) return emptyUsage();
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: usage.total_tokens ?? promptTokens + completionTokens };
}

function retryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(baseUrl() + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("Request cancelled");
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      continue;
    }

    if (response.ok) return response;

    const detail = (await response.text()).slice(0, 400);
    lastError = new Error("DeepSeek request failed (" + response.status + "): " + detail);
    if (!retryable(response.status) || attempt === MAX_ATTEMPTS) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }

  throw lastError ?? new Error("DeepSeek request failed");
}

async function readStream(response: Response, onDelta: (text: string) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("DeepSeek returned no response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = emptyUsage();
  let finishReason: string | null = null;
  let reasoning = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let chunk: {
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }>;
        usage?: unknown;
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const piece = chunk.choices?.[0]?.delta?.content;
      if (piece) {
        content += piece;
        onDelta(piece);
      }
      reasoning += chunk.choices?.[0]?.delta?.reasoning_content ?? "";
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason ?? null;
      if (chunk.usage) usage = readUsage(chunk);
    }
  }

  return { content, usage, finishReason, reasoning };
}

export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const model = deepSeekModel();
  const startedMs = Date.now();
  const streaming = Boolean(options.onDelta);

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    ...(options.maxTokens ? { max_tokens: Math.max(options.maxTokens, MIN_MAX_TOKENS) } : {}),
    ...(options.json ? { response_format: { type: "json_object" } } : {}),
    ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
  };

  const response = await post(body, options.signal);

  if (streaming) {
    const { content, usage, finishReason, reasoning } = await readStream(response, options.onDelta!);
    if (!content.trim()) {
      throw new Error(
        finishReason === "length"
          ? "DeepSeek spent the whole token budget reasoning (" + reasoning.length
            + " chars) and returned no answer. Raise maxTokens."
          : "DeepSeek returned an empty response",
      );
    }
    return { content, usage, model, durationMs: Date.now() - startedMs, finishReason, reasoningChars: reasoning.length, reasoning };
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }>;
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  const reasoning = choice?.message?.reasoning_content ?? "";

  if (!content?.trim()) {
    throw new Error(
      choice?.finish_reason === "length"
        ? "DeepSeek spent the whole token budget reasoning (" + reasoning.length
          + " chars) and returned no answer. Raise maxTokens."
        : "DeepSeek returned an empty response",
    );
  }

  return {
    content,
    usage: readUsage(payload),
    model,
    durationMs: Date.now() - startedMs,
    finishReason: choice?.finish_reason ?? null,
    reasoningChars: reasoning.length,
    reasoning,
  };
}

/** Which model ids the configured key can actually call. */
export async function listModels(): Promise<string[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const response = await fetch(baseUrl() + "/models", {
    headers: { Authorization: "Bearer " + apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error("DeepSeek /models failed (" + response.status + "): " + (await response.text()).slice(0, 200));
  }
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  return (payload.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
}

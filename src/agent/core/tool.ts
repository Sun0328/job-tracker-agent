import type { ToolCall } from "@/domain";

export interface ToolContext {
  signal?: AbortSignal;
}

export interface Tool<Input, Output> {
  name: string;
  description: string;
  run(input: Input, context?: ToolContext): Promise<Output>;
  /** One line for the trace, so the process view reads without opening the payload. */
  summarise(input: Input, output: Output): string;
}

/** Anything that can record a tool call — the run trace's step context implements it. */
export interface ToolRecorder {
  tool(call: ToolCall): void;
}

/**
 * Every tool goes through here, so a tool call is always timed, always recorded,
 * and a failure is visible in the trace instead of disappearing into a catch.
 */
export async function callTool<Input, Output>(
  recorder: ToolRecorder | null,
  tool: Tool<Input, Output>,
  input: Input,
  context?: ToolContext,
): Promise<Output> {
  const started = Date.now();
  try {
    const output = await tool.run(input, context);
    recorder?.tool({
      tool: tool.name,
      durationMs: Date.now() - started,
      ok: true,
      summary: tool.summarise(input, output),
      detail: { input: redact(input) },
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recorder?.tool({
      tool: tool.name,
      durationMs: Date.now() - started,
      ok: false,
      summary: "failed: " + message,
      detail: { input: redact(input), error: message },
    });
    throw error;
  }
}

/**
 * Keep the trace small and free of raw file bytes. Nested objects are walked so
 * a state object holding a whole CV is cut down too; class instances (a Zod
 * schema, a Buffer) are named rather than serialised.
 */
function redact(input: unknown, depth = 0): unknown {
  if (input instanceof Uint8Array) return "<" + input.byteLength + " bytes>";
  if (typeof input === "string") return input.length > 400 ? input.slice(0, 400) + "… (" + input.length + " chars)" : input;
  if (!input || typeof input !== "object") return input;
  if (depth > 4) return Array.isArray(input) ? "[…]" : "{…}";
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1));
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return "<" + ((input as object).constructor?.name ?? "object") + ">";
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) copy[key] = redact(value, depth + 1);
  return copy;
}


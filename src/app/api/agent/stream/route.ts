import { readJsonBody } from "@/server/http";
import { analyseJob, analyseRequestSchema, serialiseAnalysis, type RunEvent } from "@/services/analyse-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-sent events, one per agent step plus token deltas. This is what the
 * web page subscribes to so the run is visible while it happens.
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request, analyseRequestSchema);
  if (!parsed.ok) return parsed.response;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: RunEvent | { type: string; [key: string]: unknown }) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode("event: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n"));
        } catch {
          open = false;
        }
      };

      try {
        const result = await analyseJob({ request: parsed.data, onEvent: send, signal: request.signal });
        send({ type: "result", ...serialiseAnalysis(result) });
      } catch (error) {
        send({ type: "run.error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Client already went away.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

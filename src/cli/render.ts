import type { RunEvent } from "@/agent/core/trace";

/**
 * Terminal output for the CLI entry points: colours, the live step list, and
 * the one-liners under each step. The scripts share this so a new detail key
 * shows up everywhere at once.
 */

const paint = (code: string) => (text: string) => "[" + code + "m" + text + "[0m";
export const dim = paint("2");
export const bold = paint("1");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");
export const cyan = paint("36");

export function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

export function truncate(value: unknown, limit = 220): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ");
  return flat.length > limit ? flat.slice(0, limit) + "…" : flat;
}

/** The inline trace: what each step actually did, one line per fact. */
export function detailLines(sName: string, oDetail: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const value = <T>(key: string) => oDetail[key] as T | undefined;

  switch (sName) {
    case "identify": {
      if (oDetail.skipped) lines.push(String(oDetail.skipped));
      if (oDetail.assumed) lines.push("verdict could not be parsed, continuing anyway");
      if (value<string>("sReason")) lines.push(String(oDetail.sReason));
      if (value<string>("sLooksLike")) lines.push("looks like: " + value<string>("sLooksLike"));
      break;
    }
    case "extract": {
      if (value<boolean>("simulated")) lines.push("demo parser, no API call");
      else if (value<string>("model")) {
        lines.push("model=" + value<string>("model") + " prompt=" + value<number>("promptChars") + " chars"
          + " response=" + value<number>("responseChars") + " chars finish=" + value<string>("finishReason")
          + " api=" + value<number>("apiMs") + "ms");
      }
      if (value<string>("raw")) lines.push("raw: " + truncate(value<string>("raw")));
      break;
    }
    case "validate": {
      const nulls = value<string[]>("nullFields") ?? [];
      lines.push("valid=" + value<boolean>("valid"));
      if (nulls.length) lines.push("null fields: " + nulls.join(", "));
      break;
    }
    case "repair": {
      if (value<string>("reason")) lines.push(value<string>("reason") as string);
      const after = value<string[]>("issuesAfter");
      if (after) lines.push("issues after repair: " + (after.length ? after.join("; ") : "none"));
      break;
    }
    case "company-lookup": {
      const tried = value<Array<{ source: string; candidate: string | null; outcome: string }>>("tried");
      if (!tried) {
        if (value<string>("reason")) lines.push(value<string>("reason") as string);
        break;
      }
      for (const attempt of tried) lines.push(attempt.source + ": " + (attempt.candidate ?? "-") + "  -> " + attempt.outcome);
      lines.push("result: " + (value<string>("website_url") ?? "not found")
        + " (" + value<string>("source") + (value<boolean>("verified") ? ", verified" : "") + ")");
      if (value<string>("industry") || value<string>("business")) {
        lines.push("profile: " + (value<string>("industry") ?? "?") + " — " + (value<string>("business") ?? "?")
          + (value<boolean>("profileGrounded") ? " [from the page]" : " [model knowledge]"));
      }
      break;
    }
    case "check-fields": {
      const missing = value<string[]>("missing") ?? [];
      const thin = value<string[]>("thin") ?? [];
      lines.push(missing.length ? "missing: " + missing.join(", ") : "all required fields present" + (thin.length ? " (thin: " + thin.join(", ") + ")" : ""));
      break;
    }
    case "load-resumes": {
      if (value<string[]>("files")) lines.push((value<string[]>("files") ?? []).join(", "));
      break;
    }
    case "choose-resume": {
      if (value<string>("chose")) lines.push("chose " + value<string>("chose") + " — " + (value<string>("reason") ?? ""));
      break;
    }
    case "write-letter": {
      if (value<number>("words")) lines.push(value<number>("words") + " words (limit " + value<number>("wordLimit") + "), resume " + value<string>("resume"));
      break;
    }
    case "build-pdf": {
      if (value<number>("pages")) lines.push(value<number>("pages") + " page(s), " + value<number>("words") + " words");
      break;
    }
    case "save-pdf": {
      if (value<string>("path")) lines.push("saved to " + value<string>("path"));
      break;
    }
    case "persist": {
      if (value<string>("uuid")) lines.push("tracked as " + value<string>("uuid"));
      break;
    }
    default: {
      for (const [key, raw] of Object.entries(oDetail)) {
        // Long text belongs in the web inspector and the stored run, not the terminal.
        if (key === "issues" || key === "raw" || key === "reasoning" || key === "instructions") continue;
        lines.push(key + ": " + truncate(raw));
      }
    }
  }
  if (!lines.length && value<string>("reason")) lines.push(String(oDetail.reason));
  return lines;
}

export interface RenderOptions {
  /** Print "(main)", "(extractor)" in front of each step label. */
  showAgent?: boolean;
  /** No detail lines, just the step list. */
  quiet?: boolean;
}

/** Prints run events as they arrive: one line per step, dots while a model streams. */
export class EventPrinter {
  private readonly streamed = new Map<number, number>();

  constructor(private readonly options: RenderOptions = {}) {}

  private label(event: { iSeq: number; sAgent: string; sLabel: string }): string {
    return dim("  [" + event.iSeq + "] ") + (this.options.showAgent ? dim("(" + event.sAgent + ") ") : "") + event.sLabel + dim(" … ");
  }

  print(event: RunEvent) {
    switch (event.type) {
      case "step.start":
        process.stdout.write(this.label(event));
        this.streamed.set(event.iSeq, 0);
        break;

      case "step.delta": {
        const seen = (this.streamed.get(event.iSeq) ?? 0) + event.text.length;
        this.streamed.set(event.iSeq, seen);
        if (Math.floor(seen / 60) > Math.floor((seen - event.text.length) / 60)) process.stdout.write(dim("."));
        break;
      }

      case "step.tool":
        process.stdout.write(cyan(" {" + event.call.tool + "}"));
        break;

      case "step.end": {
        const mark = event.sStatus === "ok" ? green("ok") : event.sStatus === "skipped" ? dim("skipped") : red(event.sStatus);
        if (!this.streamed.has(event.iSeq)) process.stdout.write(this.label(event));
        console.log(" " + mark + dim(" " + event.iDurationMs + "ms" + (event.iTokens ? " " + event.iTokens + " tok" : "")));

        for (const call of event.aTools) console.log(dim("      " + (call.ok ? "" : "! ") + call.tool + ": " + call.summary));
        for (const issue of (event.oDetail.issues as string[] | undefined) ?? []) console.log(yellow("      ! ") + issue);
        if (!this.options.quiet) {
          for (const line of detailLines(event.sName, event.oDetail)) console.log(dim("      " + line));
        }
        break;
      }

      default:
        break;
    }
  }
}

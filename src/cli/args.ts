import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export { loadEnv } from "@/infra/env";

/** Command-line arguments for the scripts. npm passes a bare "--" through; drop it so flags line up. */
function args(): string[] {
  return process.argv.slice(2).filter((value) => value !== "--");
}

export function flag(name: string): boolean {
  return args().includes("--" + name);
}

export function option(name: string): string | null {
  const list = args();
  const index = list.indexOf("--" + name);
  if (index < 0) return null;
  const value = list[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

/**
 * Everything after --name up to the next flag, joined back together. Lets an
 * unquoted paste work: `--text Senior QA Engineer at Halter ...`
 */
export function optionRest(name: string): string | null {
  const list = args();
  const index = list.indexOf("--" + name);
  if (index < 0) return null;

  const collected: string[] = [];
  for (let i = index + 1; i < list.length; i += 1) {
    if (list[i].startsWith("--")) break;
    collected.push(list[i]);
  }
  return collected.length ? collected.join(" ") : null;
}

/** Read the system clipboard — the practical way to hand over a pasted advert. */
export function readClipboard(): string {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );
    }
    if (process.platform === "darwin") {
      return execFileSync("pbpaste", { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    }
    return execFileSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    throw new Error("Could not read the clipboard: " + (error instanceof Error ? error.message : String(error)));
  }
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** The advert, from --clip, --file <path>, --text <words…> or stdin, in that order. */
export async function readJobPostInput(): Promise<string> {
  if (flag("clip")) return readClipboard();
  const file = option("file");
  if (file) return readFile(file, "utf8");
  const text = optionRest("text");
  if (text) return text;
  return readStdin();
}

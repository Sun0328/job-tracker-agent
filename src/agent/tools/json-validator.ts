import type { z } from "zod";
import type { Tool } from "@/agent/core/tool";

export interface JsonValidatorInput {
  /** Raw model output, or an already-parsed object. */
  data: unknown;
  schema: z.ZodTypeAny;
  /** Fields that must not come back null — reported separately so the main agent can go looking. */
  requiredNonNull?: string[];
  label?: string;
}

export interface JsonValidatorOutput {
  valid: boolean;
  /** Present only when valid. */
  value: unknown;
  issues: string[];
  /** Keys the schema expects that were absent altogether. */
  missingFields: string[];
  /** Keys present but null/empty, including nested dotted paths. */
  nullFields: string[];
  parsedFromString: boolean;
}

function collectNulls(value: unknown, prefix = "", into: string[] = []): string[] {
  if (value === null || value === undefined || value === "") {
    if (prefix) into.push(prefix);
    return into;
  }
  if (Array.isArray(value)) {
    if (!value.length && prefix) into.push(prefix);
    return into;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectNulls(nested, prefix ? prefix + "." + key : key, into);
    }
  }
  return into;
}

/**
 * The gate between a model response and the rest of the system: is this JSON,
 * does it match the schema, and which fields came back empty.
 */
export const jsonValidator: Tool<JsonValidatorInput, JsonValidatorOutput> = {
  name: "json_validator",
  description: "Parse and validate JSON against a schema, reporting missing and null fields.",

  async run(input) {
    let data = input.data;
    let parsedFromString = false;

    if (typeof data === "string") {
      const text = data.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      try {
        data = JSON.parse(text);
        parsedFromString = true;
      } catch (error) {
        return {
          valid: false,
          value: null,
          issues: ["(root): response was not valid JSON — " + (error instanceof Error ? error.message : String(error))],
          missingFields: [],
          nullFields: [],
          parsedFromString: false,
        };
      }
    }

    const result = input.schema.safeParse(data);
    const nullFields = collectNulls(data);
    const present = data && typeof data === "object" ? Object.keys(data as Record<string, unknown>) : [];

    if (result.success) {
      const stillNull = (input.requiredNonNull ?? []).filter((field) => nullFields.includes(field));
      return {
        valid: true,
        value: result.data,
        issues: stillNull.map((field) => field + ": expected a value, got null"),
        missingFields: [],
        nullFields,
        parsedFromString,
      };
    }

    const issues = result.error.issues.map((issue) => (issue.path.join(".") || "(root)") + ": " + issue.message);
    const missingFields = result.error.issues
      .filter((issue) => issue.code === "invalid_type" && !present.includes(String(issue.path[0])))
      .map((issue) => issue.path.join("."));

    return {
      valid: false,
      value: null,
      issues,
      missingFields: [...new Set(missingFields)],
      nullFields,
      parsedFromString,
    };
  },

  summarise(input, output) {
    const label = input.label ? input.label + ": " : "";
    if (output.valid) {
      return label + "valid" + (output.nullFields.length ? ", null: " + output.nullFields.join(", ") : "");
    }
    return label + output.issues.length + " issue(s): " + output.issues.slice(0, 3).join("; ");
  },
};

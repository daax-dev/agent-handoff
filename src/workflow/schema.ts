import { z, type ZodTypeAny } from "zod";
import { SchemaValidationError } from "./errors.js";
import type { FieldMap, FieldType, RawAgentResult, WorkflowSchema, ZodLikeSchema } from "./types.js";

const PRIMITIVES: Record<FieldType, () => ZodTypeAny> = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
};

/** Detect a Zod-style schema (anything exposing safeParse). */
function isZodLike(schema: WorkflowSchema): schema is ZodLikeSchema {
  return typeof (schema as ZodLikeSchema).safeParse === "function";
}

function fieldToZod(field: string): ZodTypeAny {
  if (field.endsWith("[]")) {
    const base = field.slice(0, -2) as FieldType;
    if (!(base in PRIMITIVES)) {
      throw new SchemaValidationError(`Unknown field type in schema: "${field}"`);
    }
    return z.array(PRIMITIVES[base]());
  }
  if (!(field in PRIMITIVES)) {
    throw new SchemaValidationError(`Unknown field type in schema: "${field}"`);
  }
  return PRIMITIVES[field as FieldType]();
}

/** Build a Zod object schema from the field-map shorthand. Extra keys pass through. */
export function fieldMapToZod(map: FieldMap): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, field] of Object.entries(map)) {
    shape[key] = fieldToZod(field);
  }
  return z.object(shape).passthrough();
}

/**
 * Wrap an element validator so it validates an array of that element. Works for
 * any {@link ZodLikeSchema} (not only real Zod schemas), keeping the `array`
 * flag honored uniformly for field-map and Zod inputs.
 */
function arrayOf(element: ZodLikeSchema): ZodLikeSchema {
  return {
    safeParse(data: unknown) {
      if (!Array.isArray(data)) {
        return { success: false, error: new Error("Expected an array") };
      }
      const out: unknown[] = [];
      for (let i = 0; i < data.length; i++) {
        const result = element.safeParse(data[i]);
        if (!result.success) {
          const detail = result.error instanceof Error ? result.error.message : JSON.stringify(result.error);
          return { success: false, error: new Error(`Item ${i}: ${detail}`) };
        }
        out.push(result.data);
      }
      return { success: true, data: out };
    },
  };
}

/**
 * Resolve a {@link WorkflowSchema} (shorthand or Zod) into a concrete validator.
 * `array` wraps the element validator in both cases so `array: true` is honored
 * for a Zod schema exactly as it is for the field-map shorthand.
 */
export function resolveSchema(schema: WorkflowSchema, array: boolean): ZodLikeSchema {
  const element = isZodLike(schema) ? schema : fieldMapToZod(schema);
  return array ? arrayOf(element) : element;
}

/**
 * Extract the candidate JSON value from an agent's raw output: prefer the
 * agent reply (`text`), falling back to the adapter's structured envelope.
 */
function extractData(raw: RawAgentResult): unknown {
  // `text` holds the agent's actual reply across all adapters — prefer it.
  const fromText = tryParseJson(raw.text);
  if (fromText !== undefined) return fromText;

  // Fall back to the adapter envelope, unwrapping the reply key each adapter
  // uses (claude/opencode: result, codex: message, gemini: response).
  if (raw.structured !== undefined && typeof raw.structured === "object" && raw.structured !== null) {
    const envelope = raw.structured as Record<string, unknown>;
    for (const key of ["result", "message", "response"]) {
      const inner = envelope[key];
      if (typeof inner === "string") {
        const parsed = tryParseJson(inner);
        if (parsed !== undefined) return parsed;
      } else if (inner !== undefined && typeof inner === "object") {
        return inner;
      }
    }
    return raw.structured;
  }

  throw new SchemaValidationError("Agent output is not valid JSON; cannot validate against schema");
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Tolerate prose around a fenced or embedded JSON object/array.
    const match = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/**
 * Validate an agent's raw output against its schema and return the typed value.
 * Throws {@link SchemaValidationError} on any mismatch.
 */
export function validateAgentOutput(
  raw: RawAgentResult,
  schema: WorkflowSchema,
  array: boolean,
): unknown {
  const validator = resolveSchema(schema, array);
  const data = extractData(raw);
  const result = validator.safeParse(data);
  if (!result.success) {
    const detail = result.error instanceof Error ? result.error.message : JSON.stringify(result.error);
    throw new SchemaValidationError(`Agent output failed schema validation: ${detail}`);
  }
  return result.data;
}

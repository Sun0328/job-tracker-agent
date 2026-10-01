/**
 * The domain layer: what a job, a run and a dashboard ARE. Pure types,
 * constants and arithmetic. No IO, no framework, no model. Everything above
 * imports from here; nothing here imports from anywhere else in src.
 *
 * Zod schemas are the one deliberate exception to "types only" and live in
 * ./schemas, imported explicitly so this barrel stays dependency-free.
 */
export * from "./job";
export * from "./run";
export * from "./metrics";
export * from "./file";

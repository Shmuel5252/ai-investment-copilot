// Barrel file — re-exports every table + enum so the rest of the app
// imports from "@/db/schema" instead of reaching into individual files.
// See docs/data-model.md for what each table represents.
export * from "./enums";
export * from "./identity";
export * from "./market";
export * from "./portfolio";
export * from "./dna";
export * from "./strategy";
export * from "./learning";
export * from "./interview";
export * from "./ideas-cases";
export * from "./decisions";
export * from "./evidence";
export * from "./corrections";
export * from "./relations";

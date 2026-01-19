/**
 * ts-repair - Oracle-Guided TypeScript Repair Engine
 *
 * Turns TypeScript diagnostics into verified repair plans for agents.
 */

// Core API
export { repair, plan } from "./oracle/planner.js";

// Types
export type {
  RepairRequest,
  RepairResponse,
  RepairPlan,
  VerifiedFix,
  FixDependencies,
  ClassifiedDiagnostic,
  DiagnosticRef,
  DiagnosticDisposition,
  FileChange,
} from "./output/types.js";

// Formatting
export {
  formatPlanText,
  formatPlanJSON,
  formatPlanCompact,
} from "./output/format.js";

// Low-level API (for advanced use)
export { VirtualFS } from "./oracle/vfs.js";
export type { VFSSnapshot } from "./oracle/vfs.js";
export {
  createTypeScriptHost,
  createIncrementalTypeScriptHost,
  toDiagnosticRef,
  toFileChanges,
} from "./oracle/typescript.js";
export type { TypeScriptHost } from "./oracle/typescript.js";

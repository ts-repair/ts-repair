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
  // vNext types
  VerificationScopeHint,
  CandidateFix,
  VerificationPolicy,
} from "./output/types.js";

// Formatting
export {
  formatPlanText,
  formatPlanJSON,
  formatPlanCompact,
} from "./output/format.js";

// Low-level API (for advanced use)
export { VirtualFS } from "./oracle/vfs.js";
export {
  createTypeScriptHost,
  toDiagnosticRef,
  toFileChanges,
  getApproximateReverseDeps,
  createReverseDepsLookup,
} from "./oracle/typescript.js";
export type { TypeScriptHost } from "./oracle/typescript.js";

// vNext: Candidate abstraction
export {
  wrapTsCodeFix,
  createSyntheticFix,
  getFilesModified,
  getChanges,
  applyCandidate,
  normalizeEdits,
  computeCandidateEditSize,
  getCandidateKey,
  candidatesEqual,
  deduplicateCandidates,
} from "./oracle/candidate.js";

// vNext: Verification cone
export { ConeCache, buildCone, getEffectiveScope, isConeValid, getConeStats } from "./oracle/cone.js";

// vNext: Verification policy
export {
  DEFAULT_POLICY,
  STRUCTURAL_POLICY,
  WIDE_POLICY,
  mergePolicy,
  selectHostInvalidation,
  getPolicyForScope,
  validatePolicy,
} from "./oracle/policy.js";

// vNext: Verification with cone support
export { verifyWithCone } from "./oracle/planner.js";

// vNext: Solution Builder Framework
export {
  BuilderRegistry,
  createBuilderContext,
  defaultRegistry,
  registerBuilder,
  findNodeAtPosition,
} from "./oracle/builder.js";
export type {
  SolutionBuilder,
  BuilderContext,
  BuilderMatchResult,
} from "./output/types.js";

// vNext: Built-in Builders
export { OverloadRepairBuilder } from "./oracle/builders/overload.js";
export { builtinBuilders, registerBuiltinBuilders } from "./oracle/builders/index.js";

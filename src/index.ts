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
  VerificationScope,
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
} from "./oracle/typescript.js";
export type { TypeScriptHost } from "./oracle/typescript.js";

// vNext Candidate and Verification API (Phase 0)
export {
  fromCodeFixAction,
  createSyntheticCandidate,
  candidateToChanges,
  getModifiedFiles,
  computeCandidateEditSize,
  applyCandidate,
  applyCandidateToVFS,
  candidatesConflict,
  getFixName,
  getDescription,
  getScopeHint,
  getRiskHint,
  getTags,
} from "./oracle/candidate.js";
export type {
  CandidateFix,
  TsCodeFixCandidate,
  SyntheticCandidate,
  VerificationScopeHint,
  ApplyResult,
} from "./oracle/candidate.js";

export {
  buildCone,
  coneSignature,
  createDiagnosticCache,
  mergePolicy,
  diagnosticKey,
  diagnosticWeight,
  buildErrorCountByFile,
  buildFilesWithErrors,
  DEFAULT_VERIFICATION_POLICY,
  STRUCTURAL_VERIFICATION_POLICY,
} from "./oracle/verification.js";
export type {
  ConeSpec,
  ConeContext,
  DiagnosticCache,
  CacheStats,
  VerificationResult,
} from "./oracle/verification.js";

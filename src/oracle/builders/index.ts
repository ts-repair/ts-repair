/**
 * Solution Builders
 *
 * This module exports all built-in solution builders.
 * Use registerBuiltinBuilders() to register them with the default registry.
 */

import { registerBuilder } from "../builder.js";
import { OverloadRepairBuilder } from "./overload.js";
import { ModuleExtensionBuilder } from "./module-extension.js";
import { GenericConstraintBuilder } from "./generic-constraint.js";
import { ConditionalTypeDistributionBuilder } from "./conditional-distribution.js";
import { InstantiationDepthBuilder } from "./instantiation-depth.js";

export { OverloadRepairBuilder } from "./overload.js";
export { ModuleExtensionBuilder } from "./module-extension.js";
export { GenericConstraintBuilder } from "./generic-constraint.js";
export { ConditionalTypeDistributionBuilder } from "./conditional-distribution.js";
export { InstantiationDepthBuilder } from "./instantiation-depth.js";

/**
 * All built-in builders as an array for iteration.
 */
export const builtinBuilders = [
  OverloadRepairBuilder,
  ModuleExtensionBuilder,
  GenericConstraintBuilder,
  ConditionalTypeDistributionBuilder,
  InstantiationDepthBuilder,
] as const;

/**
 * Register all built-in builders with the default registry.
 * Call this function to enable built-in builders for repair planning.
 */
export function registerBuiltinBuilders(): void {
  for (const builder of builtinBuilders) {
    registerBuilder(builder);
  }
}

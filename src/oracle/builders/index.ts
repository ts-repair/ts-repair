/**
 * Solution Builders
 *
 * This module exports all built-in solution builders.
 * Use registerBuiltinBuilders() to register them with the default registry.
 */

import { registerBuilder } from "../builder.js";
import { OverloadRepairBuilder } from "./overload.js";

export { OverloadRepairBuilder } from "./overload.js";

/**
 * All built-in builders as an array for iteration.
 */
export const builtinBuilders = [OverloadRepairBuilder] as const;

/**
 * Register all built-in builders with the default registry.
 * Call this function to enable built-in builders for repair planning.
 */
export function registerBuiltinBuilders(): void {
  for (const builder of builtinBuilders) {
    registerBuilder(builder);
  }
}

# Error Code to Builder Mapping

This document lists which Solution Builder handles which TypeScript error codes.

## Builder Registry

| Builder | Error Codes | Description |
|---------|-------------|-------------|
| **OverloadRepairBuilder** | TS2769 | Repairs overload resolution failures by analyzing call signatures |
| **ModuleExtensionBuilder** | TS2835 | Repairs missing file extensions in ESM imports |
| **GenericConstraintBuilder** | TS2344 | Repairs generic constraint violations by adding missing members |
| **ConditionalTypeDistributionBuilder** | TS2322, TS2345, TS2536 | Repairs distributive conditional type errors by tuple-wrapping |
| **InstantiationDepthBuilder** | TS2589 | Repairs excessive type instantiation depth errors |

## Error Code Details

### TS2344 - Generic Constraint Violation
**Message:** `Type 'X' does not satisfy the constraint 'Y'`
**Builder:** GenericConstraintBuilder
**Repair Strategy:** Adds missing properties to the failing type to satisfy the constraint

### TS2322 - Type Assignment Error (from Distribution)
**Message:** `Type 'X' is not assignable to type 'Y'`
**Builder:** ConditionalTypeDistributionBuilder
**Repair Strategy:** Wraps naked type parameters in tuples to disable distributive behavior (`T extends U` → `[T] extends [U]`)

### TS2345 - Argument Type Error (from Distribution)
**Message:** `Argument of type 'X' is not assignable to parameter of type 'Y'`
**Builder:** ConditionalTypeDistributionBuilder
**Repair Strategy:** Same as TS2322 - tuple wrapping to disable distribution

### TS2536 - Index Type Error (from Distribution)
**Message:** `Type 'X' cannot be used to index type 'Y'`
**Builder:** ConditionalTypeDistributionBuilder
**Repair Strategy:** Same as TS2322 - tuple wrapping to disable distribution

### TS2589 - Instantiation Depth Exceeded
**Message:** `Type instantiation is excessively deep and possibly infinite`
**Builder:** InstantiationDepthBuilder
**Repair Strategy:** Adds intersection reset pattern (`& {}`) to recursive type references

### TS2769 - Overload Mismatch
**Message:** `No overload matches this call`
**Builder:** OverloadRepairBuilder
**Repair Strategy:** Analyzes call site and overloads to suggest parameter adjustments

### TS2835 - Missing Module Extension
**Message:** `Relative import paths need explicit file extensions`
**Builder:** ModuleExtensionBuilder
**Repair Strategy:** Extracts suggested path from error message and applies the extension

## Adding New Builders

When adding a new builder:
1. Implement the `SolutionBuilder` interface from `src/output/types.ts`
2. Set `diagnosticCodes` to the error codes this builder handles
3. Export from `src/oracle/builders/index.ts`
4. Add to `builtinBuilders` array
5. Update this document with the new mapping
6. Write tests in `tests/oracle/builders/`

## Notes

- Multiple builders can handle the same error code. The registry will try all matching builders.
- Builders with `messagePatterns` can match errors based on message content rather than just code.
- Catch-all builders (no codes or patterns) run for all diagnostics - use sparingly.
- Each builder should produce a bounded set of candidates (typically 1-6).

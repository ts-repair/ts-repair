# zod v3.23.8 Fixture

## Source

- **Repository:** https://github.com/colinhacks/zod
- **Tag/Commit:** v3.23.8
- **Commit SHA:** ca42965df46b2f7e2747db29c40a26bcb32a51d5
- **Vendored on:** 2025-01-18
- **License:** MIT

## Purpose

zod is an extremely type-heavy codebase that provides excellent benchmark coverage for:
- Complex generics and type inference
- Union types everywhere (tests `breakUnionType`)
- Type guards and narrowing (tests `deleteTypeGuard`)
- Method chaining with complex return types
- Exercises the "hard" judgment-required manglers

## Statistics

- **Lines of Code:** ~6.3k LoC (excluding tests/benchmarks)
- **Source Files:** ~25 TypeScript files
- **Key Directories:** src/types, src/helpers, src/locales

## Compilation

```bash
cd fixtures/zod-v3.23.8
npm install
npx tsc --noEmit
```

Should produce 0 errors in clean state.

## Expected Mangle Targets

### High Cascade (ts-repair advantage)

- `src/types.ts` - Core type imports used throughout
- `src/ZodError.ts` - Error class with cascading usage
- `src/helpers/` - Utility types imported everywhere

### Medium (mechanical)

- `src/locales/` - Error message utilities with simple types
- Type annotations on utility functions

### Hard (judgment required)

- `src/types.ts` - Union types for ZodType hierarchy
- Parse methods with type guards
- Complex generic constraints in `ZodType` subclasses

## Mangle Recipe Suggestions

### Small (~30 errors) - Heavier on "hard" mangles
```json
{
  "deleteImport": 1,
  "breakUnionType": 3,
  "deleteTypeGuard": 2,
  "widenToUnknown": 2,
  "removeTypeAnnotation": 2
}
```

### Medium (~60 errors)
```json
{
  "deleteImport": 3,
  "breakUnionType": 5,
  "deleteTypeGuard": 4,
  "widenToUnknown": 4,
  "deleteInterfaceProperty": 3,
  "removeTypeAnnotation": 4
}
```

## Notes

- Tests and benchmarks are excluded from compilation via tsconfig
- The codebase heavily uses conditional types and mapped types
- Some type definitions span hundreds of lines (e.g., `ZodType` hierarchy)
- Good for testing ts-repair's handling of complex type system features

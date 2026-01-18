# tsx v4.19.2 Fixture

## Source

- **Repository:** https://github.com/privatenumber/tsx
- **Tag/Commit:** v4.19.2
- **Commit SHA:** 7c47074652790e8225bb9c0d3123fc92e75d3695
- **Vendored on:** 2025-01-18
- **License:** MIT

## Purpose

tsx is a clean, modern TypeScript codebase that provides good benchmark coverage for:
- Heavy use of imports across modules (cascade testing)
- Async/await throughout (tests removeAsyncModifier)
- Node.js API types (realistic type annotation surface)
- Self-contained with well-structured modules

## Statistics

- **Lines of Code:** ~3.5k LoC
- **Source Files:** ~35 TypeScript files
- **Key Directories:** src/cjs, src/esm, src/watch, src/utils

## Compilation

```bash
cd fixtures/tsx-v4.19.2
npm install
npx tsc --noEmit
```

Should produce 0 errors in clean state.

## Expected Mangle Targets

### High Cascade (ts-repair advantage)

- `src/loader.ts` - Core imports used throughout the codebase
- `src/run.ts` - Async functions with multiple awaits
- `src/cjs/api/register.ts` - Module registration with cascading dependencies

### Medium (mechanical)

- `src/utils/` - Various utility functions with type annotations
- `src/watch/` - File watcher types and return types

### Hard (judgment required)

- `src/esm/hook/` - Complex type guards and conditional logic
- `src/utils/transform/` - esbuild transform types and mappings

## Mangle Recipe Suggestions

### Small (~30 errors)
```json
{
  "deleteImport": 2,
  "removeAsyncModifier": 2,
  "deleteInterfaceProperty": 1,
  "removeTypeAnnotation": 3,
  "deleteReturnType": 2
}
```

### Medium (~60 errors)
```json
{
  "deleteImport": 4,
  "removeAsyncModifier": 3,
  "deleteInterfaceProperty": 3,
  "removeTypeAnnotation": 5,
  "deleteReturnType": 3,
  "widenToUnknown": 2
}
```

## Notes

- `.cts` files are excluded from compilation due to `verbatimModuleSyntax` restrictions
- The codebase uses `"module": "preserve"` which requires TypeScript 5.4+
- Some internal types reference esbuild APIs

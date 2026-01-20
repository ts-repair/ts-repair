# Scalability Roadmap

This document tracks algorithmic and performance issues that limit ts-repair's scalability on large codebases.

## Executive Summary

Current implementation has **O(n²)** or worse complexity in several core operations, making it unsuitable for projects with:
- 1000+ files
- 50+ errors requiring fixes
- Large monorepos

---

## Known Issues

### P1: O(n²) Pairwise Dependency Analysis

**Location:** `src/oracle/planner.ts:429-478` (`deriveDependencies` function)

**Problem:** Nested loops compare all fix pairs, then all their edits:
```
for each fix i:
  for each fix j > i:
    for each edit in i:
      for each edit in j:
        check overlap
```

**Complexity:** O(n² × e²) worst case where n = fixes, e = average edits per fix

**Impact:** After planning completes, dependency analysis blocks on large fix sets.

**Suggested Fix:**
- Use spatial indexing (interval tree, segment tree) per file
- Early exit when overlap is impossible (different files)

---

### P2: O(n²) Batch Computation

**Location:** `src/oracle/planner.ts:490-520` (`computeBatches` function)

**Problem:** Each step is checked against all batch members:
```
for each step:
  for each existing batch:
    for each member in batch:
      check conflicts
```

**Complexity:** O(n²) where n = steps

**Suggested Fix:**
- Maintain batch indices with dependency sets
- Use union-find or graph traversal for batch assignment

---

### P3: O(n) Conflict/Dependency Lookups

**Location:** `src/oracle/planner.ts:545-557` (`canJoinBatch` function)

**Problem:** Uses `Array.includes()` for set membership:
```typescript
if (step.dependencies.conflictsWith.includes(memberId)) { return false; }
```

**Complexity:** O(n) per lookup

**Suggested Fix:** Use `Set.has()` for O(1) lookups

---

### P4: O(n) Cache Invalidation

**Location:** `src/oracle/planner.ts:669-676`

**Problem:** Iterates all cache keys to invalidate by file:
```typescript
for (const key of codeFixesCache.keys()) {
  const file = key.split("|")[0];
  if (files.has(file)) codeFixesCache.delete(key);
}
```

**Complexity:** O(cache size) per invalidation

**Suggested Fix:** Maintain reverse index: `Map<file, Set<cacheKey>>`

---

### P5: O(n) Diagnostic Array Rebuilds

**Location:** `src/oracle/planner.ts:982-993`

**Problem:** Each iteration rebuilds `filesWithErrors` set by scanning all diagnostics:
```typescript
filesWithErrors.clear();
for (const diag of currentDiagnostics) {
  if (diag.file) filesWithErrors.add(diag.file.fileName);
}
```

**Complexity:** O(n) per iteration

**Suggested Fix:** Maintain incrementally during diagnostic updates

---

### P6: O(n) Unique Add Operation

**Location:** `src/oracle/planner.ts:386-390`

**Problem:** Linear scan before each push:
```typescript
function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}
```

**Complexity:** O(n) per call

**Suggested Fix:** Use `Set.add()` and convert to array only when needed

---

## Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Dependency analysis (100 fixes) | ~5000 comparisons | ~500 comparisons |
| Batch computation (100 steps) | ~5000 checks | ~500 checks |
| Cache invalidation (1000 files) | O(cache size) | O(modified files) |
| Diagnostic iteration (100 errors) | O(n) per iteration | O(modified files) |

---

## Backwards Compatibility

All proposed changes should:
- Preserve `RepairPlan` output format
- Maintain verification semantics
- Keep CLI interface stable

---

## Priority Order

1. **P3, P6** - Quick wins, O(n) → O(1) lookups
2. **P4** - Cache invalidation with reverse index
3. **P5** - Incremental set maintenance
4. **P2** - Optimized batch computation
5. **P1** - Spatial indexing for dependencies

---

## References

- Original analysis: [GitHub Issue #XXX]
- Related: `src/oracle/planner.ts`, `src/oracle/typescript.ts`

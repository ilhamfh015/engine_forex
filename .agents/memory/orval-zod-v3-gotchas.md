---
name: Orval + Zod v3 codegen gotchas
description: Two OpenAPI spec traps that cause codegen to succeed but typecheck to fail in this workspace
---

## Trap 1: `type: integer` → `zod.int()` — invalid in Zod v3

Orval generates `zod.int()` for OpenAPI `type: integer` fields. This method does not exist in Zod v3 (it's Zod v4 syntax).

**Fix:** Use `type: number` instead of `type: integer` in the OpenAPI spec for all numeric fields.

## Trap 2: path params + query params on same operation → `{OperationId}Params` collision

When an operation has BOTH path parameters AND query parameters, Orval generates a type named `{OperationId}Params` for each, causing `TS2308: Module has already exported a member`.

**Fix:** Remove query parameters from operations that also have path parameters, and handle default values server-side. Or rename the operationId, but the collision will still occur.

**Why:** Orval names both path-param and query-param types using the same `{OperationId}Params` convention. The `lib/api-zod` barrel re-exports both, causing the collision.

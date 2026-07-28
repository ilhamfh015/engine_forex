---
name: API client import paths
description: Design subagents often use wrong import path for the generated API client
---

## Rule
Always import from `@workspace/api-client-react` (the package root), never from subpaths like `@workspace/api-client-react/generated/api`.

**Why:** The package's `exports` field in `package.json` only exposes `"."` pointing to `./src/index.ts`. Subpaths are not registered exports and Vite throws `Missing "./generated/api" specifier` at runtime.

**How to apply:** When reviewing or fixing design subagent output, grep for `/generated/api` in import statements and replace with `@workspace/api-client-react`.

```ts
// WRONG
import { useGetAnalysis } from '@workspace/api-client-react/generated/api';

// CORRECT
import { useGetAnalysis } from '@workspace/api-client-react';
```

The package's `index.ts` re-exports everything from both `./generated/api` and `./generated/api.schemas`.

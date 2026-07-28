---
name: TailwindCSS v4 dark mode
description: How to force dark mode in TailwindCSS v4 — @apply dark is invalid, use class on html element
---

## Rule
Never use `@apply dark;` in CSS. In TailwindCSS v4, `dark` is a `@custom-variant`, not a utility class. Applying it throws `Cannot apply unknown utility class 'dark'` at build time.

**Why:** TailwindCSS v4 changed how custom variants work. The `@custom-variant dark` declaration registers a selector pattern, not a utility.

**How to apply:** Add `class="dark"` directly to the `<html>` element in `index.html`:
```html
<html lang="en" class="dark">
```
This activates the `.dark` class that the `@custom-variant dark (&:is(.dark *))` pattern matches against.

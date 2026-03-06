---
title: Documentation Structure
---

# Documentation Structure

hatch3r projects use a `docs/` folder with three core subdirectories maintained by the `hatch3r-docs-writer` agent:

```
docs/
  specs/        Modular specifications with stable IDs
  adr/          Architecture Decision Records
  process/      Process documentation
```

- **`docs/specs/`** -- domain-specific spec files (glossary, core engine, event model, quality engineering)
- **`docs/adr/`** -- numbered architecture decision records with context, alternatives, and consequences
- **`docs/process/`** -- guides for recurring workflows (branching, release, code review, delegation)

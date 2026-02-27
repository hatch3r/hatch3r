---
id: hatch3r-dependency-management
type: rule
description: Rules for managing project dependencies
scope: always
---
# Dependency Management

- Always commit the lockfile. Never install without saving.
- Justify new dependencies in PR description: what it does, why needed, alternatives considered, bundle size impact.
- Prefer well-maintained packages: recent commits, active issues, no known CVEs.
- Pin exact versions for production deps. Use clean install (e.g., `npm ci`, `pip install -r`, `cargo build`) in CI.
- Run a dependency security scanner (e.g., `npm audit`, `pip-audit`, `cargo audit`) before merging dependency changes. Fix high/critical before merge.
- No duplicate packages serving the same purpose. Consolidate on one.
- Remove unused dependencies on every cleanup pass.
- Security patches (CVEs) are P0/P1 priority. Patch within 48h for critical.
- Check bundle size impact against budget. Reject deps that exceed.

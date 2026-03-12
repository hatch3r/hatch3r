---
id: hatch3r-dependency-management
type: rule
description: Rules for managing project dependencies
scope: always
tags: [maintenance]
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

## Transitive Dependency Hygiene

- Audit transitive dependencies, not just direct ones. A direct dependency with a compromised transitive dep is still a vulnerability. Use `npm ls`, `pip show`, or `cargo tree` to inspect the full dependency graph.
- When a transitive dependency has a known CVE, determine whether the vulnerable code path is reachable from your project. If reachable, override or patch the transitive dep. If unreachable, document the finding with justification for deferral.
- Avoid dependencies that pull in excessively large transitive trees for minimal functionality. If a package adds 50+ transitive deps for a single utility function, write the utility inline or find a lighter alternative.

## Version Upgrade Strategy

- Review changelogs and migration guides before upgrading major versions. Never blindly bump major versions and assume backward compatibility.
- Run the full test suite after any dependency upgrade, including integration tests. A passing unit test suite does not guarantee compatibility with upgraded peer dependencies.
- When upgrading a shared dependency used across multiple modules, upgrade all consumers in the same PR to avoid version skew within the monorepo or project.

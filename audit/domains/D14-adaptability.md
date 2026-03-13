# Domain 14: Cross-Project Adaptability & Scalability

**Scope:** How well the framework works across different project types, sizes, and team configurations.
**Sub-agents:** 4

| SA | Focus |
|----|-------|
| 14.1 | Tech Stack Generalization |
| 14.2 | Monorepo & Enterprise |
| 14.3 | Team Scalability |
| 14.4 | Convention Self-Discovery |

## Audit Checklists

### 14.1 Tech Stack Generalization
- [ ] Does the framework work equally well for: React/Next.js, Vue/Nuxt, Angular, Svelte, Python/Django, Ruby/Rails, Go, Rust, Java/Spring, mobile (React Native, Flutter)?
- [ ] Are rules and agents tech-stack-neutral or frontend-biased?
- [ ] Portability scoring — rate each tech stack's support level (full, partial, minimal, none)
- [ ] Language-specific gaps — are there missing rules or agents for non-JavaScript ecosystems?

### 14.2 Monorepo & Enterprise
- [ ] Monorepo support (Turborepo, Nx, Lerna) — can hatch3r manage per-package agent configs?
- [ ] Enterprise scale — does it work with 100+ developers, 1000+ files?
- [ ] Performance at scale — init time, sync time, file count handling
- [ ] Multi-team configuration — different teams within the same monorepo

### 14.3 Team Scalability
- [ ] Solo developer experience — minimal overhead, fast feedback
- [ ] Small team (2-10) — shared conventions, consistent output
- [ ] Large team (10-100+) — governance, customization, role-based config
- [ ] Team conventions management — can teams define and enforce their own conventions?

### 14.4 Convention Self-Discovery
- [ ] Automatic detection of existing conventions (linting config, test framework, CI provider)
- [ ] Graduated customization — progressive disclosure of advanced features
- [ ] Migration path from other tools — can users switch from competitors?
- [ ] Convention conflict resolution — what happens when detected conventions conflict with hatch3r defaults?

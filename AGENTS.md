<!-- HATCH3R:BEGIN -->
## Hatcher Codex instructions

### Universal floor

- Preserve user-authored content and keep changes inside the requested scope.
- Never hardcode secrets; use environment-variable indirection.
- Ask a concise plain-text question before irreversible work or when two interpretations produce different artifacts.
- Run the repository's relevant tests and report the command and result.
- Use Codex subagents for bounded delegation and `$skill-name` for explicit skill activation.

### Always-applicable Hatcher rules

- Read `.hatch3r/codex-support/rules/hatch3r-agent-orchestration.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-anti-duplication.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-clarification-default.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-code-standards.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-context-budget.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-contract-census.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-cost-visibility.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-deep-context.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-edge-case-discipline.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-fan-out-discipline.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-findings-ledger.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-iteration-summary.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-learning-system.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-model-allocation.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-proof-model.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-reviewer-calibration.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-right-sizing.md` (high).
- Read `.hatch3r/codex-support/rules/hatch3r-communication-style.md` (normal).

### Conditional rule bridge (glob limitation)

Codex has no native repository glob-scoped rule file. Before changing a matching path, read the mapped support file:

- `**/.env*, **/*secret*, **/*credential*, **/*token*, **/config/**, **/.gitignore, **/vault/**, **/*auth*.config*` → `.hatch3r/codex-support/rules/hatch3r-secrets-management.md` (critical).
- `**/security/**, **/*guard*, **/*policy*, **/*permission*, **/*sanitiz*, **/*validat*` → `.hatch3r/codex-support/rules/hatch3r-security-patterns.md` (critical).
- `**/*.vue, **/*.jsx, **/*.tsx, **/*.svelte, **/components/**, **/*.html, **/*a11y*, **/*accessibility*` → `.hatch3r/codex-support/rules/hatch3r-accessibility-standards.md` (high).
- `**/.hatch3r/**, **/pipeline/**, **/*orchestrat*, **/*agent*` → `.hatch3r/codex-support/rules/hatch3r-agent-orchestration-detail.md` (high).
- `**/ai/**, **/llm/**, **/chat/**, **/assistant/**, **/agents/**, **/copilot/**, **/evals/**, **/prompts/**, **/rag/**` → `.hatch3r/codex-support/rules/hatch3r-ai-evals.md` (high).
- `**/*.vue, **/*.jsx, **/*.tsx, **/*.svelte, **/ai/**, **/chat/**, **/assistant/**, **/agents/**, **/llm/**, **/copilot/**` → `.hatch3r/codex-support/rules/hatch3r-ai-ux-patterns.md` (high).
- `**/api/**, **/openapi*, **/asyncapi*, **/*.proto, **/routes/**, **/handlers/**, **/controllers/**` → `.hatch3r/codex-support/rules/hatch3r-api-versioning.md` (high).
- `**/auth/**, **/login/**, **/session/**, **/oauth/**, **/oidc/**, **/jwt/**, **/permissions/**, **/policies/**, **/middleware/**` → `.hatch3r/codex-support/rules/hatch3r-auth-patterns.md` (high).
- `src/**/*.vue, src/**/*.tsx, src/**/*.jsx` → `.hatch3r/codex-support/rules/hatch3r-component-conventions.md` (high).
- `**/Dockerfile*, **/docker-compose*, **/*.containerfile, **/charts/**, **/k8s/**, **/kubernetes/**, **/manifests/**` → `.hatch3r/codex-support/rules/hatch3r-container-hardening.md` (high).
- `**/contracts/**, **/pacts/**, **/api/**, **/openapi*, **/asyncapi*, **/*.proto, **/__tests__/contract/**` → `.hatch3r/codex-support/rules/hatch3r-contract-testing.md` (high).
- `src/**, **/__tests__/**, **/handlers/**, **/routes/**, **/services/**, **/api/**, **/migrations/**, **/openapi.yaml, **/openapi.json, **/*.proto, **/schema.graphql, **/asyncapi.yaml` → `.hatch3r/codex-support/rules/hatch3r-cq-rule-frame.md` (high).
- `**/models/**, **/schemas/**, **/schema*, **/database/**, **/db/**, **/*model*, **/*entity*, **/prisma/**, **/drizzle/**, **/*migration*, **/log*, **/*logger*, **/analytics/**, **/*analytics*, **/events/**, **/*telemetry*, **/export*, **/*export*` → `.hatch3r/codex-support/rules/hatch3r-data-classification.md` (high).
- `**/package.json, **/package-lock.json, **/yarn.lock, **/pnpm-lock.yaml, **/Cargo.toml, **/Cargo.lock, **/requirements*.txt, **/pyproject.toml, **/go.mod, **/go.sum, **/Gemfile*, **/.github/workflows/**, **/*.yml, **/*.yaml` → `.hatch3r/codex-support/rules/hatch3r-dependency-management.md` (high).
- `**/*.vue, **/*.jsx, **/*.tsx, **/*.svelte, **/*.css, **/*.scss, **/components/**, **/tokens*, **/theme*, **/design-system/**, **/tailwind*` → `.hatch3r/codex-support/rules/hatch3r-design-system-detection.md` (high).
- `**/*.vue, **/*.js, **/*.mjs, **/*.cjs, **/*.jsx, **/composables/**, **/stores/**` → `.hatch3r/codex-support/rules/hatch3r-dynamic-stack-verification.md` (high).
- `src/**, **/config/**, **/openapi.yaml, **/openapi.json, **/*.proto, **/schema.graphql, **/asyncapi.yaml, **/flags*, **/plugins/**, **/extensions/**` → `.hatch3r/codex-support/rules/hatch3r-enhancability.md` (high).
- `**/events/**, **/schemas/**, **/*.avsc, **/*.proto, **/messaging/**, **/kafka/**, **/pubsub/**` → `.hatch3r/codex-support/rules/hatch3r-event-schema-evolution.md` (high).
- `.hatch3r/handoffs/active/**/*.md` → `.hatch3r/codex-support/rules/hatch3r-handoff-readiness.md` (high).
- `src/**, **/migrations/**, **/db/migrations/**, **/prisma/migrations/**, **/openapi.yaml, **/openapi.json, **/*.proto, **/schema.graphql, **/asyncapi.yaml` → `.hatch3r/codex-support/rules/hatch3r-maintainability.md` (high).
- `**/migrations/**, **/*migration*, **/migrate/**, **/seeds/**, **/seeders/**, **/prisma/migrations/**, **/drizzle/**, **/knex/**` → `.hatch3r/codex-support/rules/hatch3r-migrations.md` (high).
- `**/services/**, **/handlers/**, **/health*, **/probes/**, **/k8s/**, **/manifests/**, **/charts/**, **/feature*, **/flags/**` → `.hatch3r/codex-support/rules/hatch3r-operability.md` (high).
- `**/auth/**, **/passkey*, **/webauthn*, **/fido*, **/credentials/**` → `.hatch3r/codex-support/rules/hatch3r-passkey-server.md` (high).
- `**/services/**, **/handlers/**, **/clients/**, **/integrations/**, **/api/**, **/middleware/**, **/circuit*, **/retry*, **/resilience*` → `.hatch3r/codex-support/rules/hatch3r-resilience-patterns.md` (high).
- `**/handlers/**, **/routes/**, **/services/**, **/api/**, **/workers/**, **/queues/**, **/jobs/**, **/middleware/**, **/handler*, **/route*, **/worker*, **/queue*` → `.hatch3r/codex-support/rules/hatch3r-scalability.md` (high).
- `src/**, **/auth/**, **/.github/workflows/**, **/Dockerfile*, **/package.json, **/package-lock.json, **/pnpm-lock.yaml, **/yarn.lock` → `.hatch3r/codex-support/rules/hatch3r-security.md` (high).
- `src/**, **/__tests__/**, **/tests/**, **/test/**, **/*.test.*, **/*.spec.*, **/vitest.config.*, **/jest.config.*, **/cypress.config.*` → `.hatch3r/codex-support/rules/hatch3r-testability.md` (high).
- `**/*.test.*, **/*.spec.*, **/__tests__/**, **/tests/**, **/test/**, **/*.cy.*, **/playwright/**, **/vitest.config.*, **/jest.config.*, **/cypress.config.*` → `.hatch3r/codex-support/rules/hatch3r-testing.md` (high).
- `**/*.vue, **/*.jsx, **/*.tsx, **/*.svelte, **/components/**, **/*.html, **/messages/**, **/locales/**, **/copy/**` → `.hatch3r/codex-support/rules/hatch3r-ux-states-and-flows.md` (high).
- `**/*.cs, **/*.csproj, **/*.sln, **/*.fsproj, **/*.vbproj, **/Directory.Build.props, **/Directory.Build.targets, **/global.json, **/nuget.config, **/appsettings.json, **/appsettings.*.json, **/Program.cs, **/Startup.cs` → `.hatch3r/codex-support/rules/hatch3r-dotnet-patterns.md` (normal).
- `**/*feature-flag*, **/*featureFlag*, **/*feature_flag*, **/config/**` → `.hatch3r/codex-support/rules/hatch3r-feature-flags.md` (normal).
- `**/*.dart, **/pubspec.yaml, **/pubspec.lock, **/analysis_options.yaml, **/build.yaml, **/lib/**, **/test/**, **/integration_test/**, **/ios/Runner/**, **/android/app/**, **/windows/runner/**, **/macos/Runner/**, **/linux/**, **/web/index.html` → `.hatch3r/codex-support/rules/hatch3r-flutter-patterns.md` (normal).
- `src/**/*.vue, src/**/*.tsx, src/**/*.jsx, src/**/*.ts, **/locales/**, **/i18n/**, **/*i18n*, **/*locale*` → `.hatch3r/codex-support/rules/hatch3r-i18n.md` (normal).
- `**/*.php, **/composer.json, **/composer.lock, **/artisan, **/phpunit.xml, **/phpunit.xml.dist, **/phpstan.neon, **/phpstan.neon.dist, **/pint.json, **/.php-cs-fixer.php, **/app/**, **/bootstrap/**, **/config/**, **/database/migrations/**, **/routes/**, **/tests/**` → `.hatch3r/codex-support/rules/hatch3r-php-laravel-patterns.md` (normal).
- `**/App.tsx, **/App.jsx, **/index.js, **/metro.config.js, **/metro.config.ts, **/babel.config.js, **/app.json, **/app.config.ts, **/app.config.js, **/ios/**, **/android/**, **/expo-env.d.ts, **/.expo/**, **/*.native.tsx, **/*.native.jsx, **/*.native.ts` → `.hatch3r/codex-support/rules/hatch3r-react-native-patterns.md` (normal).
- `**/*.swift, **/*.swiftinterface, **/Package.swift, **/Package.resolved, **/*.xcodeproj/**, **/*.xcworkspace/**, **/Info.plist, **/*.entitlements, **/Tuist/**, **/Project.swift, **/Workspace.swift, **/ios/**, **/macos/**, **/visionOS/**, **/watchOS/**, **/tvOS/**` → `.hatch3r/codex-support/rules/hatch3r-swiftui-patterns.md` (normal).
- `src/**/*.vue, src/**/*.tsx, src/**/*.jsx, src/**/*.css, src/**/*.scss, **/*theme*, **/*color*` → `.hatch3r/codex-support/rules/hatch3r-theming.md` (normal).
- `**/.hatch3r/**, **/mcp/**, **/mcp.json, **/.cursor/**, **/.github/copilot*, **/hatch.json` → `.hatch3r/codex-support/rules/hatch3r-tooling-hierarchy.md` (normal).
- `**/*.ts, **/*.tsx, **/*.mts, **/*.cts, **/*.js, **/*.jsx, **/*.mjs, **/*.cjs, **/tsconfig*.json, **/.eslintrc*, **/eslint.config.*` → `.hatch3r/codex-support/rules/hatch3r-typescript-patterns.md` (normal).

### Relevance-triggered rule bridge

- hatch3r-git-conventions (normal): read `.hatch3r/codex-support/rules/hatch3r-git-conventions.md` when its topic is relevant.

### Custom subagents

Hatcher custom agents are defined in `.codex/agents/hatch3r-*.toml`; supporting source projections are under `.hatch3r/codex-support/agents/`.

### Command bridge

Codex has no repository-defined slash-command surface. Hatcher command workflows are invoked as `$hatch3r-*` skills; support projections are under `.hatch3r/codex-support/commands/`.
<!-- HATCH3R:END -->

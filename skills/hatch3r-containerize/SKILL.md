---
id: hatch3r-containerize
name: hatch3r-containerize
type: skill
description: Containerize an application through a repeatable workflow — multi-stage Dockerfile, non-root hardening, minimal base image, .dockerignore, healthcheck, local docker-compose, Kubernetes manifest basics, and an image-scan gate. Use when adding or hardening container artifacts.
tags: [devops, tier:scaleup-plus]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# Containerization Workflow

Companion workflow to the `hatch3r-devops` agent: that agent reviews and authors infrastructure across CI/CD, IaC, and orchestration with apply-step gating; this skill is the focused step-by-step procedure for producing a hardened container image and its local + orchestration manifests. Use this skill when the task is "containerize this service" or "harden this Dockerfile"; escalate to the agent when the work spans pipelines, cloud IaC, or a deployment strategy.

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Pick a minimal base image + plan build/runtime split
- [ ] Step 2: Write the multi-stage Dockerfile
- [ ] Step 3: Harden — non-root USER, dropped privileges, HEALTHCHECK
- [ ] Step 4: Add .dockerignore + verify build context size
- [ ] Step 5: Author docker-compose for local dev
- [ ] Step 6: Author Kubernetes manifest with securityContext
- [ ] Step 7: Scan the image and gate on findings
```

Two invariants bound every image this workflow produces: it runs as a non-root user, and it ships only runtime artifacts (no build toolchain, no secrets). Steps 2–3 establish both; Step 7 verifies them.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: language/runtime + version (drives base-image choice), whether the target is local-dev-only or production orchestration, the orchestrator (plain Docker vs docker-compose vs Kubernetes), whether secrets are needed at build time vs runtime (build-time secrets are an irreversible leak risk), and the registry the final image pushes to.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (one service, Dockerfile only): inline execution acceptable.
- Tier 2 (Dockerfile + compose + one K8s manifest for one service): spawn one sub-agent per artifact via the Task tool.
- Tier 3 (multi-service repo, one image set per service): one fresh sub-agent per service; orchestrator integrates the compose/manifest set only.

Token cost never justifies under-fan-out. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Pick a Minimal Base Image and Plan the Build/Runtime Split

- Choose the smallest base that runs the app: a `-slim` variant, a distroless image, or Alpine where the libc difference is acceptable. A smaller base shrinks attack surface and pull time (Docker best-practices — see References).
- Plan two stages: a build stage that carries the full toolchain (compilers, dev dependencies, test runners) and a runtime stage that carries only the built artifact plus its runtime dependencies (Docker multi-stage — see References).
- Pin the base image to a specific tag or digest (`node:22.5.1-slim`, not `node:latest`). A mutable tag makes the build non-reproducible.

## Step 2: Write the Multi-Stage Dockerfile

Structure the Dockerfile so each `FROM` begins a stage and the final stage copies only the runtime output:

```dockerfile
# --- build stage ---
FROM node:22.5.1-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# --- runtime stage ---
FROM node:22.5.1-slim AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
```

- Order instructions stalest-to-freshest: copy the lockfile and install dependencies before copying source, so a code edit does not bust the dependency-install layer cache.
- `COPY --from=build` only the artifacts the app needs at runtime — never the source tree, build cache, or dev dependencies.
- Never write a secret into a layer. Use BuildKit build secrets (`RUN --mount=type=secret,...`) for build-time credentials and runtime environment injection for runtime credentials; a secret in any layer is recoverable from the image (OWASP Docker Security — see References).

## Step 3: Harden — Non-Root, Dropped Privileges, Healthcheck

- Create a dedicated unprivileged user with an explicit UID/GID and switch to it before the run command. An explicit UID survives rebuilds and maps to a Kubernetes `runAsUser` (Docker best-practices — see References):

```dockerfile
RUN groupadd -r app --gid=10001 && useradd -r -g app --uid=10001 app
USER app
```

- Running as root is the most common dangerous container misconfiguration: a container escape inherits host root (OWASP Docker Security — see References). The non-root `USER` line is mandatory output of this step.
- Add a `HEALTHCHECK` so the orchestrator can detect and restart an unhealthy container — this is CIS Docker Benchmark control 4.6 (CIS — see References):

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node ./dist/healthcheck.js || exit 1
```

- Do not install `sudo`; its TTY and signal-forwarding behavior is unpredictable. If privilege elevation is unavoidable, use `gosu` (Docker best-practices — see References).
- Use `COPY` not `ADD` (ADD's URL-fetch and auto-extract behavior is a footgun); set `ENV NODE_ENV=production` (or the runtime equivalent) so the app does not load dev tooling.

## Step 4: Add .dockerignore and Verify Build Context Size

- Author a `.dockerignore` excluding `.git`, `node_modules` (rebuilt in-image), `.env*`, test artifacts, CI config, and local build output. This keeps secrets out of the build context and shrinks the upload sent to the daemon.
- A `.env` file reaching the build context is a credential-leak path even if a layer does not copy it — exclude it explicitly.
- Verify: run the build and confirm the "transferring context" size is small (kilobytes, not the whole repo). A large context means the `.dockerignore` missed something.

## Step 5: Author docker-compose for Local Dev

- Write a `docker-compose.yml` (or `compose.yaml`) that builds the image and wires backing services (database, cache, queue) for local development.
- Inject configuration via `environment:` / `env_file:` referencing a gitignored `.env`; never inline secrets in the compose file.
- Add a `healthcheck:` per service and use `depends_on:` with `condition: service_healthy` so the app waits for its database to be ready.
- Pin backing-service images to specific tags, mirroring the Dockerfile base-pin policy.
- Mount source as a volume only in the local-dev compose, never in the production image build.

## Step 6: Author the Kubernetes Manifest with securityContext

- Author a Deployment + Service. Set a `securityContext` that enforces the Dockerfile hardening at the orchestrator layer (Kubernetes hardening — see References):

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

- Set resource `requests` and `limits` (CPU + memory) so a runaway container cannot starve the node.
- Map the Dockerfile `HEALTHCHECK` to a `readinessProbe` and `livenessProbe` so Kubernetes gates traffic and restarts on the same signal.
- Reference secrets via a `Secret` object or external secret store; never inline credentials in the manifest.
- Drop all Linux capabilities and add back only what the workload requires (OWASP Docker Top 10 — see References).

## Step 7: Scan the Image and Gate on Findings

- Build the image, then scan it with a vulnerability scanner (Trivy, Grype, or `docker scout`) before pushing. Trivy also runs CIS Docker/Kubernetes benchmark checks (Trivy / CIS — see References).
- Gate: block the push on any fixable HIGH or CRITICAL CVE. For an unfixable CVE with no upstream patch, record an explicit accepted-risk note with the CVE id and a re-check date rather than silently shipping.
- Re-scan after a base-image bump — a new base introduces a new CVE set.
- Optionally run a config linter (`hadolint` for the Dockerfile, Docker Bench for Security against the host) and surface findings alongside the CVE report.

## Error Handling

- **Final image is unexpectedly large:** confirm the runtime stage copies only artifacts (Step 2), the base is a `-slim`/distroless variant (Step 1), and `.dockerignore` excludes `node_modules`/build output (Step 4). A multi-hundred-MB image usually means the build toolchain leaked into the runtime stage.
- **App fails to start as non-root:** the process is binding a privileged port (<1024) or writing to a path it no longer owns. Bind a high port and map it at the orchestrator, or `chown` the writable path to the app UID in the build stage. Do not revert to root.
- **`readOnlyRootFilesystem: true` breaks the app:** mount an `emptyDir` volume at the specific writable path (cache, tmp) the app needs rather than disabling the read-only root.
- **Scanner reports a CVE with no fix:** do not silently ship. Record the CVE id, affected package, and a re-evaluation date as an accepted-risk note; escalate if it is on the request path and exploitable.
- **Build needs a secret:** never `COPY` or `ARG` it into a layer. Use a BuildKit secret mount (`RUN --mount=type=secret`); if that is unavailable, build the artifact outside the image and `COPY` only the result.

## Definition of Done

- [ ] Multi-stage Dockerfile: build stage and a runtime stage carrying only runtime artifacts
- [ ] Runs as a non-root user with an explicit UID; no `sudo`; `HEALTHCHECK` present
- [ ] Minimal pinned base image (no `latest`); `.dockerignore` verified to shrink the build context
- [ ] docker-compose for local dev with per-service healthchecks and gitignored secret injection
- [ ] Kubernetes manifest with `securityContext` (runAsNonRoot, dropped capabilities, read-only root), resource limits, and probes
- [ ] Image scanned; build/push gated on fixable HIGH/CRITICAL CVEs; accepted-risk notes recorded for unfixable findings
- [ ] No secret in any image layer, compose file, or manifest

## References

- Docker, Inc. "Building best practices — Dockerfile." `https://docs.docker.com/build/building/best-practices/` (accessed 2026-06-02, Docker Docs, official-docs). Source for the minimal-base-image guidance (Step 1), the non-root `USER` with explicit UID and the no-`sudo`/`gosu` rule (Step 3), and `COPY`-over-`ADD`. Multi-stage build mechanics (Step 2): `https://docs.docker.com/build/building/multi-stage/`.
- OWASP Foundation. "Docker Security Cheat Sheet." `https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html` (accessed 2026-06-02, OWASP, official-docs). Source for the drop-all-capabilities-then-add-back posture (Steps 6), the no-secrets-in-layers rule (Steps 2–4), and the root-escape blast-radius rationale behind the mandatory non-root user (Step 3). Container-environment controls: OWASP Docker Top 10 `https://owasp.org/www-project-docker-top-10/`.
- Center for Internet Security / Aqua Security (Trivy). "CIS Docker Benchmark — HEALTHCHECK (control 4.6) and Trivy CIS benchmark scanning." `https://www.cisecurity.org/benchmark/docker` and `https://www.aquasec.com/blog/trivy-kubernetes-cis-benchmark-scanning/` (accessed 2026-06-02, CIS official-docs + Aqua Security established-library). Source for the `HEALTHCHECK` requirement (Step 3), the Kubernetes `securityContext` hardening fields (Step 6), and the Trivy CIS-benchmark image-scan gate (Step 7).

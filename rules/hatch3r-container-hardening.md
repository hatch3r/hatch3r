---
id: hatch3r-container-hardening
type: rule
description: Container image hardening — digest pinning, distroless / Wolfi base, non-root user, SBOM-in-image, cosign signing + verification, multi-stage builds, CVE scanning
scope: "**/Dockerfile*,**/docker-compose*,**/*.containerfile,**/charts/**,**/k8s/**,**/kubernetes/**,**/manifests/**"
tags: [devops, floor:security]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Container Hardening

## Base Image: Wolfi / Chainguard Images

The 2026 baseline for container images is Wolfi-OS via Chainguard Images — rebuilt nightly from source, granular per-package versions, no kernel, distroless philosophy. Distroless (Google) remains a valid fallback when Chainguard's commercial offering is out of scope.

- Pin every base image by digest, never by tag. Mutable tags (`latest`, `1`, `1.2`) are an attack vector — the registry can serve a different image under the same tag at any time.
- Example: `FROM cgr.dev/chainguard/node:latest@sha256:<64-hex-digest>` (the `latest` tag is acceptable only when paired with a `@sha256:` digest pin; the digest is the authority).
- Drift detection: a scheduled CI job re-resolves base-image tags and opens a PR when a newer digest publishes; reviewer inspects CVE delta before merging.

## Multi-Stage Builds

Separate the builder from the runtime image. The builder carries the full toolchain (compilers, package managers, dev headers); the runtime carries only the produced artifact plus a distroless or Wolfi base.

- Builder stage: install build deps, compile, run tests. May be heavy.
- Runtime stage: `FROM cgr.dev/chainguard/static:latest@sha256:...` (for static binaries) or `cgr.dev/chainguard/node:latest@sha256:...` (for Node services). `COPY --from=builder` only the artifacts needed at runtime.
- Result: smaller image, fewer CVEs at runtime, no source code or build tools shipped to production.

## Non-Root User

Production containers run as a non-root user. Root-in-container plus container-escape-CVE equals root-on-host.

- `USER 65532:65532` (the `nobody` UID on most distros) or a named non-root user declared in the Dockerfile.
- Kubernetes pod security: `runAsNonRoot: true`, `runAsUser: 65532`, `runAsGroup: 65532`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`.
- Writable paths use `emptyDir` or `persistentVolumeClaim` mounts, not the root filesystem.

## No Shell, Minimal Binaries

Distroless `:nonroot` variants and Chainguard `static` images ship without `/bin/sh`. A compromised process cannot fall back to a shell for lateral movement.

- Production image set is `:nonroot` or `static`. Debug variants (`:debug`, `:debug-nonroot`) include `sh` and `busybox` and are pulled only for local troubleshooting.
- `kubectl debug --image=cgr.dev/chainguard/wolfi-base` provides ephemeral debug containers without baking shells into production images.

## SBOM-in-Image

Every image carries a CycloneDX 1.6 SBOM, generated at build time and either embedded in the image or attached as an OCI artifact in the registry.

- Generation: `syft <image> -o cyclonedx-json` or BuildKit `--attest type=sbom`. Chainguard Images already ship with attached SBOMs.
- Attachment: `cosign attach sbom --sbom sbom.cdx.json <image>:<tag>` or BuildKit attestation in the OCI manifest.
- Deploy-time consumers fetch the SBOM via `cosign download sbom <image>` and match against the CVE feed before admission.

## Image Signing — cosign

Every image is signed with cosign keyless mode via OIDC. Sigstore Fulcio issues a short-lived signing certificate scoped to the workflow identity; Rekor records the signature for tamper-evident audit.

- Sign in CI: `cosign sign --yes <registry>/<image>@<digest>`. Workflow grants `id-token: write` permission; no long-lived signing key.
- Verify at deploy: `cosign verify <image> --certificate-identity-regexp 'https://github\.com/org/repo/\.github/workflows/.*' --certificate-oidc-issuer https://token.actions.githubusercontent.com`.
- Admission enforcement: Sigstore Policy Controller (native admission with CUE or Rego), Kyverno (`verifyImages` rule), or OPA Gatekeeper + Ratify. Unsigned images rejected at admission, not just warned.

## CVE Scanning in CI

Two scanners are run per image build: `trivy` for breadth (Wolfi advisory database, OS+language deps) and `grype` for Chainguard parity. Release is blocked on unpatched Critical or High CVEs without a documented suppression record.

- `trivy image --severity HIGH,CRITICAL --exit-code 1 <image>:<tag>` fails the job on any High/Critical.
- Periodic re-scan: a nightly job re-pulls each production image digest and rescans — newly-disclosed CVEs in already-deployed images surface here.
- Suppressions documented in `.trivyignore` with CVE ID, justification, expiry date, and owner. Expired suppressions fail the build.

## Digest Pinning Everywhere

The same digest-not-tag rule extends beyond `FROM` lines to every place the image is referenced.

- Kubernetes manifests: `image: <registry>/<image>@sha256:<digest>` in Deployment, StatefulSet, Job, CronJob.
- Helm charts: `appVersion` references the digest; `image.tag` is the digest, not a semver tag.
- GitOps repos (Argo CD, Flux): the source of truth is the digest; image-update controllers (`flux image-update`) bump the digest on signed-image admission events.
- Pull policy: `imagePullPolicy: IfNotPresent` (digests are immutable so pull-once is safe); `Always` is only required when tags are used.

## Reproducible Builds

Build inputs are pinned so the same `git checkout` produces the same image digest.

- `# syntax=docker/dockerfile:1.<minor>.<patch>` — pin to a specific BuildKit syntax version.
- Package installs pin versions: `apk add --no-cache nodejs=20.11.1-r0` (Wolfi/Alpine), `apt-get install -y nodejs=20.11.1*` (Debian).
- Deterministic `COPY` order: copy lockfile and install deps before copying source, so layer caching is stable.
- `SOURCE_DATE_EPOCH` set from git commit timestamp strips filesystem timestamps.
- Verify with `reproducible-containers/repro-build`: rebuild and compare digests; mismatches fail.

## Secrets Handling in Images

Secrets never enter the image at build time. Runtime injection only.

- Forbidden: `COPY .env`, `ARG NPM_TOKEN`, `ENV API_KEY=...`. Build args persist in image history and are recoverable by anyone with image pull access.
- Build-time secrets (private registry tokens, SSH keys) use BuildKit `--mount=type=secret,id=<name>` — mounted at build, never persisted.
- Runtime secrets injected via container env (from Kubernetes Secret or vault sidecar), mounted file (CSI Secret Store driver), or IAM role / Workload Identity for cloud auth.

## Health Checks

Every long-running container declares readiness, liveness, and startup probes. Cross-reference `rules/hatch3r-operability.md`.

- Dockerfile `HEALTHCHECK CMD <command>` for non-orchestrated deployments.
- Kubernetes `livenessProbe`, `readinessProbe`, `startupProbe` with HTTP, TCP, or exec checks. Startup probe allows slow boots (e.g., JVM warmup) without failing liveness during startup.
- Probe endpoints implemented at the application layer; `/healthz` (liveness), `/readyz` (readiness), `/startz` (startup) is the conventional split.

## Image Size Budget

Runtime image targets under 200 MB compressed. Builds exceeding 500 MB compressed page the platform team for review.

- Strip debug symbols and source maps from production artifacts in the builder stage.
- Single-binary services (Go, Rust) target Chainguard `static` images — typical runtime under 20 MB.
- Multi-arch images do not multiply the size budget — each architecture is measured independently.

## Verification Gate at Release

Every release pipeline executes the following gates before publish, all green:

- `cosign verify` against the workflow OIDC identity.
- `trivy image` and `grype` zero Critical, zero High (or all High suppressed with documented expiry).
- Image digest pinned in every consuming manifest (rejected if any `image:` line uses a tag without digest).
- Pod spec runs as non-root (`runAsNonRoot: true`), read-only root filesystem, dropped capabilities.
- SBOM attached and downloadable via `cosign download sbom`.

Cross-reference `agents/hatch3r-security-auditor.md` for runtime security audit; `agents/hatch3r-devops.md` for delivery integration; `rules/hatch3r-secrets-management.md` for OIDC trust-policy conditions; `rules/hatch3r-dependency-management.md` for SBOM tooling and SLSA provenance.

## References

- Chainguard Images: https://edu.chainguard.dev/chainguard/chainguard-images/overview/
- Distroless: https://github.com/GoogleContainerTools/distroless
- Sigstore cosign: https://docs.sigstore.dev/cosign/overview/
- Sigstore Policy Controller: https://docs.sigstore.dev/policy-controller/overview/
- Kyverno image verification: https://kyverno.io/docs/policy-types/verify-images/sigstore/
- SLSA v1.0 spec: https://slsa.dev/spec/v1.0/
- Trivy: https://trivy.dev/latest/docs/target/container_image/
- CISA tj-actions advisory (CVE-2025-30066): https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-github-action

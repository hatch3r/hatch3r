# Commit Conventions

1. **Format:** Conventional Commits — `type(scope): description`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `audit`
   - Scopes: `cli`, `adapters`, `pipeline`, `content`, `governance`, `audit`, `workspace`, `worktree`
2. **DCO sign-off required:** `git commit -s` (adds `Signed-off-by:` footer)
3. **Audit wave commits:** `audit: wave N -- severity level` format per `governance/AUDIT-EXECUTE.md` Phase 4
4. **PR checks (CI):** Conventional commit format validated, DCO sign-off verified, bundle size reported
5. **No force-push to main.** Feature branches only

CI workflow: `.github/workflows/ci.yml` — supply-chain audit, build matrix (Node 22/24, Ubuntu/macOS/Windows), PR checks.

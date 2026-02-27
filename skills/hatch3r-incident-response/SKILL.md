---
id: hatch3r-incident-response
description: Handle production incidents with structured triage, mitigation, and post-mortem. Use when responding to production issues, outages, or security incidents.
---
# Incident Response Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Classify severity (P0-P3) based on impact
- [ ] Step 2: Triage — identify affected systems, user impact, blast radius
- [ ] Step 3: Mitigate — apply hotfix or rollback, verify mitigation works
- [ ] Step 4: Root cause analysis — trace the failure chain
- [ ] Step 5: Write post-mortem with timeline, root cause, action items
- [ ] Step 6: Create follow-up issues for permanent fixes and preventive measures
```

## Step 1: Classify Severity

| Severity | Definition                                  | Examples                                     |
| -------- | ------------------------------------------- | -------------------------------------------- |
| P0       | Complete outage, data loss, security breach | App unusable, auth down, data exposed        |
| P1       | Major degradation, significant user impact  | Sync failing, billing broken, >1% error rate |
| P2       | Partial degradation, limited impact         | Single flow broken, slow performance       |
| P3       | Minor issue, workaround available            | Cosmetic bug, edge case                     |

- Use **GitHub MCP** (`issue_read`, `search_issues`) to check for related issues or prior incidents.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Triage

- **Affected systems:** Frontend, backend, database, auth, payment, third-party services?
- **User impact:** How many users? Which flows? Which plans (free/paid)?
- **Blast radius:** Is the issue contained or spreading?
- **Data:** Any data corruption, loss, or exposure? Check project privacy/security specs for implications.
- **Timeline:** When did it start? Any recent deploys, config changes, or dependency updates?

## Step 3: Mitigate

- **Immediate actions:** Rollback last deploy, disable feature flag, revert config, scale up, or apply hotfix.
- **Verification:** Confirm mitigation works — error rate drops, affected flow recovers.
- **Communication:** Notify stakeholders if P0/P1. Document status in incident channel or issue.
- Do not spend time on perfect fixes during active incident — stabilize first.

## Step 4: Root Cause Analysis

- Trace the failure chain: what changed, what failed, why.
- Review logs (correlationId, userId), metrics, deploy history.
- Check ADRs in project docs for architectural context.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 5: Post-Mortem

Write a structured post-mortem document:

- **Summary:** One-paragraph description of the incident.
- **Timeline:** Key events (detection, mitigation, resolution) with timestamps.
- **Root cause:** What went wrong and why.
- **Impact:** Users affected, duration, business impact.
- **Action items:** Permanent fixes, preventive measures, process improvements.
- **Lessons learned:** What we'll do differently.

Store in project incident docs or as a GitHub issue/wiki page. Follow project conventions.

## Step 6: Follow-Up Issues

- Create GitHub issues for each action item from the post-mortem.
- Label appropriately (e.g., `incident-follow-up`, `P0`, `P1`).
- Link issues to the post-mortem and to each other.
- Assign owners and due dates for critical fixes.
- Use **GitHub MCP** (`issue_create` or equivalent) to create issues.

## Definition of Done

- [ ] Incident mitigated and verified
- [ ] Post-mortem written with timeline, root cause, and action items
- [ ] Follow-up issues created for permanent fixes and preventive measures
- [ ] Stakeholders notified (if P0/P1)
- [ ] No sensitive data (secrets, PII, code content) in post-mortem or logs

## Additional Resources

- Privacy/security specs: project documentation
- Observability: project logging and correlation conventions
- Error handling: project error handling patterns

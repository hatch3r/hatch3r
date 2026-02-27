---
id: pre-push-security-auditor
type: hook
event: pre-push
agent: security-auditor
description: Scan for secrets and security issues before push
---
# Hook: pre-push → security-auditor

Activate the security-auditor agent before pushing to scan for accidentally committed secrets, API keys, credentials, and other security-sensitive content.

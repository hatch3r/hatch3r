# Sub-Agent Delegation Patterns

Loaded on demand during Step 4b of the issue workflow when the active task goes beyond a single issue — epic decomposition, batch standalone issues, or multi-task plain chat. For a single issue, the inline summary in SKILL.md Step 4b is sufficient.

## Pattern 1: Single Issue

Spawn one `hatch3r-implementer` sub-agent via the Task tool. Include:

- Issue number
- Issue body
- Acceptance criteria
- Issue type
- Researcher output
- Spec references

Await the result.

## Pattern 2: Epic with Sub-Issues

1. **Group sub-issues by dependency level** from the epic's Implementation Order.
2. **Spawn one implementer sub-agent per sub-issue** using the Task tool. Include:
   - Issue number
   - Issue body
   - Acceptance criteria
   - Issue type
   - Parent epic context
   - Spec references
3. **Launch sub-issues at the same dependency level in parallel** — as many concurrently as the platform supports.
4. **Await all sub-agents at a level** before starting the next level.
5. **Review results** from each sub-agent. Resolve any file conflicts between parallel outputs.

## Pattern 3: Multiple Standalone Issues (Batch)

When working on multiple standalone issues (not part of an epic), apply the same parallel pattern:

1. **Group issues by dependency level.** Independent issues (no mutual dependencies) share the same level and run in parallel.
2. **Spawn one researcher sub-agent per issue** in parallel — as many concurrently as the platform supports. Each issue gets individual context gathering since standalone issues are unrelated.
3. **Spawn one implementer sub-agent per issue per level** in parallel — as many concurrently as the platform supports. Each receives its own researcher output.
4. **Await all sub-agents at a level** before starting the next level.
5. **Review results** from each sub-agent. Resolve any cross-issue file conflicts.

## Pattern 4: Plain Chat with Multiple Tasks

When working from plain chat instructions with multiple tasks (numbered lists, multiple issue references, or distinct requests), parse into discrete tasks and apply the batch delegation pattern above.

- For issue references (GitHub Issues, ADO Work Items, or GitLab Issues): fetch issue details using the appropriate platform CLI.
- For natural language tasks: derive title, acceptance criteria, and type from the instruction.

## Protocol Notes

The implementer sub-agent protocol is defined in the `hatch3r-implementer` agent. Each sub-agent handles its own implementation and testing but does NOT create branches, commits, or PRs.

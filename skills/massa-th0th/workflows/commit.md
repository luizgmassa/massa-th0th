### Commit

Use this workflow when the user wants to draft a commit message, prepare a commit, or commit current repository changes. This workflow adapts the local caveman-commit rules into a safe Git workflow for changed files.

Do not use this workflow for Jira ticket creation, release notes, changelogs, PR descriptions, or history rewriting. Route Jira issue work to `workflows/ticket.md`. Route broad release documentation to the relevant feature, RFC, or general workflow.

## Workflow

1. Resolve or reuse `projectId` and `workflowSessionId=commit-<entity>`.
2. Run `recall` for durable project commit conventions, branch naming patterns, and attribution requirements. Treat recalled conventions as leads until current repository evidence confirms them.
3. Inspect current Git state before writing a message:
   - current branch from `git rev-parse --abbrev-ref HEAD`
   - staged paths from `git diff --cached --name-only`
   - unstaged changed paths from `git diff --name-only`
   - status summary from `git status --short`
   - staged diff when anything is staged; otherwise the unstaged diff for allowed paths
4. Extract the first Jira key from the branch with case-insensitive regex `(?<![A-Z0-9])([A-Z][A-Z0-9]{1,9}-[0-9]+)(?![A-Z0-9])`. Normalize the key to uppercase. If no key is found, proceed without a prefix and do not ask.
5. Resolve commit scope:
   - If files are already staged, treat staged files as the user-selected commit scope and do not stage additional files.
   - If nothing is staged and the user explicitly asked to commit, stage only allowed changed files one path at a time with pathspec-safe commands.
   - If the user asked only for a message, do not stage or commit. Output the message in a code block plus any excluded paths.
6. Exclude audit report Markdown files from commit scope:
   - any Markdown file under `audits/`
   - any Markdown basename matching `*-audit.md`
   - If any excluded file is already staged, stop before committing and report the exact paths. Do not unstage user-selected files unless the user explicitly asks.
7. Never stage everything through a shortcut, never commit all tracked modifications automatically, and never reset, checkout, amend, squash, rebase, or rewrite history unless the user separately requests that exact operation.
8. Draft the commit message using caveman-commit rules:
   - Conventional Commits format: `<type>(<scope>): <imperative summary>`, with scope optional.
   - Type precedence when multiple apply: `fix`, `feat`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `style`, `chore`, `revert`. Use `revert` only when the commit's primary purpose is reverting an earlier change.
   - Subject is imperative, has no trailing period, targets 50 characters when practical, and has hard cap 72 characters including any Jira prefix.
   - With a Jira key, prefix the subject exactly as `[<KEY>] `, for example `[SA-142] fix(auth): reject expired tokens`.
   - Match existing project capitalization after the colon when current history or nearby commits make it clear.
   - Body is required for breaking changes, migrations, security fixes, reverts, linked issues, or rationale not inferable from the diff. Wrap body lines at 72 characters.
   - Do not include AI attribution unless the repository explicitly requires an attribution trailer.
9. If committing, run the commit with the exact drafted message only after the final staged-path audit report exclusion check passes. If the commit fails, report the exact failure and leave staging untouched.
10. Complete `references/evidence-gate.md`, including branch key detection result, staged path policy, excluded audit Markdown paths, command outcome, skipped checks, memory outcome, and residual risk.

## Failure Handling

- No changes: stop and report that there is nothing to commit.
- Only excluded audit Markdown changed: stop and report excluded paths; do not create an empty commit.
- Detached HEAD or unreadable branch: proceed without Jira prefix and report the branch state.
- Ambiguous commit type: use the type precedence list; ask only if two candidate types would materially change downstream release behavior.
- Excluded file already staged: stop before committing and report the exact staged audit Markdown paths.
- Commit command fails: report the failure, do not retry unchanged more than once, and do not alter staging to force success.

## Examples

User asks: "Use the commit workflow and commit this."

Actions: inspect branch and staged state, stage only allowed changed files if none are staged, exclude audit Markdown, generate a concise Conventional Commit message, add Jira prefix if branch contains a key, run the commit, then report evidence.

User asks: "Write a commit message."

Actions: inspect diff and branch, generate the message in a code block, list excluded audit Markdown paths, and do not stage or commit.

User asks: "Commit everything, but leave audit reports out."

Actions: stage allowed changed files individually, exclude `audits/**/*.md` and `*-audit.md`, stop if an excluded file is already staged, and commit only the allowed scope.

# massa-th0th Commit Workflow

Human-facing guide for the safe commit workflow built directly into `massa-th0th`. Canonical agent instructions live in [`workflows/commit.md`](../../skills/massa-th0th/workflows/commit.md).

## Purpose

Use this workflow to draft or create concise Conventional Commits from current repository changes. It adapts caveman-commit message rules and adds repository safety: Jira key prefixes from branch names, path-scoped staging, and audit report Markdown exclusions.

## Quick Start

```text
Use the commit workflow and commit the current changes.
```

```text
Write a commit message for this diff.
```

```text
Commit everything except audit reports.
```

## Behavior

- Reads the current branch and changed files before drafting a message.
- Extracts the first Jira key from the branch with `(?<![A-Z0-9])([A-Z][A-Z0-9]{1,9}-[0-9]+)(?![A-Z0-9])`, normalizes it to uppercase, and prefixes the subject as `[KEY] `.
- Uses Conventional Commits with short imperative subjects and bodies only when the why is not obvious.
- Treats already staged files as user-selected scope and does not stage extra files.
- When asked to commit and nothing is staged, stages only allowed changed files one path at a time.
- Excludes Markdown files under `audits/` and any Markdown basename matching `*-audit.md`.
- Stops before committing if excluded audit Markdown is already staged.
- Does not rewrite history, amend, or alter staging to force a commit.

## Boundaries

- The workflow can draft messages without committing.
- It commits only when the user explicitly asks for a commit.
- Jira ticket creation remains owned by the ticket workflow.
- Release notes, changelogs, and PR descriptions are separate documentation tasks.

## Troubleshooting

- No Jira key in branch: the subject is generated without a prefix.
- Detached HEAD: the workflow proceeds without a prefix and reports the branch state.
- Only audit reports changed: no commit is created.
- Audit report already staged: the workflow stops and reports exact paths so the user can decide whether to unstage them.
- Commit fails: staging is left untouched and the exact Git failure is reported.

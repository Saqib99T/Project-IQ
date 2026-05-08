# Specs

This folder holds feature specifications written **before** implementation begins.

## Naming Convention

```
NNN-short-feature-name.md
```

Example: `001-glpi-ticket-auto-close.md`

## Lifecycle

| Stage | What happens |
|-------|-------------|
| **Draft** | Spec written, open for discussion in the linked GitHub Issue |
| **Approved** | Issue labelled `spec:approved` — implementation may begin |
| **In Progress** | Implementation PR opened with `Closes #N` |
| **Done** | Issue closed when impl PR is merged |

## Workflow

```
1. Open a GitHub Issue using the "Specification" template
2. Discuss and refine in the issue comments
3. Add label `spec:approved` when the team agrees
4. Create a branch: impl/<short-name>
5. Open a PR that closes the spec issue
6. PR must pass the Spec Linkage Check CI job
```

## Index

| # | Title | Status | Issue |
|---|-------|--------|-------|
| — | *(no specs yet — create the first one!)* | — | — |

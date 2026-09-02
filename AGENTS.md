# Project Engineering Instructions

Apply these instructions alongside the global engineering guardrails and the
repository's existing conventions.

## Named transformation boundaries

For non-trivial data transformations, named functions are mandatory:

- If one expression combines multiple meaningful steps such as filtering,
  mapping, deduplication, normalization, validation, grouping, or sorting,
  split those steps into small named functions or clearly named stages.
- Extract policies into named functions, especially policies for selecting,
  deduplicating, validating, or ordering domain data.
- Prefer names that describe the outcome or rule, such as
  `deduplicateOptionsByValue` or `sortOptionsByLabel`, rather than mechanics
  such as `processRows`.
- Inline one-step transformations remain acceptable when their intent is
  obvious and they do not hide a domain rule.
- Do not introduce a wrapper that only renames one call or adds indirection
  without improving a boundary, policy, testability, or readability.

Code review should treat violations of the first three bullets as a
maintainability defect, not merely a style preference.

## Cyclomatic complexity policy

Treat cyclomatic complexity as a review signal, not a universal requirement that
functions score two or less. The configured lint ceiling is a prompt for review,
not a reason to move branches into disconnected wrappers. Higher complexity is
acceptable when branches are flat, answer one clearly named domain question,
mutate little state, do not interact in complex ways, and remain short. Keep
high-level coordinator decisions visible; keep worker execution, validation,
retry, state transitions, and side effects separate where those boundaries add
meaning. Prefer useful domain operations over score-driven extraction.

## Windmill script constraints

Files under `windmill_agent_scripts/` are deployed as flat Windmill scripts.
Keep their public paths and `main` signatures stable unless a deliberate
migration updates the deployment contract. Shared logic may live in sibling
flat files and use relative extensionless imports, but helper files without a
`main` are libraries and must not become additional public tools.

Every runnable Windmill file must export its `main` entrypoint. Keep Windmill
runtime concerns at the boundary: use Bun-compatible TypeScript, explicit
argument types, and JSON-safe values. Local filesystem paths are not available
on remote workers; read local files in the CLI and pass validated content as
explicit execution input. Secret values must never be logged or returned in
operation results. When changing shared behavior, update the corresponding
`xyops/` implementation and verify both implementations remain behaviorally
aligned, while preserving Windmill's flatness and entrypoint constraints.

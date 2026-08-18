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

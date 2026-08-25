# Engineering Audit

## Scope and baseline — historical `d163e95` audit

- Repository: Voiceflow project migration tooling
- Baseline commit: `d163e95`
- Working tree before audit: clean
- Audit mode: read-only
- Production files changed: none
- Tests executed: none
- Primary standards: repository `AGENTS.md` and global engineering guardrails

This report is the canonical audit scratchpad and final synthesis. It records
the subsystem inventory, accepted findings, rejected/deferred findings,
dependencies, priorities, risks, and audit log.

## Coverage contract

| ID | Subsystem | Exact ownership | Public interfaces and callers | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | Modular contracts and infrastructure | `shared_contract_types.ts`, `migration_diagnostics.ts`, `jwt_authentication_context.ts`, `http_api_client.ts` | Shared migration types, diagnostics, JWT context, bounded HTTP | None | Recommend |
| S2 | Modular catalog and Logux transport | `logux_websocket_transport.ts`, `catalog_discovery_service.ts` | Workspace/project/version/folder discovery | None | Recommend semantic FP composition |
| S3 | Modular migration core | `export_project_api.ts`, `import_project_api.ts`, `project_api_key_retrieval.ts`, `project_migration_orchestrator.ts` | Export, import, API-key status, composed migration | None | Recommend |
| S4 | Entrypoints and local CLI | `export_script_entrypoint.ts`, `import_script_entrypoint.ts`, `migration_script_entrypoint.ts`, `xyops/migration-cli.ts` | Windmill `main`, `DynSelect_*`, interactive CLI | None | Skip simplification; hardening note |
| S5 | MCP agent infrastructure | `xyops/voiceflow/vf_contracts.ts`, `vf_auth.ts`, `vf_http.ts`, `vf_logux.ts`, `vf_catalog.ts`, `vf_planning.ts` | Stable envelopes, authentication, catalog discovery, plan construction | Folder-only contract test | Recommend |
| S6 | MCP agent operations | `vf_check_session.ts`, list tools, `vf_plan_migration.ts`, `vf_execute_migration.ts`, `vf_export.ts`, `vf_import.ts`, `vf_api_key.ts` | Seven MCP-facing `main` tools | Folder-only contract test | Recommend |
| S7 | Standalone and compatibility implementations | `migration_correct.ts`, `migration_script_single_file.ts`, `migrate_voiceflow_project.ts` | Alternative self-contained Windmill entrypoints | None | Recommend ownership clarification |
| S8 | Tests | every `tests/*.ts` file | Production contracts, boundary effects, cleanup, and regression behavior | Self | Recommend targeted isolation/effect assertions |
| S9 | Documentation and project policy | `README.md`, `xyops/voiceflow/README.md`, `AGENTS.md` | Deployment inventories, contracts, operational policy | N/A | Recommend |

No frontend application, generated `./wmill` module, package manifest,
TypeScript project configuration, CI configuration, or Windmill deployment
manifest is tracked in this baseline.

## Executive summary

The split packaging is intentional: `xyops/voiceflow/*` is the Windmill-facing
form required by the platform, while `migration_correct.ts` is the one-file
form. The split itself is not a maintainability defect and must not be
collapsed. The split implementation generally follows the engineering style
guardrails, but the audit found two high-priority boundary defects: destructive
confirmation accepts truthy non-booleans, and several maintained forms lack
bounded dependency reads. Test coverage remains too small for safe changes to
non-idempotent migration behavior. The lifecycle and expected parity of the
split, one-file, and older variants must also be documented precisely.

Recommended sequence:

1. Document the required split and one-file forms and their parity policy.
2. Add focused tests around the production `xyops/voiceflow/*` form.
3. Enforce literal confirmation and bounded HTTP/WebSocket reads.
4. Apply destination-folder validation at every import boundary.
5. Fix typed error/result-state and retry-policy defects.
6. Add typed catalog projections and named transformation boundaries.

## Engineering code-style guardrail audit

This pass evaluates architecture and implementation style rather than cosmetic
formatting. Semicolons, quote style, indentation, and line length remain owned
by local conventions and formatters.

Priority legend: P1 requires correction before relying on the affected safety
boundary; P2 is a material maintainability defect to schedule after P1 and its
required tests.

### Compliance matrix

| Implementation form | Result | Evidence summary |
| --- | --- | --- |
| Split private libraries in `xyops/voiceflow/*` | Partial compliance | Catalog composition is corrected; auth and plan-ID Promise stages still need work |
| Split public tools in `xyops/voiceflow/*` | Partial compliance | Windmill adapters are appropriately small; confirmation, retry policy, and API-key state have contract defects |
| Root modular implementation | Mostly compliant | Named transformations and bounded transports are strong; diagnostic construction, folder validation, result state, and orchestration naming need correction |
| `migration_correct.ts` one-file form | Partial compliance | Packaging is accepted; unbounded effects, `any`, and unnamed selector pipelines violate guardrails |
| `migration_script_single_file.ts` | Mostly compliant | Maintains internal named boundaries and bounded transport; folder validation remains incomplete; generated-copy naming changes are deferred |
| `migrate_voiceflow_project.ts` | Partial compliance | Same unbounded transport, untrusted `any`, and unnamed selector-pipeline concerns as the one-file form |
| Tests | Partial compliance | Ten files cover the major contracts; confirmation mock isolation and one zero-I/O assertion remain |

### CS1. Destructive confirmation must require a literal boolean

**Priority:** P1
**Guardrails:** Boundary validation, deliberate input handling, destructive-operation safety

`xyops/voiceflow/vf_execute_migration.ts:61-74` declares `confirmed` as a
boolean but checks it with `if (!confirmed)`. Runtime callers can supply a
truthy string, number, or object and bypass the confirmation gate.

The smallest fix is `confirmed !== true`, retaining the boolean annotation for
Windmill schema generation. Validate that `undefined`, `false`, `"false"`,
`"true"`, `1`, and objects perform no authentication, export, or import, while
literal `true` proceeds. The compatibility risk is limited to callers that
currently rely on coercion.

### CS2. Maintained dependency boundaries need timeout and size ownership

**Priority:** P1
**Guardrails:** Explicit resource ownership, cancellation, bounded external data

- `migration_correct.ts:81-90,327-362` performs API-key, export, and import
  requests without a timeout or abort signal. `readBoundedResponse` checks the
  size only after `arrayBuffer()` has allocated the complete body.
- `migrate_voiceflow_project.ts:53-73,285-324` reads dependency bodies without
  bounded streaming or cancellation.
- `xyops/voiceflow/vf_logux.ts:85-119`, `migration_correct.ts:149-205`, and
  `migrate_voiceflow_project.ts:107-164` have no incoming frame-size or
  accumulated-row bound.
- The root `http_api_client.ts` and `logux_websocket_transport.ts:90-96`
  demonstrate the intended bounded lifecycle.

Add named one-file HTTP helpers that own one deadline across headers and body,
enforce streaming limits, cancel readers, and translate failures. Add frame and
aggregate bounds to the split and one-file Logux transports. Limits require
production calibration; tests must cover stalled headers/bodies, oversized
declared and chunked bodies, oversized WebSocket frames, accumulated rows,
cleanup, and credential-safe errors.

### CS3. Destination-folder policy must be enforced at import boundaries

**Priority:** P2
**Guardrails:** Validate untrusted input at the boundary; name domain policies

The split form defines the current policy in
`xyops/voiceflow/vf_import.ts:12-17`, requiring a numeric folder ID. Other forms
do not enforce it when called directly:

- `migration_correct.ts:337-348`;
- `migrate_voiceflow_project.ts:295-306`;
- `migration_script_single_file.ts:388-407`;
- `import_project_api.ts:40-59`.

Dynamic selectors are not validation boundaries. Introduce one named
`parseDestinationFolderID` policy per required deployable form and use it both
for options and immediately before import effects. First confirm that numeric
IDs are the complete production contract. Test direct invocation, stale/manual
values, project IDs, blank values, workspace mismatch, and zero transport
calls on rejection.

### CS4. Keep raw rows at transport edges and project typed catalog models

**Priority:** P2
**Guardrails:** Type-first execution, null safety, runtime validation of external data

`Record<string, unknown>` is appropriate inside the undocumented Logux wire
boundary. It becomes a style defect when exposed across catalog APIs:

- `xyops/voiceflow/vf_catalog.ts:6,57-81` returns raw `Row[]` from public loaders;
- `catalog_discovery_service.ts:5,53-54` exposes the same generic shape.

Keep raw records private to transport parsing, then add tolerant runtime
projectors for workspace, project, environment, and folder records. Public
catalog operations should return readonly domain projections or `Option[]`.
Preserve known aliases and current malformed-record omission behavior. Tests
must cover `_id`/`id`, missing labels, environment arrays/maps, malformed rows,
workspace mismatch, and numeric-folder filtering.

### CS5. API-key outcomes permit contradictory states

**Priority:** P2
**Guardrails:** Make invalid states difficult to represent; explicit nullability

- Root: `shared_contract_types.ts:28-35` independently models
  `apiKeyRetrieved` and optional `postImport`.
- Split: `xyops/voiceflow/vf_api_key.ts:5-8` and
  `vf_execute_migration.ts:15-24` repeat the same independent fields.
- `project_migration_orchestrator.ts:70-83` assembles those fields separately.

These contracts permit success with a failure diagnostic and failure without
one. Replace the independent fields with a discriminated success/failure union
while preserving the serialized success and failure shapes. Verify Windmill
schema generation and existing consumer compatibility; add compile-time tests
for impossible combinations and runtime tests for both branches.

### CS6. Diagnostic sanitization is overwritten

**Priority:** P2
**Guardrails:** Stable error boundaries and non-secret, bounded diagnostics

`migration_diagnostics.ts:62-78` sanitizes `nextAction` and then spreads
`...options` afterward, allowing the original unsanitized value to overwrite
the invariant. Spread caller options first, then assign `phase`, `code`,
generated ID, retry policy, and sanitized action. Test control characters,
length limits, defaults, and preservation of allowed metadata.

### CS7. HTTP retryability is inconsistent

**Priority:** P2
**Guardrails:** Distinguish retryable from permanent dependency failures

`xyops/voiceflow/vf_check_session.ts:31-32` marks every unexpected non-2xx status
retryable, while `vf_export.ts:30-31` marks every non-2xx status permanent via
the `OperationFault` default at `vf_contracts.ts:76-80`.

Introduce one pure named status policy shared by read-only HTTP operations.
At minimum, explicitly decide behavior for `400`, `404`, `408`, `429`, and
representative `5xx` responses. Preserve the intentional inactive-session
result for `401`/`403`. Any retry consumer must use bounded backoff.

### CS8. One-file selector pipelines violate mandatory named boundaries

**Priority:** P2
**Guardrails:** `AGENTS.md:8-17` named transformation boundaries

The following inline expressions combine selection and projection without
named policy stages:

- `migration_correct.ts:234-239,251-256,309-314`;
- `migrate_voiceflow_project.ts:192-197,209-214,267-272`.

Extract precise policies such as `selectWorkspaceRows`,
`selectProjectsForWorkspace`, `selectFoldersForWorkspace`, and
`buildCatalogOptions`. This is required by the repository instructions, not a
line-count preference. Preserve existing ordering, labels, and omission rules
with focused pure tests.

### CS9. Untrusted one-file data uses `any`

**Priority:** P2
**Guardrails:** Type-first external boundaries; validate before use

`migration_correct.ts:11,150` and `migrate_voiceflow_project.ts:11,108` use
`Record<string, any>` and `message: any` for JWT and Logux payloads. Replace
these with `unknown`, record/array guards, and typed protocol events before
property access. The risk is accidentally tightening permissive payload
compatibility; test malformed frames and every accepted payload alias.

### CS10. Modular orchestration uses compressed, imprecise names

**Priority:** P2
**Guardrails:** Explicit naming, readable effect order, functional core/imperative shell

`project_migration_orchestrator.ts:61-73` compresses sequential effects into
`a`, `ex`, and `im`, followed by one-line mutable post-import handling. Rename
these to `auth`, `exportArtifact`, and `importResult`, and return the API-key
outcome from a named function. This change should follow tests and CS5 so the
new function returns the discriminated state rather than another wrapper.

The copied occurrence in `migration_script_single_file.ts:889-901` is deferred
until its generation/parity ownership is explicit; do not hand-normalize a
generated or compatibility artifact independently.

### CS11. Compose one-effect boundaries with pure unary stages

**Priority:** P2
**Guardrails:** Functional core/imperative shell, Promise composition, partial application

Windmill exports are legitimate platform adapters and may remain named function
declarations. Within any adapter or service, one dependency effect followed
immediately by one pure projection must use direct Promise composition. Pass a
matching transformer directly or partially apply stable domain context to
produce a unary stage.

The current working tree fixes this in `xyops/voiceflow/vf_catalog.ts`. Remaining
sites include the private authentication pipeline in `xyops/voiceflow/vf_auth.ts`,
the digest tail in `xyops/voiceflow/vf_planning.ts`, root catalog operations in
`catalog_discovery_service.ts`, and maintained one-file selectors in
`migration_correct.ts`. Preserve Promise rejection timing, plan-ID bytes, and
Windmill export signatures with focused contract tests.

### Code-style findings explicitly rejected

- Do not merge `xyops/voiceflow/*`; the split is required by Windmill.
- Do not remove direct selector/entrypoint adapters; they translate a real
  static-discovery and MCP contract.
- Do not extract `vf_logux.ts` protocol interpretation solely to make its
  callback shorter. Socket lifecycle and terminal protocol frames belong to
  the same transport adapter; only bounds and independently testable parsing
  policies justify extraction.
- Do not introduce an FP library, universal `Result` container, blanket
  branding, currying, or point-free style.
- Do not add comments to self-explanatory transformations. Keep comments for
  compatibility, protocol, security, and resource-lifecycle rationale.

## Confirmed recommendations

### R1. Document required packaging and parity ownership

**Verdict:** Recommend
**Impact:** Medium
**Confidence:** High
**Effort:** Small
**Blast radius:** Small

#### Evidence

- The project owner confirmed that `xyops/voiceflow/*` is intentionally split to
  satisfy Windmill's deployment requirements.
- `migration_correct.ts` is intentionally the one-file form.
- `xyops/voiceflow/README.md` documents the ordered deployment of the split
  private libraries and public tools.
- `migration_script_single_file.ts` embeds a separate 998-line copy of the
  modular graph.
- `migrate_voiceflow_project.ts` contains another standalone implementation.

The required split and one-file forms have different packaging and interfaces.
Those differences are not defects by themselves. The remaining audit concern
is whether shared migration rules are expected to stay behaviorally aligned
and how the additional standalone files relate to those two known forms.

#### Current complexity and invalid states

When behavior is expected to be equivalent, a fix to one form does not
automatically update the other. Without a documented parity policy, reviewers
cannot distinguish intentional interface differences from accidental drift.

#### Proposed representation

Document these roles explicitly:

- `xyops/voiceflow/*`: required split Windmill deployment form;
- `migration_correct.ts`: one-file form;
- each additional standalone file: generated artifact, compatibility form,
  reference implementation, or legacy file.

Record which business rules must remain equivalent across forms and which
input/result differences are intentional. Do not combine the split files when
that would violate Windmill's deployment model.

#### Smallest credible scope

Correct the README with the confirmed roles and parity expectations. This does
not require changing, generating, or deleting production scripts.

#### Risks and migration concerns

- Collapsing the split would break the required Windmill structure.
- Declaring full parity where interfaces intentionally differ would create
  false requirements.
- If shared rules are copied manually, future fixes can still drift.

#### Validation required

- Confirm the required Windmill paths and deployment order.
- Record the intentional input/result differences.
- Add shared contract cases only for behavior expected to remain equivalent.

### R2. Add tests before structural changes

**Verdict:** Recommend — prerequisite
**Impact:** High
**Confidence:** High
**Effort:** Medium
**Blast radius:** Small

#### Evidence

The only tracked test is `tests/vf_folder_validation.test.ts`, covering two
folder-ID cases.

No tracked tests cover:

- JWT parsing and invalid claims;
- HTTP timeout and response-size policy;
- Logux rejection, malformed frames, timeout, and close handling;
- catalog normalization, duplicate IDs, environment shapes, and labels;
- plan normalization and deterministic plan IDs;
- confirmation and plan mismatch;
- import receipt parsing and `IMPORT_OUTCOME_UNKNOWN`;
- API-key response variants;
- CLI exit behavior;
- standalone migration contracts.

#### Current complexity

Destructive behavior is non-idempotent, yet its confirmation, ambiguity, and
retry contracts are mostly protected by static reasoning rather than tests.

#### Proposed representation

Build a small behavior-oriented suite around the production
`xyops/voiceflow/*` graph:

- pure validation/catalog/plan tests;
- mocked HTTP and WebSocket boundary tests;
- orchestration order and failure-state tests;
- contract snapshots for Windmill inputs/results.

#### Risks

Over-mocking implementation details can make refactoring harder. Tests should
target public contracts and effect ordering.

#### Validation required

Run the repository's owning test stack and ensure every destructive branch has
a deterministic credential-free fixture.

### R3. Define plan and execution-state semantics

**Verdict:** Recommend as an architecture decision, not a local cleanup
**Impact:** High
**Confidence:** High
**Effort:** Medium–large
**Blast radius:** Large

#### Evidence

- `vf_planning.ts` hashes only normalized selection fields.
- `vf_execute_migration.ts` rebuilds that plan and compares only `planID`.
- `vf_contracts.ts` has success/failure envelopes but no durable plan state,
  expiry, idempotency key, reconciliation record, or phase status.
- `xyops/voiceflow/README.md` explicitly documents cooperative confirmation and
  non-idempotent execution.

#### Current complexity and invalid states

The plan ID binds arguments, not a catalog snapshot or immutable source
version. Renamed or changed resources may retain the same plan ID.

The failure envelope cannot carry partial state such as “exported” or
“import outcome unknown” together with structured reconciliation metadata.

#### Proposed representation

Explicitly decide whether a plan is:

- an argument-binding token; or
- a persisted, expiring approval snapshot.

If stronger guarantees are required, introduce a durable state model with
plan expiry, resource/version fingerprint, operation ID, and reconciliation
status.

#### Risks

Changing plan IDs or result envelopes is a public contract change. Do not add
labels to the hash as a cosmetic fix; labels do not establish source
immutability.

#### Validation required

- Document TTL and replay behavior.
- Test stale plans, renamed resources, changed source versions, retries, and
  unknown import outcomes.

### R4. Consolidate narrow agent input-validation policies

**Verdict:** Recommend
**Impact:** Medium
**Confidence:** High
**Effort:** Small–medium
**Blast radius:** Medium

#### Evidence

Required nonblank string validation is repeated in:

- `vf_planning.ts`;
- `vf_catalog.ts`;
- `vf_export.ts`;
- `vf_import.ts`;
- `migration_script_entrypoint.ts`.

#### Current complexity

Repeated string normalization can drift while appearing equivalent.

#### Proposed representation

Extract one pure agent-side `requiredString` policy. Keep separate domain
validators for:

- JWTs;
- numeric folder IDs;
- safe `.vf` filenames;
- schema versions;
- project/version/workspace ownership.

Do not merge root diagnostics and agent envelopes; they are separate public
contracts.

#### Risks

A universal validator can erase phase-specific error semantics or accidentally
accept values currently rejected.

#### Validation required

Table-driven tests for null, non-string, blank, padded, malformed, and valid
inputs at each boundary.

### R5. Improve API-key outcome categories

**Verdict:** Recommend
**Impact:** Medium
**Confidence:** High
**Effort:** Medium
**Blast radius:** Medium

#### Evidence

`xyops/voiceflow/vf_api_key.ts` collapses all of these into one diagnostic:

- timeout;
- HTTP failure;
- malformed response;
- missing key;
- multiple keys;
- invalid key format.

The non-fatal behavior is correct, but the result loses actionable policy.

#### Proposed representation

Keep the key private and preserve non-fatal import success, but return a closed
diagnostic union such as:

- timeout;
- unauthorized;
- dependency unavailable;
- malformed response;
- missing key;
- ambiguous key.

#### Risks

Consumers may depend on the current single diagnostic code. This is an
additive/versioned contract change, not a silent replacement.

#### Validation required

Mocked responses for every category, including duplicate equivalent keys and
multiple distinct valid keys.

### R6. Remove or fully adopt branded IDs

**Verdict:** Recommend — low priority
**Impact:** Low
**Confidence:** High
**Effort:** Small
**Blast radius:** Medium

#### Evidence

`shared_contract_types.ts:1-4` declares branded workspace, project, version,
and folder IDs, but actual domain fields remain plain strings. Some APIs accept
`string | Brand`, which is effectively just `string`.

#### Proposed representation

Either:

1. construct and propagate branded values only after runtime validation; or
2. remove unused brands and use validated strings consistently.

The smaller, evidenced simplification is removal unless external TypeScript
consumers rely on these exports.

#### Risks

Removing exported aliases can break compile-time consumers even though runtime
behavior is unchanged.

#### Validation required

Search all consumers and type-check before removal.

### R7. Correct deployment inventory documentation

**Verdict:** Recommend
**Impact:** Low–medium
**Confidence:** High
**Effort:** Trivial
**Blast radius:** Small

#### Evidence

- `README.md` lists 14 canonical files and three entrypoints, then calls the
  remaining files “nine helpers”; there are eleven.
- `migration_correct.ts` and `migration_script_single_file.ts` are not assigned
  an explicit deployment lifecycle.

#### Proposed representation

Correct counts and add a deployment matrix using the confirmed split and
one-file roles.

## Explicit skip decisions

### Selector duplication

Skip. Windmill static discovery requires direct `DynSelect_*`/function exports.
Refactoring these into re-exports has uncertain deployment behavior and little
benefit.

### Raw Logux wire rows

Skip replacing `Record<string, unknown>` inside the undocumented transport
boundary. CS4 requires tolerant runtime projection before those rows cross the
catalog boundary; it does not claim the wire data is already trustworthy.

### Root HTTP response lifecycle replacement

Skip. The root modular lifecycle preserves one timeout across response headers
and streamed body, with explicit cleanup. CS2 applies to the one-file/legacy
forms and to missing WebSocket bounds, not this established helper.

### Agent catalog caching

Skip. Live catalog reads before execution are intentional freshness checks.

### Further execute-function extraction

Skip at this baseline. The current function already separates selection,
warnings, planning, effects, and envelope translation sufficiently; more
helpers risk indirection without changing ownership. CS1 still requires an
exact runtime confirmation check, and CS5 requires a stronger result type.

### Test fixture framework

Skip. One short test file does not justify shared fixture infrastructure.

## Cross-cutting risks and non-simplification findings

These are important but are not simplification recommendations:

- JWT signatures are not verified; this is a documented security decision.
- API-key/secret patching is not implemented.
- Confirmation is cooperative rather than server-enforced; CS1 still requires
  a literal runtime boolean at the destructive entrypoint.
- Migrations are non-idempotent.
- `IMPORT_OUTCOME_UNKNOWN` requires destination reconciliation before retry.
- Ctrl-C during hidden CLI token input becomes an empty token and proceeds to
  catalog failure rather than immediate cancellation.
- There is no tracked package/TypeScript/CI/deployment manifest to validate
  generated schemas or dependency locks.

## Priority and dependency order

1. Document the confirmed split, one-file, generated, and legacy ownership.
2. Add focused tests for confirmation, transport bounds, and import validation.
3. Enforce literal confirmation and bounded HTTP/WebSocket lifecycles.
4. Apply the destination-folder policy at every import boundary.
5. Fix diagnostic sanitization, retry policy, and API-key result-state unions.
6. Add typed catalog projections and named selector transformations.
7. Improve modular orchestration names and effect readability.
8. Define plan/operation state semantics.
9. Improve API-key diagnostic categories and resolve unused branded IDs.
10. Address CLI cancellation as separate operational hardening.

## Best first implementation slices

### Slice 1 — documentation and ownership

- Record the required split Windmill paths and deployment order.
- Add a split-versus-one-file deployment matrix.
- Mark other generated, compatibility, reference, and legacy files explicitly.
- Correct helper counts and stale filenames.

### Slice 2 — behavior tests

- Authentication parsing.
- Catalog normalization and ownership.
- Literal confirmation and zero effects on rejected values.
- HTTP and WebSocket timeout, size, cancellation, and cleanup behavior.
- Destination-folder validation at every import boundary.
- Import receipt and outcome ambiguity.
- API-key response categories.

### Slice 3 — boundary safety corrections

- Require `confirmed === true` before all destructive effects.
- Reuse bounded transport lifecycles in the maintained one-file forms.
- Add Logux frame and aggregate limits.
- Apply a named destination-folder policy at import boundaries.

### Slice 4 — type and transformation style

- Add one pure required-string policy for agent scripts.
- Project raw catalog records into typed domain models.
- Represent API-key outcomes as a discriminated union.
- Extract named selector transformations in the one-file forms.
- Replace untrusted `any` values with `unknown` and guards.
- Expand abbreviated modular orchestration names.
- Keep field-specific rules and public error contracts intact.

## Superseded and rejected findings

- Consolidating `xyops/voiceflow/*` into the one-file form is rejected because
  the split is required by Windmill.
- Physical deletion of other standalone variants is superseded by explicit
  lifecycle documentation.
- Selector consolidation is rejected due to Windmill static-discovery risk.
- Catalog caching/deduplication is deferred because snapshot semantics are not
  established.
- A generic envelope redesign is deferred until plan/idempotency product
  semantics are decided; the narrow API-key outcome union in CS5 is accepted.

## Semantic FP follow-up audit — current working tree

This follow-up audits the current working tree rather than replacing the
historical `d163e95` baseline above. It covers all 49 current TypeScript files,
all 15 test files, repository policy/docs, and the global engineering
guardrails. Function declarations are permitted; findings concern purity,
immutability, composition, effect ownership, and explicit failure data.

### Findings and resolution

| ID | Priority | Ownership | Resolution | Status |
| --- | --- | --- | --- | --- |
| FP-AUTH | P2 | `xyops/voiceflow/vf_auth.ts` | Pure token/context stages with preserved rejected-Promise boundary | Resolved |
| FP-PLAN | P2 | `xyops/voiceflow/vf_planning.ts` | Named SHA-256 digest formatter composed through `.then` | Resolved |
| FP-KEYS | P2 | `xyops/voiceflow/vf_api_key.ts` | Named selection, normalization, validation, deduplication, and cardinality policies | Resolved |
| FP-JWT | P2 | `jwt_authentication_context.ts` | Named token, claims, precedence, and creator-ID stages | Resolved |
| FP-ROOT-CATALOG | P2 | root Logux/catalog modules | Direct Promise return plus partially applied unary catalog stages | Resolved |
| FP-ORCHESTRATOR | P2 | root migration contracts/orchestrator | Discriminated API-key outcome and immutable post-import result | Resolved |
| FP-ROOT-GUARDS | P2 | root import/orchestrator boundaries | Array-safe record guards replace unproven object assertions | Resolved |
| FP-ONEFILE-LIFECYCLE | P1 | `migration_correct.ts` | Deterministic settlement, detached handlers, immutable snapshots, and safe send effects | Resolved |
| FP-ONEFILE-TYPES | P2 | `migration_correct.ts` | Readonly `RawRecord` data and `unknown` guards at JWT/Logux boundaries | Resolved |
| FP-ONEFILE-COMPOSE | P2 | `migration_correct.ts` | Partially applied selector stages and direct Promise composition | Resolved |
| FP-TEST-ISOLATION | P1 | test suite | Restored/isolated module and global effects | Resolved |
| FP-TEST-EFFECT | P2 | test suite | Invalid folder paths prove zero request effects | Resolved |
| FP-POLICY | P2 | policy and audit docs | Scripts/adapters explicitly retain semantic FP obligations | Resolved |

### Explicit current skips

- `migration_script_single_file.ts` is not hand-normalized until its generation
  and parity ownership are confirmed.
- `migrate_voiceflow_project.ts` remains legacy/reference or compatibility code;
  remediation requires evidence that it is still maintained or deployed.
- Windmill selector and `main` wrappers remain because static discovery and
  boundary translation are real platform contracts.
- HTTP/WebSocket local mutation, CLI reader state, and `async`/`await` for
  dependent effects, branching, cleanup, and error translation are retained.
- Agent export and broad root entrypoint `async` functions are not mechanically
  converted to `.then`; their status/error translation and dependent effects
  justify imperative orchestration.
- Root direct-import numeric folder validation is decision-required because
  enforcing it would intentionally reject inputs that the historical root API
  currently forwards. It was not silently changed in a behavior-preserving
  refactor.

### Completed behavior-preserving remediation sequence

1. Strengthen test isolation and zero-effect assertions.
2. Add auth, plan-ID, API-key, JWT, and root-catalog contract fixtures.
3. Apply low-risk named pure stages and Promise composition.
4. Repair maintained one-file callback settlement and untrusted boundary types.
5. Replace root mutable post-import state with one immutable outcome.

### Initial baseline audit log — historical

- Established four explicit review boundaries plus generated/deployment
  ownership.
- Used fresh read-only subsystem reviewers.
- Independently validated repository coverage and priority/materiality.
- Corrected R1 after project-owner clarification: the split and one-file forms
  are intentional packaging variants, not evidence of an unknown canonical
  implementation.
- Added four fresh, non-overlapping code-style reviews covering split private
  libraries, split public tools, root modular code, and one-file/legacy forms.
- Independently validated style materiality and rejected cosmetic formatting,
  required Windmill wrappers, and unjustified protocol extraction.
- Recorded ten concrete guardrail findings with exact evidence, risk, and
  validation requirements.
- Correction after follow-up review: the audit failed to flag single-effect
  `async` wrappers in `vf_catalog.ts` that immediately applied pure option
  transformations and then initially retained inline forwarding closures. The
  repository and global guardrails now require direct Promise composition and
  partially applied unary stages for that shape.
- Rejected intentional selector duplication and speculative abstractions.
- No production files were edited.
- No tests, builds, commits, or deployments were performed.
- Repository remained at clean baseline `d163e95` until this report was added.

### Current follow-up evidence

- All 49 current TypeScript files and all 15 tests received a semantic-FP
  verdict; no maintained file was hidden by a broad subsystem row.
- 131 tests passed with 463 assertions across 15 files.
- All split public tools, root entrypoints, CLI, maintained one-file,
  generated/reference single-file, and legacy entry bundles compiled.
- No live network or destructive Voiceflow migration was executed.
- No files were staged or committed as part of this follow-up.
- `migration_script_single_file.ts` and `migrate_voiceflow_project.ts` remain
  explicitly deferred nonconformant scope pending ownership/deployment evidence.

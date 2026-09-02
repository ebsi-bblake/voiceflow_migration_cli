# Wayfinder Map: Native XYOps Event Plugin for Voiceflow migration

## Destination

One versioned native XYOps Event Plugin, implemented under `xyops/plugin/` and
installed and run by xySat on target servers, serves the existing seven
Voiceflow Events. It accepts one validated JSON job containing params and
secrets, emits exactly one XYOps wire-protocol JSON result, preserves the
current Voiceflow envelopes and CLI behavior, and has a tested rollout/rollback
path. The Docker image/container runner is not the active deployment.

## Tickets

### P1 — Establish the live XYOps Event Plugin and xySat contract
- **Type:** research
- **Status:** todo
- **Agent/s:** @web-librarian, @backend-engineer
- **Question:** What exact stdin framing, job object shape, params/secrets fields, stdout wire-protocol schema, exit-code rules, stderr handling, process lifetime, runtime requirements, and xySat installation/upgrade semantics does this XYOps deployment require?
- **Blocked by:** none
- **Depends on:** supplied XYOps plugin docs model; access to a disposable XYOps instance and target server
- **Notes:** Reconcile the docs model with the repository's current assumptions: REST dispatch sends `{title|id, params}`; plugin params include strings and the boolean `CONFIRMED`; `VOICEFLOW_JWT` is an Event Secret binding; the plugin writes one newline-terminated JSON response to stdout and diagnostics to stderr. Record exact examples for success, domain failure, malformed input, missing secret, unknown operation, timeout, and non-zero exit. Unknowns must be proved with a live plugin invocation.

### P2 — Lock the deployment topology for one plugin and seven Events
- **Type:** grilling
- **Status:** todo
- **Agent/s:** conductor, @backend-engineer
- **Question:** Which target-server runtime and artifact form will be the supported production deployment, and how will seven Events reference the same plugin version while retaining distinct operation parameters?
- **Blocked by:** P1
- **Depends on:** P1's runtime, plugin registration, secret-delivery, and xySat lifecycle findings
- **Notes:** Decide between a Node-compatible bundled ESM artifact, a self-contained executable, or another XYOps-supported form; define install path, owner/permissions, checksum/version naming, health check, restart/concurrency model, upgrade order, rollback pointer, and whether Events pin an immutable plugin version. Preserve the seven current titles unless there is a documented reason to rename them: `voiceflow_check_session`, `voiceflow_list_workspaces`, `voiceflow_list_projects`, `voiceflow_list_versions`, `voiceflow_list_folders`, `voiceflow_plan_migration`, `voiceflow_execute_migration`. Identify the operator who provisions xySat/plugin registration and Event bindings.

### P3 — Define the canonical plugin job and wire-protocol contracts
- **Type:** grilling
- **Status:** todo
- **Agent/s:** conductor, @backend-engineer
- **Question:** What stable typed contract translates an XYOps plugin job into one of the seven Voiceflow operations and translates the operation result back to XYOps without leaking secrets?
- **Blocked by:** P1, P2
- **Depends on:** P1's observed job/wire schemas; P2's deployment constraints
- **Notes:** Base the operation input on the existing `EventParameters` and exact keys in `xyops/cli/state.ts`: `operation`, `SOURCE_WORKSPACE_ID`, `SOURCE_PROJECT_ID`, `SOURCE_VERSION_ID`, `DESTINATION_WORKSPACE_ID`, `DESTINATION_FOLDER_ID`, `TARGET_SCHEMA_VERSION`, `PLAN_ID`, and `CONFIRMED`. Define whether the plugin accepts `secrets.VOICEFLOW_JWT` only, how absent/null/non-string values are rejected, whether event metadata may constrain operation selection, maximum input/output sizes, one-response semantics, correlation/operation IDs, and protocol errors versus `vf_contracts.ts` domain envelopes. Make the contract explicit for success, `OperationFault`, malformed JSON, unsupported operation, and unexpected exceptions.

### P4 — Extract a shared operation dispatcher without changing Voiceflow behavior
- **Type:** task
- **Status:** todo
- **Agent/s:** @backend-engineer
- **Question:** How can the seven existing `main` operations be invoked from structured plugin input while keeping the current domain logic and legacy container entrypoint available during rollout?
- **Blocked by:** P3
- **Depends on:** P3's canonical operation and error contract
- **Notes:** Primary ownership is `xyops/plugin/` plus the shared `xyops/voiceflow/` operation modules. Reuse `main` functions in `vf_check_session.ts`, `vf_list_workspaces.ts`, `vf_list_projects.ts`, `vf_list_versions.ts`, `vf_list_folders.ts`, and `vf_execute_migration.ts`; keep catalog/auth/http/export/import/planning modules unchanged unless a typed boundary requires a narrow change. The native plugin dispatcher owns operation selection and named validation policies. Preserve operation IDs, warning codes, non-idempotent execute behavior, confirmation enforcement, and secret-free error messages.

### P5 — Implement the native plugin process boundary
- **Type:** task
- **Status:** implemented in `xyops/plugin/`
- **Agent/s:** @backend-engineer
- **Question:** Can the bundled plugin read exactly one job from stdin, execute the selected operation, and emit exactly one valid XYOps response on stdout under all expected failure modes?
- **Blocked by:** P3, P4
- **Depends on:** P1's framing and wire-protocol examples; P2's selected runtime/artifact shape
- **Notes:** Ownership is `xyops/plugin/contracts.ts`, `job_validation.ts`, `stdin_job.ts`, `operation_dispatch.ts`, `wire_protocol.ts`, `process_entrypoint.ts`, and `entrypoint.ts`. The implementation keeps stdout protocol-only, validates unknown input before dispatch, maps protocol failures without echoing secrets or raw input, and is covered by `tests/xyops_event_plugin.test.ts`. The live XYOps/xySat launch, Secret Vault delivery, and target-server behavior remain P9 gates.

### P6 — Package and provision the plugin on xySat target servers
- **Type:** task
- **Status:** todo
- **Agent/s:** @backend-engineer, XYOps operator
- **Question:** What repository artifact and operational configuration make the plugin reproducibly installable, executable, observable, and rollbackable on every target server?
- **Blocked by:** P2, P5
- **Depends on:** P2's deployment topology and P5's plugin entrypoint
- **Notes:** The native artifact is a Node-compatible CommonJS bundle built from `xyops/plugin/entrypoint.ts`, copied to the xySat target server, and registered as a custom Event Plugin command. `xyops/voiceflow/README.md` records the repository build/copy/registration procedure, Secret Vault binding, seven Event mappings, and local protocol tests. Target-server paths, permissions, runtime availability, artifact versioning, and rollback remain deployment-owner decisions to verify.

### P7 — Preserve and harden the CLI compatibility adapter
- **Type:** task
- **Status:** todo
- **Agent/s:** @backend-engineer
- **Question:** Can `xyops/cli/index.ts` continue to use the existing XYOps HTTP API and seven Event references unchanged while those Events are backed by the one native plugin?
- **Blocked by:** P3, P5
- **Depends on:** P3's compatibility decision and P1's observed XYOps response wrapping
- **Notes:** Primary files are `xyops/cli/index.ts`, `xyops/cli/client.ts`, `xyops/cli/config.ts`, and `xyops/cli/state.ts`; regression coverage is `tests/migration_cli_xyops.test.ts`. Default titles, `XYOPS_EVENT_*` title/ID overrides, `XYOPS_API_KEY`, REST paths, polling, single execute dispatch, unknown execute outcome handling, and omission of `VOICEFLOW_JWT` from requests should remain stable. Extend parsing only if native plugin responses differ from current `job.output`/`job.data` wrapping; do not make the CLI know plugin internals. Add a temporary compatibility mode only if required by a live response, and define its removal condition.

### P8 — Build contract and parity verification for all seven Events
- **Type:** prototype
- **Status:** todo
- **Agent/s:** @backend-engineer
- **Question:** Does the native plugin produce behaviorally identical results to the current container runner for read operations and preserve safety semantics for execute?
- **Blocked by:** P5, P6, P7
- **Depends on:** P1's protocol fixtures and P3's contract; P4's shared dispatcher
- **Notes:** Current native-plugin coverage is `tests/xyops_event_plugin.test.ts`, including operation selection, malformed input, Secret Vault/environment secret precedence, all seven dispatch paths, literal confirmation, protocol envelopes, and secret redaction. Continue using `tests/migration_cli_xyops.test.ts` for CLI compatibility. Live parity and target-server behavior remain separate verification work.

### P9 — Run the live XYOps/xySat compatibility gate
- **Type:** prototype
- **Status:** todo
- **Agent/s:** XYOps operator, @backend-engineer, conductor
- **Question:** Does the real XYOps control plane launch the installed plugin on a target server and correctly transport params, secrets, stdout, stderr, completion, and failures?
- **Blocked by:** P1, P6, P8
- **Depends on:** disposable XYOps Event/xySat target, non-production Voiceflow fixture or safe read-only credentials, and a published immutable plugin artifact
- **Notes:** Live matrix: one `check-session`; one catalog Event with required IDs; all seven Event titles; asynchronous `run_event` plus `get_job`; malformed job; missing JWT; unknown `operation`; non-zero process exit; timeout; concurrent invocations; stderr capture; secret-redaction inspection; and target-server restart/upgrade behavior. Test one real migration only with explicit human approval, a known disposable destination, and reconciliation evidence. Record the actual wire payloads with secrets and exported data removed. This ticket is the authority for resolving all remaining “docs model versus deployed XYOps” unknowns.

### P10 — Cut over seven Events and retire the Docker runner safely
- **Type:** task
- **Status:** todo
- **Agent/s:** XYOps operator, conductor, @backend-engineer
- **Question:** What staged rollout moves all seven Events to the native plugin with a reversible fallback, and when is the old Docker runner safe to remove?
- **Blocked by:** P2, P7, P9
- **Depends on:** P9 passing; operator-approved artifact/version, Event bindings, monitoring, and rollback plan
- **Notes:** Roll out read-only Events first (`check-session`, catalogs), then `plan-migration`, then `execute-migration`; verify each Event's title/ID mapping and Secret Vault binding. The Docker runner and `xyops/entry.ts` have been removed from the active implementation. Update `README.md` and `xyops/voiceflow/README.md` as the native plugin contract changes. Do not run execute migration without explicit approval and reconciliation handling.

## Decision points

- **Protocol framing:** single JSON document to EOF versus newline-delimited input; exact handling of blank stdin and trailing bytes.
- **Job shape:** field names and nesting for `params`, `secrets`, operation selection, event metadata, and correlation ID.
- **Wire response:** exact XYOps success/failure JSON, whether the plugin emits the current Voiceflow envelope directly or an XYOps wrapper, and whether exit code participates in failure classification.
- **Runtime/artifact:** Node-compatible ESM bundle, self-contained executable, or another xySat-supported form; required target architectures and runtime versions.
- **Operation selection:** use the canonical `params.operation` value and keep it aligned between CLI construction, Event configuration, and plugin validation.
- **Secret delivery:** exact native-plugin secret field and whether `VOICEFLOW_JWT` remains the sole secret; no secret may be echoed in stdout, stderr, job status, or fixtures.
- **Event configuration:** retain the seven current titles and per-Event bindings, or introduce a new naming/versioning scheme; immutable plugin version versus mutable “current” pointer.
- **Lifecycle:** one process per job versus a long-lived plugin, concurrency limits, timeout/cancellation behavior, and xySat restart semantics.
- **CLI compatibility:** preserve the existing REST client and only adapt response unwrapping if live tests prove it necessary; no direct plugin invocation from the CLI unless explicitly approved.
- **Cutover safety:** staged read-only rollout, execute approval/reconciliation procedure, observation period, and criteria for deleting the Docker runner.

## Fog of war

- Exact XYOps native Event Plugin protocol and xySat package/registration schema — not sharp enough until P1/P9 captures a live example.
- Whether target servers already provide the required Node/Bun runtime and whether xySat permits a repository-supplied executable — blocked on deployment inventory.
- Whether native plugin stdout is exposed through the existing `job.output` or `job.data` fields — requires a live seven-Event response.

## Out of scope

- Changing Voiceflow catalog, export, import, Logux, authentication, or migration business rules — the migration is an execution-boundary change only.
- Adding JWT signature verification, post-import secret/API-key patching, durable plan expiry/idempotency, or import reconciliation automation — already deferred by the active repository scope.
- Rebuilding the interactive CLI as a native plugin UI or replacing the XYOps REST API client — compatibility is required.
- Deploying archived Windmill sources under `windmill_agent_scripts/` or `archive/windmill_root/` — those paths are explicitly non-canonical.

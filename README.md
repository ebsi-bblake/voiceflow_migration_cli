# Voiceflow migration on XYOps

The active implementation is the XYOps runner tree under `xyops/voiceflow/`.
Root-level Windmill scripts are no longer canonical or active.

## Active source

- `xyops/voiceflow/` contains the Voiceflow contracts, transport adapters,
  catalog operations, planning, and migration runners.
- `xyops/entry.ts` is the shared process entrypoint. It selects one registered
  runner from `RUNNER_NAME` and emits the runner's envelope.
- `xyops/migration-cli.ts` is the local interactive CLI. It calls configured
  XYOps Events rather than importing the Voiceflow implementation directly.

The shared entry registers these runners:

```text
check-session
list-workspaces
list-projects
list-versions
list-folders
plan-migration
execute-migration
```

## XYOps Events and runners

Each XYOps Event invokes the shared `xyops/entry.ts` entrypoint with a
`RUNNER_NAME` value and the operation's environment parameters. The entrypoint
selects the corresponding runner from its registry. A runner exposes `run()`
for a typed Promise result and `start()` for the process boundary; the latter
serializes one success or failure envelope to stdout.

The default Event titles are:

```text
voiceflow_check_session
voiceflow_list_workspaces
voiceflow_list_projects
voiceflow_list_versions
voiceflow_list_folders
voiceflow_plan_migration
voiceflow_execute_migration
```

The CLI can override an Event by title or ID with `XYOPS_EVENT_*` environment
variables. The Events provide `VOICEFLOW_JWT` through their configured Secret
binding; the CLI does not request or send that secret.

## Build and local use

Run the repository's TypeScript build/type-check command from the project root:

```sh
bunx tsc --noEmit
```

Run the local CLI with an XYOps API key:

```sh
export XYOPS_API_KEY='your-xyops-api-key'
bun run xyops/migration-cli.ts
```

`XYOPS_BASE_URL` is optional and defaults to `http://localhost:5522`.
`XYOPS_EVENT_*` variables accept `title:<event-title>` or `id:<event-id>`.
After confirmation, the CLI performs a real Voiceflow export and import.

## Archived Windmill sources

Windmill sources are retained in a separately committed archive and are not
part of the active XYOps tree or build:

- `windmill_agent_scripts/` — archived Windmill agent scripts.
- `archive/windmill_root/` — archived root modular and one-file Windmill
  implementations, entrypoints, and their historical tests.

There are no active root-level legacy files. Do not deploy files from either
archive path as the current XYOps implementation.

## Network and security notes

The runners use the internal Logux WebSocket at
`wss://realtime.empyrean.voiceflow.com/` for catalog discovery and HTTPS at
`realtime-http-api.empyrean.voiceflow.com` for Voiceflow export/import. The
worker needs outbound WSS and HTTPS access to those hosts.

Never print, persist, commit, or include in screenshots the JWT,
`exportBase64`, exported project data, XYOps API key, or other secrets. JWT
signature verification and post-import Voiceflow secret/API-key patching are
not implemented. Migrations are non-idempotent; an unknown import outcome
requires destination reconciliation before retrying.

## Deferred scope

Windmill deployment maintenance, parity work for archived implementations,
durable plan expiry/idempotency, import reconciliation automation, JWT
signature verification, and post-import secret patching remain outside the
active XYOps scope.

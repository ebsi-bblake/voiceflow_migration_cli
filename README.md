# Voiceflow migration on XYOps

The active deployment is the native XYOps Event Plugin under `xyops/plugin/`.
It is a command-line executable launched by xySat on the target server. The
Voiceflow operation implementations remain under `xyops/voiceflow/`; the
Docker image/container runner is not the active deployment.

## Active source

- `xyops/voiceflow/` contains the Voiceflow contracts, transport adapters,
  catalog operations, planning, and migration runners.
- `xyops/plugin/` contains the native plugin contracts, stdin job validation,
  operation dispatcher, wire-protocol mapping, and process entrypoints.
- `xyops/plugin/process_entrypoint.ts` exports the testable process runner. The
  executable `xyops/plugin/entrypoint.ts` reads one JSON job from stdin and emits
  one XYOps JSON response on stdout. Diagnostics remain separate from the
  protocol output.
- `xyops/migration-cli.ts` is the local interactive CLI. It calls configured
  XYOps Events rather than importing the Voiceflow implementation directly.

The native plugin supports these operations:

```text
check-session
list-workspaces
list-projects
list-versions
list-folders
plan-migration
execute-migration
```

## One plugin, seven XYOps Events

All seven Events point to the same registered native plugin. Each Event supplies
its operation through the `operation` parameter and retains the following title
mapping:

| Event title | `operation` |
| --- | --- |
| `voiceflow_check_session` | `check-session` |
| `voiceflow_list_workspaces` | `list-workspaces` |
| `voiceflow_list_projects` | `list-projects` |
| `voiceflow_list_versions` | `list-versions` |
| `voiceflow_list_folders` | `list-folders` |
| `voiceflow_plan_migration` | `plan-migration` |
| `voiceflow_execute_migration` | `execute-migration` |

The CLI sends Event requests through the XYOps REST API and uses the
`operation` parameter to select the Voiceflow operation. It can override an
Event by title or ID with `XYOPS_EVENT_*` environment variables. The Events
provide `VOICEFLOW_JWT` through their configured Secret Vault binding; the CLI
does not request or send that secret.

## Build and local use

Build the extensionless Node/CJS artifact from the project root:

```sh
bun build xyops/plugin/entrypoint.ts \
  --target=node \
  --format=cjs \
  --outfile=dist/voiceflow-event-plugin.cjs
```

The configured XYOps command must invoke the copied artifact with Node, for
example `node /opt/xyops/voiceflow-event-plugin`.

Run the repository's TypeScript type-check command:

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

See [`xyops/voiceflow/README.md`](xyops/voiceflow/README.md) for native plugin
build, target-server installation, registration, and test procedures.

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

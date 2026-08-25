# Voiceflow Node runners

These Bun/TypeScript runners adapt the public `agent_scripts` `main` functions
to a Node-style process environment. Each runner writes one existing Voiceflow
envelope JSON value to stdout and sets a non-zero exit code when the adapter
fails. JWTs and migration data are never logged.

## Runners and environment inputs

| Runner | Environment inputs |
| --- | --- |
| `agent_scripts/vf_check_session.ts` | `VOICEFLOW_JWT` |
| `agent_scripts/vf_list_workspaces.ts` | `VOICEFLOW_JWT` |
| `agent_scripts/vf_list_projects.ts` | `VOICEFLOW_JWT`, `WORKSPACE_ID` |
| `agent_scripts/vf_list_versions.ts` | `VOICEFLOW_JWT`, `WORKSPACE_ID`, `PROJECT_ID` |
| `agent_scripts/vf_list_folders.ts` | `VOICEFLOW_JWT`, `WORKSPACE_ID` |
| `agent_scripts/vf_plan_migration.ts` | `VOICEFLOW_JWT`, `SOURCE_WORKSPACE_ID`, `SOURCE_PROJECT_ID`, `SOURCE_VERSION_ID`, `DESTINATION_WORKSPACE_ID`, `DESTINATION_FOLDER_ID`, optional `TARGET_SCHEMA_VERSION` |
| `agent_scripts/vf_execute_migration.ts` | `VOICEFLOW_JWT`, `PLAN_ID`, `SOURCE_WORKSPACE_ID`, `SOURCE_PROJECT_ID`, `SOURCE_VERSION_ID`, `DESTINATION_WORKSPACE_ID`, `DESTINATION_FOLDER_ID`, optional `TARGET_SCHEMA_VERSION`, `CONFIRMED` |

`TARGET_SCHEMA_VERSION` defaults to the agent script's `13.1` default when it
is absent. `CONFIRMED` is converted to `true` only when its literal value is
`"true"`; all other values remain false.

## Build

Build the one deployable Node bundle. The operation modules remain factories;
`entry.ts` is the only executable entrypoint and selects one factory using
`RUNNER_NAME`.

```sh
bun build xyops/entry.ts --target node --outfile /tmp/voiceflow-runners.js
```

## Event examples

Set `RUNNER_NAME` and the operation-specific environment variables, then invoke
the shared entrypoint with `bun run`:

```sh
RUNNER_NAME="list-projects" VOICEFLOW_JWT="$VOICEFLOW_JWT" \
  WORKSPACE_ID="workspace-id" bun run xyops/entry.ts

RUNNER_NAME="check-session" VOICEFLOW_JWT="$VOICEFLOW_JWT" \
  bun run xyops/entry.ts
```

The emitted stdout value is the selected operation's existing Voiceflow
envelope JSON. Unsupported `RUNNER_NAME` values fail before a runner starts.

Do not invoke `RUNNER_NAME="execute-migration"` against live Voiceflow resources
during build or type checks. A successful execution performs a real migration.

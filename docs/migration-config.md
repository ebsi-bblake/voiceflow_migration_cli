# Migration configuration

The CLI accepts a JSON configuration file with `--config=<path>`:

```sh
bun run xyops/cli/index.ts --config=xyops/cli/migration.example.json
```

The checked-in example in [`../xyops/cli/migration.example.json`](../xyops/cli/migration.example.json)
documents the supported snake_case fields:

- `source_workspace_id`
- `source_project_id`
- `source_version_id`
- `destination_workspace_id`
- `destination_folder_id`
- `target_schema_version`
- `secrets`: an array of `{ "name": string, "value": string }` entries

Configured values bypass their interactive prompts. Missing values remain interactive.
When `target_schema_version` is omitted, the interactive default is `13.1`.

Configuration is validated before migration work begins. Unknown fields, blank values,
duplicate or blank secret names, non-string secret values, and extra secret entry fields
are rejected. Secret values are not included in diagnostics.

The former `--secrets=<path>` option is unsupported. Project secrets belong in the
configuration object's `secrets` array; `VOICEFLOW_JWT` remains a separate XYOps/Windmill
secret binding and must not be placed in this file.

Keep local configuration files out of version control. The repository ignores
`xyops/cli/migration.local.json`; use that path for real credentials and IDs.

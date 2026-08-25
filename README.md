# Voiceflow project migration

This directory contains a modular Bun/TypeScript implementation for Windmill. It supports exporting a Voiceflow version, importing an exported artifact, or performing both operations as one migration. The canonical deployment layout is flat: deploy the files below from one Windmill folder without moving them into subdirectories.

## Canonical Windmill folder

The folder contains these 14 canonical files:

```text
shared_contract_types.ts
jwt_authentication_context.ts
http_api_client.ts
export_project_api.ts
import_project_api.ts
logux_websocket_transport.ts
catalog_discovery_service.ts
windmill_dynamic_selectors.ts
export_script_entrypoint.ts
import_script_entrypoint.ts
project_migration_orchestrator.ts
migration_script_entrypoint.ts
project_api_key_retrieval.ts
migration_diagnostics.ts
```

The three deployable Windmill entrypoints are:

- `export_script_entrypoint.ts` — export one source version.
- `import_script_entrypoint.ts` — import a Base64-encoded export artifact.
- `migration_script_entrypoint.ts` — discover catalog selections and run export plus import.

The other nine files are helper modules: shared types, JWT context, HTTP client, export/import API clients, Logux transport, catalog discovery, dynamic selectors, and the migration orchestrator. Deploy the entrypoints with their helper modules available in the same flat folder.

Canonical modules use extensionless relative imports such as `./module`. Deploy the files at `f/voiceflow/*`; the flat folder layout keeps those imports resolvable in Windmill without path mappings or `wmill init`.

## Authentication

Each entrypoint requires a `token` input configured as a Windmill **secret**. The value must be the raw JWT; do not pass a `Bearer ` prefix. The implementation decodes the JWT claims without verifying the signature and uses the first available `creatorID`, `userID`, `user_id`, or `sub` claim as the creator ID.

For the migration entrypoint, configure the dynamic selectors with these dependencies:

| Selector | Dependencies |
| --- | --- |
| `sourceWorkspaceID` | `token` |
| `sourceProjectID` | `token`, `sourceWorkspaceID` |
| `sourceVersionID` | `token`, `sourceWorkspaceID`, `sourceProjectID` |
| `destinationWorkspaceID` | `token` |
| `destinationFolderID` | `token`, `destinationWorkspaceID` |

The selectors list workspaces, projects, draft/published versions, and destination folders. Their values are Voiceflow IDs. `sourceProjectID` is used for catalog selection and is retained in the migration result; the export request uses `sourceVersionID`.

## Entrypoint contracts

### Export

Inputs:

- `token: string` — raw JWT secret.
- `sourceVersionID: string` — source version ID.

On success, the entrypoint returns:

```ts
{
  filename: string;                 // voiceflow-export.vf
  contentType: "application/octet-stream";
  byteLength: number;
  exportBase64: string;
}
```

`exportBase64` is the handoff value for the import entrypoint. The export is limited to 50,000,000 bytes.

### Import

Inputs:

- `token: string` — raw JWT secret.
- `destinationWorkspaceID: string`.
- `destinationFolderID: string`.
- `exportBase64: string` — Base64 produced by the export entrypoint.
- `exportFilename: string` — optional; defaults to `voiceflow-export.vf` and must be a safe `.vf` filename.
- `targetSchemaVersion: string` — optional; defaults to `13.1`.

The Base64 value is decoded to bytes and uploaded as a `.vf` file with media type `application/octet-stream`. On success, the entrypoint returns `status`, `byteLength`, and `imported`, which may include `projectID`, `devVersion`, `liveVersion`, `assistantID`, `folderID`, `workspaceID`, and `sourceProjectID`.

### Migration

Inputs:

- `token: string` — raw JWT secret.
- `sourceWorkspaceID`, `sourceProjectID`, `sourceVersionID`.
- `destinationWorkspaceID`, `destinationFolderID`.
- `targetSchemaVersion: string` — optional; defaults to `13.1`.

The output is:

```ts
{
  exportStatus: number;
  importStatus: number;
  exportBytes: number;
  selected: {
    sourceWorkspaceID: string;
    sourceProjectID: string;
    sourceVersionID: string;
    destinationWorkspaceID: string;
    destinationFolderID: string;
  };
  imported: {
    projectID: string;
    devVersion?: string;
    liveVersion?: string;
    assistantID?: string;
    folderID?: string;
    workspaceID?: string;
    sourceProjectID?: string;
  };
  apiKeyRetrieved: boolean;
  postImport?: { apiKeyRetrieved: false; diagnostic: object };
}
```

## Network dependencieis

Dynamic catalog selectors use the internal Logux protocol over a native WebSocket:

```text
wss://realtime.empyrean.voiceflow.com/
```

The worker needs outbound WSS access to that host. The export and import clients use HTTPS at `realtime-http-api.empyrean.voiceflow.com`:

```text
GET  https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/export-json/{sourceVersionID}
POST https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/import-file/{destinationWorkspaceID}
```

Both requests use `Authorization: Bearer <raw JWT>`. Export reads the response as bytes. Import sends multipart form data containing the `.vf` file as `application/octet-stream`, `targetSchemaVersion`, and `folderID`. Non-successful HTTP responses fail the operation. Logux is internal application behavior rather than a documented public Voiceflow API; WebSocket errors, server rejection, and a 15-second sync timeout are possible failure modes.

`apiKeyRetrieved` and optional `postImport` report API-key follow-up status. A failed retrieval after successful import preserves the result and provides a sanitized diagnostic. Retrieval uses an undocumented/internal identity route. Secret patching is not implemented.

## Local CLI harness

`xyops/migration-cli.ts` is an interactive local harness for the modular implementation. Run it with:

```sh
export XYOPS_API_KEY='your-xyops-api-key'
bun run xyops/migration-cli.ts
```

`XYOPS_API_KEY` is required. `XYOPS_BASE_URL` is optional and defaults to `http://localhost:5522`.
The default XYOps Event titles are `voiceflow_check_session`, `voiceflow_list_workspaces`,
`voiceflow_list_projects`, `voiceflow_list_versions`, `voiceflow_list_folders`,
`voiceflow_plan_migration`, and `voiceflow_execute_migration`. These titles must match the
configured XYOps Event titles. Per-event overrides are optional:

```sh
export XYOPS_EVENT_CHECK_SESSION='title:my-check-session'
export XYOPS_EVENT_EXECUTE_MIGRATION='id:your-event-id'
```

Use `title:` for an Event title or `id:` for an explicit Event ID. The CLI never asks for or
sends `VOICEFLOW_JWT`; each XYOps Event supplies it through its configured Secret binding.
After confirmation, this command performs a real Voiceflow export and import. Use only the
intended source version and destination workspace.

CLI exit codes: 0 for success, abort, or help; 2 when import succeeded but API-key retrieval failed; and 1 for fatal migration/import failure. Diagnostics do not expose keys, tokens, or raw response bodies.

## Security and current limitations

- Never print, persist, commit, or include in screenshots the JWT, `exportBase64`, exported project data, or secrets. Base64 is retained only as the import handoff and must be treated as sensitive exported project data.
- Keep `token` in a secret input or another protected secret store; rotate it if exposed.
- JWT signature verification is not performed by this implementation.
- API key/secret patching is **not implemented**. The migration does not read, transform, or patch post-migration Voiceflow secrets. A destination project API key is not a substitute for the migration JWT.
- Do not use live credentials when validating code. Prefer static review, type checking, or mocked HTTP/WebSocket boundaries.

## Legacy files

Legacy files, including `migrate_voiceflow_project.ts`, remain separate for reference or compatibility. They are not the canonical modular Windmill entries and should not be deployed as canonical modular entries. Use the three descriptive entrypoints above instead.

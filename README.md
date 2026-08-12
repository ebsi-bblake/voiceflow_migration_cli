# Voiceflow project migration

`migrate_voiceflow_project.ts` is a Windmill Bun/TypeScript script that exports one Voiceflow source version and imports it into a destination workspace and folder. It does not currently patch Voiceflow secrets after the import.

## Windmill setup

- Source file: `/Users/bblake/workspace/empyrean/voiceflow/migrate_voiceflow_project.ts`
- Runtime: **Bun** (TypeScript).
- Deploy the file as a Windmill script; the Windmill deployment path is not declared in the source file.
- Define a required **secret** input named `token`.
- Configure `token` as a dependency of every dynamic-select input. Windmill invokes each selector with `token` first.

The token must be a JWT. A leading `Bearer ` prefix is accepted and stripped. The script decodes the JWT claims (without verifying its signature) and uses `creatorID`, `userID`, `user_id`, or `sub` to identify the creator.

## Dynamic inputs

The exported selectors provide these dropdowns. Their `value` is the corresponding Voiceflow ID:

| Input | Dependencies and behavior |
| --- | --- |
| `sourceWorkspaceID` | `token`; lists the token owner's workspaces. |
| `sourceProjectID` | `token`, `sourceWorkspaceID`; lists projects in the selected source workspace. |
| `sourceVersionID` | `token`, `sourceWorkspaceID`, `sourceProjectID`; lists environment draft and published version IDs. Labels are `[Draft] <project> — <environment>` and `[Published] <project> — <environment>`. |
| `destinationWorkspaceID` | `token`; lists the same workspace set as `sourceWorkspaceID`. |
| `destinationFolderID` | `token`, `destinationWorkspaceID`; lists folders in the selected destination workspace. |

## Network dependency

The dropdowns use a captured internal **Logux** protocol over the native WebSocket client:

`wss://realtime.empyrean.voiceflow.com/`

The worker must allow outbound WSS access to that host. The migration also needs outbound HTTPS access to `realtime-http-api.empyrean.voiceflow.com`. The Logux dependency is internal application behavior, not a documented public Voiceflow API; failures can appear as a WebSocket error, rejection, or 15-second timeout.

## Migration API calls

The script uses the normalized JWT as a bearer token for both requests.

### Export

```text
GET https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/export-json/{sourceVersionID}
```

Headers: `Authorization: Bearer <JWT>`, `Accept: application/json`, and `Cache-Control: no-cache`.

The response is read as an array buffer. A `304` or any non-2xx response fails the script. `sourceProjectID` is used for dropdown selection only; the export request uses `sourceVersionID`.

### Import

```text
POST https://realtime-http-api.empyrean.voiceflow.com/v1alpha1/assistant/import-file/{destinationWorkspaceID}
```

Headers: `Authorization: Bearer <JWT>` and `Accept: application/json`. The body is `multipart/form-data` with these fields:

- `file`: the exported bytes, `application/json`, named `voiceflow-{sourceVersionID}.json`;
- `targetSchemaVersion`: the `main` argument, defaulting to `13.1`;
- `folderID`: the selected `destinationFolderID`.

Any non-2xx import response fails the script. A successful import response is parsed as JSON.

## Returned result

On success, `main` returns:

```ts
{
  exportStatus: number,
  importStatus: number,
  exportBytes: number,
  selected: {
    sourceWorkspaceID: string,
    sourceProjectID: string,
    sourceVersionID: string,
    destinationWorkspaceID: string,
    destinationFolderID: string,
  },
  importResponse: any,
}
```

## Current flow

1. Windmill resolves the dynamic inputs. Each selector normalizes the JWT, opens a Logux WebSocket, sends a `connect` frame, subscribes to the required channel with `sync` actions, and waits for the required replacement message types.
2. It loads workspaces from `creator/{creatorID}` using `workspace.CRUD:REPLACE`.
3. It loads projects and environments from `workspace/{sourceWorkspaceID}` using `project.CRUD:REPLACE`, then creates the draft/published version labels.
4. It loads destination folders from `workspace/{destinationWorkspaceID}` using `workspace-folder.REPLACE`. The destination workspace selector reuses the workspace selector.
5. `main` normalizes the JWT and GETs the selected `sourceVersionID` export.
6. It rejects HTTP `304` and other unsuccessful export responses, then reads the export bytes.
7. It creates the multipart form with `file`, `targetSchemaVersion`, and `folderID`, and POSTs it to the destination workspace import endpoint.
8. It rejects unsuccessful imports, parses the JSON response, and returns statuses, byte count, selected IDs, and the import response.

## Planned secret patching — not implemented

**The current script does not read, transform, or patch post-migration Voiceflow secrets.** The planned follow-up may use these documented public Project API endpoints:

- `PATCH /v1/secrets-management/projects/{projectID}/secrets/{secretName}` — update the project-level default value and/or visibility.
- `PATCH /v1/secrets-management/projects/{projectID}/environments/{projectEnvironmentIDOrAlias}/secrets/{secretName}` — set or remove an environment override; `versionVariant` targets the draft or published version, and `null` removes the override.

Those public endpoints require the **destination project's separate `VF.DM...` project API key** in `Authorization`; the migration JWT is not a substitute. The current Windmill inputs contain no destination project API key input and make no such PATCH calls. See the [Voiceflow Project API](https://docs.voiceflow.com/api-reference/project-api/overview), [default secret endpoint](https://docs.voiceflow.com/api-reference/secretsmanagementpublicapi/update-secret-default-value), and [environment override endpoint](https://docs.voiceflow.com/api-reference/secretsmanagementpublicapi/update-secret-environment-override-value).

## Security and validation

- Treat `token` as a high-privilege bearer JWT. Never commit it, print it, include it in screenshots, or place it in ordinary Windmill inputs. Rotate it immediately if exposed.
- JWT claims are decoded locally only to find the creator ID; signature verification is not performed by this script.
- Exported project data and `importResponse` may contain sensitive configuration or secret-related values. Do not persist or log them unnecessarily.
- Store any future `VF.DM` key as a separate secret and never reuse or expose it as the migration JWT.
- **Validation must not make live API calls.** Use static review, type checking, or mocked WebSocket/HTTP boundaries only. Do not execute the dynamic selectors or `main` with real credentials during validation.

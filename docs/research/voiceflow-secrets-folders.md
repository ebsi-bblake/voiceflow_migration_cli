# Voiceflow post-import secrets and folder creation research

## Confirmed

- Import returns the new project ID; `vf_api_key` currently calls the Identity API legacy project-key endpoint and discards the key after validating it.
- Voiceflow's public REST API requires a personal access token (`VF_PAT`), not a project `VF.DM.*` key.
- The public stable OpenAPI specification contains project CRUD but no project-secret or workspace-folder create/update endpoint.
- Voiceflow documentation states secret values are not copied during project export/duplication and must be re-entered after import.
- Existing Logux code only subscribes to `workspace-folder.REPLACE`; it performs catalog discovery, not mutation.

## Unknowns / decision gates

- Whether the project key can authorize secret mutation. Do not assume it can.
- The private/UI request used to create or patch a project secret: endpoint or Logux action, payload, visibility, project/environment scope, and acknowledgement.
- The private/UI request used to create a destination folder: action name, channel, payload, ID generation, and acknowledgement.

## Required reconnaissance before implementation

Capture one Voiceflow UI operation for each case:

1. Create `temp_boaz_secret` with value `cant touch this` in the imported project.
2. Create a folder named `Boaz` in the destination workspace.

Preserve request URLs/action names, channels, payload field names, response frames, and generated IDs. Redact JWTs, project keys, secret values, and unrelated project data.

## Implementation boundary

Keep the retrieved project key in memory only, behind a typed internal result. Never return it in an operation envelope or log it. Implement secret/folder mutation only after the reconnaissance confirms authorization and wire contracts.

Sources:

- https://www.voiceflow.com/docs/api-reference/api-overview
- https://www.voiceflow.com/docs/api-reference/project/update-project
- https://www.voiceflow.com/docs/documentation/build/data/secrets
- https://github.com/pixlcore/xyops/blob/master/docs/api.md#get_job

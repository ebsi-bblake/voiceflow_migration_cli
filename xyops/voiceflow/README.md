# XYOps Voiceflow runner image

The active container entrypoint is `xyops/entry.ts`. The Bun builder bundles it
and the runner modules into the Node-compatible ESM artifact
`/opt/voiceflow/entry.mjs`. The final image contains that artifact and minimal
image metadata only; it does not contain the TypeScript source, dependencies,
archives, tests, or credentials.

## Supported runners

`RUNNER_NAME` selects the operation supplied by the XYOps Event:

```text
check-session
list-workspaces
list-projects
list-versions
list-folders
plan-migration
execute-migration
```

The image entrypoint is fixed to:

```text
node /opt/voiceflow/entry.mjs
```

Do not replace the entrypoint or use a command argument to select an operation.
Set `RUNNER_NAME` and the operation parameters as Event environment variables.
`VOICEFLOW_JWT` must be supplied by the XYOps Event's runtime Secret binding;
it is never passed as a Docker build argument and is not baked into the image.

## Pinned image inputs

The Dockerfile pins the current multi-platform image indexes:

```text
oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e
node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
```

When updating either base image, update its tag and digest together. Verify
that the digest is a multi-platform manifest containing both `linux/amd64` and
`linux/arm64`; do not replace it with a mutable tag-only reference.

## Build with buildx

Build and load one platform into the local Docker image store:

```sh
docker buildx build \
  --platform linux/amd64 \
  --load \
  -f Dockerfile.voiceflow \
  -t voiceflow-runner:local-amd64 \
  .
```

Use `--platform linux/arm64` and a different tag for a local arm64 image.
`--load` accepts one platform at a time. To publish the combined manifest for
both supported platforms, replace the placeholder owner and tag and use
`--push`:

```sh
docker login ghcr.io
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -f Dockerfile.voiceflow \
  -t ghcr.io/OWNER/voiceflow-runner:TAG \
  .
```

After publishing, record the immutable digest reported by the registry and
deploy `ghcr.io/OWNER/voiceflow-runner@sha256:<image-digest>` in XYOps when
reproducible image selection is required. The base-image digests above pin the
build inputs; the published image digest pins the deployable result.

## XYOps Docker Plugin invocation

Configure the XYOps Docker Plugin to start the published image without
overriding its entrypoint. Each Event should provide `RUNNER_NAME`, the
parameters for that operation, and the `VOICEFLOW_JWT` Secret binding at
runtime. The plugin should capture the runner's single JSON envelope from
stdout and retain stderr as diagnostic output without exposing environment
values.

A non-migration smoke invocation is:

```sh
export VOICEFLOW_JWT='injected-locally-for-this-check'
docker run --rm \
  --env RUNNER_NAME=check-session \
  --env VOICEFLOW_JWT \
  voiceflow-runner:local-amd64
```

`check-session` requires a valid runtime JWT and network access to the
Voiceflow service. This invocation checks the container/event contract; it does
not execute a migration. Never put a real JWT in a Dockerfile, image label,
build argument, or committed command history.

# Standalone CLI packaging refactor

This plan only defines the work. It does not add package scripts, CI, signing,
or distribution configuration.

The plugin version is sourced from `package.json` by `xyops/plugin/version.ts`,
so changing the package version updates the version reported by the built plugin.
The build banner intentionally does not duplicate the version.

The target is a single-file executable built from the existing CLI entrypoint:
`xyops/cli/index.ts`. Each release publishes one artifact per supported target:
macOS ARM64/x64, Linux ARM64/x64, and Windows x64.

## Delivery order

1. Establish the packaging contract and artifact names.
2. Add local package scripts and deterministic build verification.
3. Add a tag-triggered GitHub Actions release matrix.
4. Add signing, provenance, and secret-safe artifact handling.
5. Add installation channels and operator documentation.
6. Perform staged release verification and rollout.

Each phase has a BDD feature file. A phase is complete only when its scenarios
are implemented, verified, and its decision gates are recorded.

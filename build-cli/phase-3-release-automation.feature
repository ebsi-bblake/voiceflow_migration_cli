@todo @packaging @github-actions @release
Feature: Publish standalone CLI artifacts from a release tag
  A version tag produces a GitHub Release containing the complete native target
  matrix without requiring separate build machines for basic cross-compilation.

  Background:
    Given GitHub Actions is the release authority
    And the release workflow uses the pinned Bun version
    And the workflow builds from the same commit as the tag

  # [ ]
  @workflow
  Scenario: Build the target matrix in isolated jobs
    When a supported version tag is pushed
    Then each target is built from the same source revision
    And each job produces exactly its expected artifact
    And the workflow fails if any target build fails
    And artifacts are uploaded with stable names

  # [ ]
  @release
  Scenario: Create a GitHub Release with all artifacts
    Given every target job passed
    When the release job runs
    Then it publishes macOS ARM64, macOS x64, Linux ARM64, Linux x64, and Windows x64 artifacts
    And release metadata identifies the CLI version and supported platforms
    And an incomplete matrix is never presented as a successful release

  # [ ]
  @rollback @decision-gate
  Scenario: Define release rollback behavior
    Given a published executable has a packaging or runtime defect
    When rollback is requested
    Then the prior known-good release remains downloadable
    And the repository documents whether a release is withdrawn, superseded, or both
    And rollback does not require rewriting an existing tag

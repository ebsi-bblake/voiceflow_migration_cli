@todo @packaging @security @decision-gate
Feature: Secure standalone CLI release artifacts
  Downloaded executables are verifiable and the build process cannot disclose
  credentials or accidentally package local secret-bearing files.

  Background:
    Given release builds run in an isolated GitHub Actions environment
    And signing credentials are supplied only through protected secret bindings
    And repository source and build logs are treated as untrusted outputs

  # [ ]
  @security
  Scenario: Sign platform artifacts when broad company distribution is approved
    Given the organization has approved signing identities for macOS and Windows
    When a release is built
    Then macOS artifacts are signed and notarized according to the Apple policy
    And Windows artifacts are Authenticode-signed according to the Windows policy
    And the workflow fails closed when required signing is configured but unavailable

  # [ ]
  @provenance
  Scenario: Publish integrity and provenance metadata
    When release artifacts are published
    Then checksums are published for every artifact
    And the build records the source commit and CLI version
    And provenance attestation is published if supported by the repository policy
    And no API key, JWT, config file, or secret value appears in artifacts, logs, or metadata

  # [ ]
  @decision-gate
  Scenario: Decide signing scope before enabling distribution
    Given unsigned binaries may trigger operating-system warnings
    When the release policy is finalized
    Then it records whether signing is required, recommended, or deferred
    And it records certificate ownership, rotation, revocation, and recovery
    And the workflow does not pretend unsigned artifacts are trusted

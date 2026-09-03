@todo @packaging @rollout
Feature: Verify and roll out the standalone CLI safely
  A release proves packaging behavior without performing a destructive
  Voiceflow migration and rolls out progressively.

  Background:
    Given the release artifacts were built from one tagged commit
    And no test may perform a real destructive migration

  # [ ]
  @verification
  Scenario: Run release smoke tests for every artifact
    When the release candidate is tested
    Then each executable responds to --help
    And malformed configuration produces a safe diagnostic
    And the executable does not print credentials or secret values
    And supported read-only or injected-client paths are tested without external migration effects

  # [ ]
  @verification
  Scenario: Verify artifact-to-target mapping
    When artifacts are inspected on representative runners
    Then each binary starts on its declared operating system and architecture
    And the Windows executable has the expected suffix
    And checksums match the published release metadata
    And an incompatible artifact is rejected or clearly identified

  # [ ]
  @rollout @decision-gate
  Scenario: Stage the first rollout
    Given a release candidate passed artifact verification
    When rollout is approved
    Then it is offered first to an internal pilot group
    And the prior release remains available for rollback
    And telemetry or support feedback has an owner and review window
    And broad distribution waits for pilot acceptance

  # [ ]
  @rollback
  Scenario: Recover from a defective release
    Given users report a release defect
    When rollback is activated
    Then users are directed to the prior known-good artifact
    And the defective release is marked with a clear warning
    And no user data or migration is modified by the rollback operation

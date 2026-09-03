@todo @packaging @local-build
Feature: Provide local standalone executable builds
  Developers can build every supported executable from the same TypeScript
  entrypoint using package.json scripts.

  Background:
    Given the source entrypoint is "xyops/cli/index.ts"
    And Bun compile mode is used
    And output is written below "dist/"

  # [ ]
  @scripts
  Scenario: Build each supported target independently
    When a developer runs the target-specific package script
    Then it invokes "bun build" with "--compile"
    And it uses the matching Bun target triple
    And it writes the contractually named executable to dist
    And the command does not require a target-specific source entrypoint

  # [ ]
  @scripts
  Scenario: Build the complete target matrix
    When a developer runs the aggregate CLI build script
    Then all five target-specific builds run
    And a failed build stops the aggregate command
    And no generated executable is committed as source

  # [ ]
  @verification
  Scenario: Validate local artifacts without running a migration
    Given the target-specific build succeeds
    When artifact validation runs
    Then the artifact exists and is executable for its target
    And its embedded CLI responds to --help
    And validation does not require XYOps credentials or Voiceflow access

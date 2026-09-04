@todo @migration @schema
Feature: Preserve the exported project's schema version during import
  The CLI uses the schema version recorded in the exported Voiceflow artifact by
  default, while allowing the operator to resolve a disagreement with an
  explicitly configured target schema version.

  Background:
    Given the selected source version can be exported as a Voiceflow .vf artifact
    And the artifact schema is read from the project's version metadata
    And schema diagnostics do not include secrets or the raw export payload

  @default
  Scenario: Use the exported project schema version by default
    Given the exported artifact contains version metadata with "_version" equal to "13.1"
    And no target schema version is configured
    When the CLI prepares the migration import
    Then the target schema version is "13.1"
    And the import request uses target schema version "13.1"
    And the operator is not prompted for a schema version

  @configured
  Scenario: Preserve an explicitly configured schema when it matches the export
    Given the exported artifact contains version metadata with "_version" equal to "13.1"
    And the configuration contains "13.1" for "target_schema_version"
    When the CLI prepares the migration import
    Then the target schema version is "13.1"
    And the import request uses target schema version "13.1"
    And the operator is not prompted to resolve a schema discrepancy

  @discrepancy @confirmation
  Scenario: Let the operator resolve a configured schema discrepancy
    Given the exported artifact contains version metadata with "_version" equal to "13.1"
    And the configuration contains "12.0" for "target_schema_version"
    When the CLI detects the schema discrepancy before import
    Then the diagnostic identifies "target_schema_version"
    And the operator is shown both "13.1" and "12.0"
    When the operator chooses the exported schema version
    Then the import request uses target schema version "13.1"

  @discrepancy @confirmation
  Scenario: Import with the configured schema after resolving a discrepancy
    Given the exported artifact contains version metadata with "_version" equal to "13.1"
    And the configuration contains "12.0" for "target_schema_version"
    When the CLI detects the schema discrepancy before import
    And the operator chooses the configured schema version
    Then the import request uses target schema version "12.0"

  @invalid-export
  Scenario: Report an export without a usable schema version
    Given the exported artifact has no usable version "_version" metadata
    And no target schema version is configured
    When the CLI prepares the migration import
    Then the command exits with status 1
    And the diagnostic code is "configuration"
    And the diagnostic identifies the missing exported schema version
    And no import request is made

  @invalid-export
  Scenario: Report malformed schema metadata safely
    Given the exported artifact contains malformed version metadata
    And no target schema version is configured
    When the CLI prepares the migration import
    Then the command exits with status 1
    And the diagnostic code is "configuration"
    And the diagnostic explains the expected exported schema format
    And the diagnostic does not include the raw export payload

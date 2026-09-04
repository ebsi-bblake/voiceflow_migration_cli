@exploratory @migration @secrets
Feature: Load migration secrets from a configured network file
  The migration configuration identifies the secrets file by path. The CLI reads
  that file through the operating system's mounted or network filesystem and
  passes validated secret objects to the migration event without exposing values.

  Background:
    Given the migration config is supplied through a local JSON file
    And the configured secrets path is resolved by the operating system
    And secret values are never written to diagnostics, logs, prompts, or errors

  @config
  Scenario: Treat the secrets property as a path rather than inline secret data
    Given the migration config contains "secrets" set to "//df2v-fs-01.ebsi.corp/shared/Test/secrets.ci.json"
    When the CLI reads the migration config
    Then the parsed configuration contains the secrets file path
    And the parsed configuration does not contain secret values
    And the CLI does not prompt for a secrets file path

  @config
  Scenario: Preserve an omitted schema override
    Given the migration config contains a secrets file path
    And the migration config does not contain "target_schema_version"
    When the CLI reads the migration config
    Then the target schema override is absent
    And the import uses the schema discovered from the exported artifact

  @network-filesystem
  Scenario: Read a secrets file from an accessible Windows network path
    Given the Windows path "\\\\df2v-fs-01.ebsi.corp\\shared\\Test\\secrets.ci.json" is readable
    And the file contains a JSON array of secret objects
    When the CLI loads the configured secrets file
    Then each secret object contains string "name", "value", and "type" properties
    And the validated secret objects are sent with the migration request
    And no secret value is printed

  @network-filesystem
  Scenario: Read a secrets file from an SMB share mounted on macOS
    Given the SMB share "smb://df2v-fs-01.ebsi.corp/shared" is mounted by the operator
    And the mounted path to the file is readable by the CLI
    And the file contains a JSON array of secret objects
    When the CLI loads the configured secrets file
    Then each secret object contains string "name", "value", and "type" properties
    And the validated secret objects are sent with the migration request
    And no secret value is printed

  @validation
  Scenario Outline: Reject an invalid secrets file safely
    Given the configured secrets path resolves to a readable file
    And the file contains <invalid contents>
    When the CLI loads the configured secrets file
    Then the command exits with status 1
    And the diagnostic code is "configuration"
    And the diagnostic identifies the secrets file as invalid
    And the diagnostic does not include the file contents or any secret value
    And no migration request is made

    Examples:
      | invalid contents |
      | malformed JSON |
      | a JSON object instead of an array |
      | an entry missing "name" |
      | an entry missing "value" |
      | an entry missing "type" |
      | an entry with a non-string "name" |
      | an entry with a non-string "value" |
      | an entry with a non-string "type" |
      | duplicate secret names |
      | an entry containing an unsupported property |

  @failure
  Scenario: Report an inaccessible network secrets path without fallback
    Given the configured secrets path cannot be read
    When the CLI loads the configured secrets file
    Then the command exits with status 1
    And the diagnostic code is "configuration"
    And the diagnostic does not include credentials or secret contents
    And no migration request is made

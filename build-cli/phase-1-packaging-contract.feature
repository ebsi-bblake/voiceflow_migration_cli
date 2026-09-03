@todo @packaging @decision-gate
Feature: Define the standalone CLI packaging contract
  The CLI is distributed as native single-file executables and does not require
  Bun, Node.js, npm, or the repository source at runtime.

  Background:
    Given the existing CLI entrypoint is "xyops/cli/index.ts"
    And the executable embeds the Bun runtime and bundled imports
    And builds use the repository's supported Bun version

  # [ ]
  @contract
  Scenario: Define the supported target matrix
    When the release targets are finalized
    Then the targets are macOS ARM64, macOS x64, Linux ARM64, Linux x64, and Windows x64
    And each target has one stable artifact name
    And the Windows artifact has an .exe suffix
    And unsupported targets are documented as unsupported rather than silently substituted

  # [ ]
  @contract @decision-gate
  Scenario: Choose the executable naming and invocation contract
    Given the project name is Voiceflow migration
    When artifact names are chosen
    Then names are unambiguous across operating systems
    And the installed command is "voiceflow-cli"
    And the release contract records whether configuration is supplied by --config or environment
    And no credentials are embedded in an executable

  # [ ]
  @compatibility
  Scenario: Preserve CLI behavior when packaged
    Given a user runs the compiled executable instead of Bun source
    Then login-independent configuration validation behaves identically
    And --help and invalid-input diagnostics remain available
    And the executable exits with the same success and failure status policy
    And real migration execution is not used as a packaging test

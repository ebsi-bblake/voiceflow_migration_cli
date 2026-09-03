@todo @packaging @distribution
Feature: Distribute the same standalone binaries through supported channels
  Users can install the compiled artifact without entering the JavaScript
  runtime ecosystem.

  Background:
    Given the GitHub Release contains verified target artifacts
    And package-manager manifests reference immutable release assets

  # [ ]
  @direct
  Scenario: Support direct release downloads
    When a user selects their operating system and architecture
    Then the documentation identifies exactly one matching artifact
    And the user can verify its checksum before execution
    And the download does not require Bun, Node.js, npm, or source code

  # [ ]
  @homebrew @decision-gate
  Scenario: Decide whether to publish a Homebrew formula
    Given macOS and Linux users may use Homebrew
    When the distribution channels are approved
    Then a formula is created only if its ownership and update process are assigned
    And it points to the same signed or checksum-verified release assets

  # [ ]
  @winget @decision-gate
  Scenario: Decide whether to publish a WinGet manifest
    Given Windows users may use WinGet
    When the distribution channels are approved
    Then a manifest is created only if publisher identity and update ownership are assigned
    And it points to the same Windows release asset

  # [ ]
  @installer
  Scenario: Document an optional shell installer safely
    Given a curl-based installer is considered for Linux or macOS
    When the installer is designed
    Then it validates platform and architecture before installation
    And it verifies the downloaded checksum or signature
    And it does not execute unverified bytes
    And direct release download remains available as an alternative

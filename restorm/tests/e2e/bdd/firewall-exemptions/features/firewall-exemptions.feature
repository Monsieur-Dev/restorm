Feature: The app's own outbound destinations stay declared and enforced
  As a user of a privacy-first API client, I want every host Restorm may reach
  on its own initiative to be declared, and its exemption to follow my consent
  exactly — so that "nothing leaves without you knowing" is something the
  firewall enforces rather than something the sender promises.

  Background:
    Given the Firewall tab is open

  Scenario: The panel exposes only the lists the user acts on
    Then the firewall panel should be visible
    And the whitelist and blacklist tabs should be visible
    And the outbound services section should not be present
    And the test outbound button should not be present

  Scenario: Without consent, a telemetry endpoint is declared but NOT exempted
    Given consent for "telemetry" has been withdrawn
    Then the outbound endpoint "telemetry" should be declared
    And the outbound endpoint "telemetry" should be inactive
    And the outbound endpoint "telemetry" should not be exempted from the firewall

  Scenario: Granting consent exempts the telemetry endpoint
    Given consent for "telemetry" has been withdrawn
    When consent for "telemetry" is granted
    Then the outbound endpoint "telemetry" should be active
    And the outbound endpoint "telemetry" should be exempted from the firewall

  Scenario: Revoking consent drops the exemption again
    Given consent for "telemetry" has been granted
    When consent for "telemetry" is withdrawn
    Then the outbound endpoint "telemetry" should be inactive
    And the outbound endpoint "telemetry" should not be exempted from the firewall

  Scenario: The licensing backend is exempted per call, never allowlisted
    Then the outbound endpoint "backend" should be active
    And the outbound endpoint "backend" should carry no consent gate

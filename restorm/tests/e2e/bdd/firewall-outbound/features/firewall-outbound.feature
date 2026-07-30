Feature: The firewall shows every destination the app itself contacts
  As a user of a privacy-first API client, I want the firewall panel to list
  every host Restorm may reach on its own initiative — including the ones it
  is NOT currently allowed to reach — so that "nothing leaves without you
  knowing" is something I can verify rather than take on trust.

  Background:
    Given the Firewall tab is open

  Scenario: The outbound-services section lists the declared destinations
    Then the outbound services section should be visible
    And the outbound services section should list "crash"
    And the outbound services section should list "telemetry"
    And the outbound services section should list "backend"

  Scenario: Without consent, a telemetry endpoint is listed but NOT exempted
    Given consent for "telemetry" has been withdrawn
    Then the outbound endpoint "telemetry" should be inactive
    And the outbound endpoint "telemetry" should not be exempted from the firewall

  Scenario: Granting consent exempts the telemetry endpoint and shows it as allowed
    Given consent for "telemetry" has been withdrawn
    When consent for "telemetry" is granted
    Then the outbound endpoint "telemetry" should be active
    And the outbound endpoint "telemetry" should be exempted from the firewall

  Scenario: Revoking consent drops the exemption again
    Given consent for "telemetry" has been granted
    When consent for "telemetry" is withdrawn
    Then the outbound endpoint "telemetry" should be inactive
    And the outbound endpoint "telemetry" should not be exempted from the firewall

  Scenario: The licensing backend is listed as required, with no consent gate
    Then the outbound endpoint "backend" should be active
    And the outbound endpoint "backend" should carry no consent gate

Feature: RAML import end-to-end

  Scenario: Import the sample RAML spec
    Given a new single-file collection for RAML import
    When I import the RAML petstore sample
    Then the sidebar should contain an environment folder named "Pet Store RAML API"
    And the environment folder "Pet Store RAML API" should expose a sub-folder named "Pet"

  Scenario: Re-import creates a separate copy
    # Import is a one-shot onboarding aid, not a living spec — Restorm
    # regenerates every id on import (no natural-key merge against what's
    # already in the tree), so importing the same document twice produces
    # two independent copies rather than deduplicating.
    Given a new single-file collection for RAML import
    When I import the RAML petstore sample
    And I import the RAML petstore sample
    Then exactly 2 root folders named "Pet Store RAML API" should be in the sidebar

  Scenario: Auto-detection picks RAML from the leading header
    Given a new single-file collection for RAML import
    When I open the import modal and paste the RAML petstore sample
    Then the import preview should be visible

  Scenario: A GET request from the imported spec runs against the live mock
    Given a new single-file collection for RAML import
    When I import the RAML petstore sample
    And I run the "GET /pet/findByStatus" request
    Then the response status is "200"

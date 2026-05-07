Feature: Fully-documented Petstore fixture builder
  Build a `.restorm` collection with a Petstore import patched to
  exercise every documentation field the model supports. The
  generated file is the reference fixture for upcoming visual +
  assertion tests on the documentation viewer. The file lives in a
  scenario-local `.tmp` directory and is regenerated on every run —
  no committed artefact.

  Scenario: Generate the fully-documented Petstore reference fixture
    Given a new single-file YAML collection seeded with the Petstore swagger
    When I patch the saved collection to fill every documentation field
    Then the patched collection should round-trip through the loader

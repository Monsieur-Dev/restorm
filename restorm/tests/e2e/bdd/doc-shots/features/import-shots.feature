Feature: Documentation screenshots — import modals

  Per-locale captures of the import-flow modal chrome for the website
  import-export docs: the format showcase, a multi-command cURL paste, and the
  gRPC reflection sub-modal. The resulting-tree screenshots (postman, bruno, …)
  are language-independent and live under assets/docs/shared/, so they are NOT
  part of this per-locale set.

  Scenario: Capture the per-locale import modals
    Given the app is running in documentation-capture mode
    And I am signed in with the demo account
    And I create a new empty project for import captures
    When I capture the import format modal for every locale to "{locale}/import-modale-cartes-format.png"
    And I capture the cURL import modal for every locale to "{locale}/import-curl-modale.png"
    And I capture the gRPC reflection modal for every locale to "{locale}/import-grpc-reflexion-modale.png"

Feature: Documentation viewer interactions
  The documentation host gives the reader a sidebar outline,
  clickable cross-references, an in-doc search bar (Ctrl+F, a
  CSS-Highlight search scoped to the documentation), and an "Add a
  request" button on every route block. Each scenario imports the
  Petstore spec into a fresh single-file collection, opens the env
  folder Docs tab, and exercises one of these surfaces.

  Background:
    Given the docs viewer scenario is bootstrapped with the Petstore spec

  Scenario: Ctrl+F opens the in-doc search bar
    When I press Ctrl+F on the docs panel
    Then the custom search bar should be visible

  Scenario: Sidebar Operation entry scrolls to the matching route block
    When I click the sidebar Operation entry "Find pet by ID"
    Then the route block "getPetById" should be visible in the docs panel

  Scenario: Sidebar Model entry pans the React Flow canvas to the model
    When I click the sidebar Model entry "Pet"
    Then the React Flow node "Pet" should be on screen

  Scenario: Add a request button creates a new request inside the matching tag-folder
    When I click the "Add a request" button next to operation "deletePet"
    Then a request named "Deletes a pet" should appear inside the tag-folder "pet"

  Scenario: The sidebar outline stays legible on every shipped theme
    Then every sidebar outline entry should contrast with the panel behind it, on every shipped theme

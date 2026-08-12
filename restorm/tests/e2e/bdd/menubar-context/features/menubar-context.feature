Feature: Context-driven menu bar and container deletion guard

  The Requête / Serveur / Scénario menus exist exactly while the ACTIVE
  workbench tab is (respectively) a client request, a server editor or a
  scenario editor. Deleting a container whose subtree holds requests still
  bound by outside scenarios walks each one through the "used by scenarios"
  dialog before the deletion executes — unless the binding scenario dies in
  the same subtree.

  Scenario: The contextual menus follow the active workbench tab
    Given a project holding a request, a server and a scenario is open
    Then no contextual menu is shown
    When the request tab is activated
    Then only the request contextual menu is shown
    When the server tab is activated
    Then only the server contextual menu is shown
    When the scenario tab is activated
    Then only the scenario contextual menu is shown

  Scenario: Deleting a folder whose request is bound by an outside scenario walks the dialog
    Given a project where a folder holds a request bound by an outside scenario
    When the folder is deleted from the Edition menu
    And the folder deletion is confirmed
    Then the used-by-scenarios dialog shows up for the bound request
    When the request deletion is confirmed anyway
    Then the folder is gone and the scenario box was stripped

  Scenario: Deleting a folder holding both the request and its binding scenario asks nothing
    Given a project where a folder holds both a request and the scenario binding it
    When the folder is deleted from the Edition menu
    And the folder deletion is confirmed
    Then the folder is gone without any used-by-scenarios dialog

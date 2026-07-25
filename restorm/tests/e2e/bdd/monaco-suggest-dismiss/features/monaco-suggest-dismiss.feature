Feature: Variable suggest dropdown dismissed when navigating away

  A compact {{variable}} field (VariableInputBox) renders its Monaco suggest
  popup in a fixed overlay reparented onto document.body so it is not clipped by
  an overflow:hidden ancestor. Because the popup lives outside the field's own
  DOM subtree, switching to another request tab — which only toggles
  `display:none` on the previous tab's slot, never unmounting the editor — used
  to leave the popup floating over whichever request is now active. This suite
  boots the real app, opens the {{...}} dropdown in one request's URL field,
  switches tabs, and asserts no stale suggest widget lingers on the body — then
  re-opens it in the now-active field to prove the fix does not close a genuinely
  visible field's dropdown.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the HTTP sample via MCP

  Scenario: Switching request tabs closes an open {{...}} suggest dropdown
    When I open the "GET echo" request tab via MCP
    And I open the variable suggest dropdown in the URL field
    Then a Monaco suggest widget is visible on the page body
    When I open the "POST echo" request tab via MCP
    Then no Monaco suggest widget lingers on the page body
    And I open the variable suggest dropdown in the URL field
    And a Monaco suggest widget is visible on the page body

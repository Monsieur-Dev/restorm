Feature: Design routes editor
  The Routes section: a two-level tree (group → routes), a group card
  carrying the inherited contract, a request-editor-style route card
  (Definition / Responses / Settings / Notes). Path params auto-create
  from the {{param}} pattern; a parameter links to a model property by
  STABLE ID; the CRUD and search generators produce normal editable
  routes; standard errors mint the shared Error model.

  Scenario: A group and a route by hand — path params auto-create from the pattern
    Given a Pro project carrying an API design is open in the routes editor
    When I add a route group
    Then the group card is shown
    When I set the group base path to "/things"
    And I add a route to the selected group
    And I set the route path to "/{{thingId}}"
    Then the path parameter row "thingId" exists
    And the resolved path line reads "/api/things/{{thingId}}"
    When I set the route path to "/all"
    Then no path parameter row exists

  Scenario: A parameter linked to a model property inherits its facts and survives a rename
    Given a Pro project carrying an API design is open in the routes editor
    When I open the route "Fetch one user" of the group "Users"
    Then the parameter "id" shows the inherited type "string uuid"
    And the parameter "id" carries the auto description badge
    When I open the models section and rename the property "id" of "User" to "uid"
    And I open the routes section
    And I open the route "Fetch one user" of the group "Users"
    Then the parameter "id" link points at "User ▸ uid"
    When I save the project
    Then the saved file still links the parameter to the property id "prop-user-id"

  Scenario: Responses by code — add, standard errors mint the Error model, delete
    Given a Pro project carrying an API design is open in the routes editor
    When I open the route "Fetch one user" of the group "Users"
    And I open the route responses tab
    And I add the response code "418"
    Then the response row "418" exists
    When I post the standard errors
    Then the response row "400" exists
    And the response row "401" exists
    And the response row "500" exists
    When I delete the response "418"
    Then the response row "418" does not exist
    And the models list offers "Error"

  Scenario: The body combo empties when its model is deleted
    Given a Pro project carrying an API design is open in the routes editor
    When I open the route "Create a user" of the group "Users"
    Then the body combo shows "User"
    When I open the models section and delete the model "User"
    And I open the routes section
    And I open the route "Create a user" of the group "Users"
    Then the body combo shows "(empty)"

  Scenario: Generate the CRUD from the model card
    Given a Pro project carrying an API design is open in the routes editor
    When I open the models section and generate the CRUD of "Order"
    Then the routes tree shows the group "Orders" with 6 routes
    When I open the route "Get one Order" of the group "Orders"
    Then the parameter "id" link points at "Order ▸ id"

  Scenario: Searchable properties generate linked query parameters on the list route
    Given a Pro project carrying an API design is open in the routes editor
    When I open the models section and generate the search routes of "User"
    Then the routes tree shows the group "Users" with 3 routes
    When I open the route "List users" of the group "Users"
    Then the query parameter row "email" exists

  Scenario: Route settings persist and the inherited block jumps to the group
    Given a Pro project carrying an API design is open in the routes editor
    When I open the route "Fetch one user" of the group "Users"
    And I open the route settings tab
    And I set the cache seconds to "120"
    And I toggle the route deprecated flag
    And I save the project
    Then the saved file carries cacheSeconds 120 and a deprecated route
    When I click the edit-in-group link
    Then the group card is shown

Feature: Name/path collisions flag every twin and link between them
  A name (models, enums) or method+path (routes) collision flags EVERY member
  of the colliding group in the sidebar — not just the last one — and each
  colliding entity's editor shows an error callout with a clickable "collides
  with" list that navigates to its twins.

  Scenario: Colliding models flag both twins and cross-link
    Given the collisions design is open on the "models" section
    Then the "model" node "d748cacc-5655-4d72-b1cc-9697eb011e06" carries an error dot
    And the "model" node "e38aeff3-7f39-45be-911a-93fd69f942c6" carries an error dot
    When I open the design entity "models" "d748cacc-5655-4d72-b1cc-9697eb011e06"
    Then the entity issues callout is visible
    And a collision twin chip links to "e38aeff3-7f39-45be-911a-93fd69f942c6"
    When I click the collision twin chip to "e38aeff3-7f39-45be-911a-93fd69f942c6"
    Then the collision twin list is anchored on "e38aeff3-7f39-45be-911a-93fd69f942c6"
    And a collision twin chip links to "d748cacc-5655-4d72-b1cc-9697eb011e06"

  Scenario: Colliding enums flag both twins and cross-link
    Given the collisions design is open on the "enums" section
    Then the "enum" node "f0a16dee-a8d6-448b-a3c7-2442194733c0" carries an error dot
    And the "enum" node "f1051fd4-9149-446a-bbac-5147068feeb9" carries an error dot
    When I open the design entity "enums" "f0a16dee-a8d6-448b-a3c7-2442194733c0"
    Then the entity issues callout is visible
    And a collision twin chip links to "f1051fd4-9149-446a-bbac-5147068feeb9"
    When I click the collision twin chip to "f1051fd4-9149-446a-bbac-5147068feeb9"
    Then the collision twin list is anchored on "f1051fd4-9149-446a-bbac-5147068feeb9"
    And a collision twin chip links to "f0a16dee-a8d6-448b-a3c7-2442194733c0"

  Scenario: Colliding routes flag both twins and cross-link
    Given the collisions design is open on the "routes" section
    Then the "route" node "f4d3de2b-5b2c-4070-8fb6-8bc7ef1b0bbb" carries an error dot
    And the "route" node "a6ed43bc-cecf-4c40-bcb4-f23a569e43c9" carries an error dot
    When I open the design entity "routes" "f4d3de2b-5b2c-4070-8fb6-8bc7ef1b0bbb"
    Then the entity issues callout is visible
    And a collision twin chip links to "a6ed43bc-cecf-4c40-bcb4-f23a569e43c9"
    When I click the collision twin chip to "a6ed43bc-cecf-4c40-bcb4-f23a569e43c9"
    Then the collision twin list is anchored on "a6ed43bc-cecf-4c40-bcb4-f23a569e43c9"
    And a collision twin chip links to "f4d3de2b-5b2c-4070-8fb6-8bc7ef1b0bbb"

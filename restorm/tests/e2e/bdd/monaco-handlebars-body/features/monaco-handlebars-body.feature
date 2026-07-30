Feature: Handlebars in a request body is tolerated and coloured

  A request body is a Handlebars template as much as it is a payload, but Monaco
  validates JSON in a web worker that knows nothing about `{{ … }}` — so a body
  like `{"id": {{petId}}}` used to come back covered in red squiggles even though
  it is exactly what the user meant to write. The body editor now opts into the
  ECUI CodeEditor's Handlebars tolerance: the validator still runs, and the
  markers it publishes because of the template are pruned afterwards.

  This suite boots the real app, creates one request per case, and reads Monaco's
  own error decorations (`.squiggly-error`) off the visible body editor. The first
  case deliberately carries a broken payload, which both proves that JSON
  validation is alive in this build and makes the "no error marker" assertions
  that follow meaningful rather than vacuous. Each body carries a `case` marker so
  a step can wait for the editor to actually show ITS document — inactive request
  tabs stay mounted, so several body editors coexist in the DOM.

  No request is ever sent, so this suite needs no Docker mock.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the HTTP sample via MCP

  Scenario: Templates are tolerated while genuine payload errors still squiggle
    Given a request "Broken JSON" whose text body is:
      """
      {"case": "plainBroken", "id": }
      """
    And a request "Handlebars JSON" whose text body is:
      """
      {"case": "hbJson", "id": {{petId}}, "name": "Hello {{first}}", "raw": {{{payload}}}}
      """
    And a request "Handlebars list" whose text body is:
      """
      {"case": "hbList", "pets": [{{#each pets}}"{{this}}",{{/each}}"last"]}
      """
    And a request "Handlebars and a real error" whose text body is:
      """
      {"case": "hbBroken", "id": {{petId}}, "name": }
      """
    And a request "Handlebars XML" whose text body is:
      """
      <pet case="hbXml"><id>{{petId}}</id><name>{{{rawName}}}</name></pet>
      """
    When I open the "Broken JSON" request tab via MCP
    Then the request body editor shows "plainBroken" and reports at least one error marker
    When I open the "Handlebars JSON" request tab via MCP
    Then the request body editor shows "hbJson" and reports no error marker
    When I open the "Handlebars list" request tab via MCP
    Then the request body editor shows "hbList" and reports no error marker
    When I open the "Handlebars and a real error" request tab via MCP
    Then the request body editor shows "hbBroken" and reports at least one error marker
    When I open the "Handlebars XML" request tab via MCP
    Then the request body editor shows "hbXml" and reports no error marker

  Scenario: A construct nested in a quoted string is coloured as template syntax
    A `{{ … }}` inside a JSON string is out of reach of every language grammar —
    to the JSON tokenizer `"{{petId}}"` is a string and its content is string
    text. The colouring therefore comes from a decoration, and this case is the
    one that proves it: the construct must be painted the theme's variable colour
    while the quotes around it stay string-coloured.

    Given a request "Handlebars in a string" whose text body is:
      """
      {"case": "hbColour", "petid": "{{petId}}"}
      """
    When I open the "Handlebars in a string" request tab via MCP
    Then the request body editor shows "hbColour" and reports no error marker
    And the request body editor colours "{{petId}}" with the theme variable colour

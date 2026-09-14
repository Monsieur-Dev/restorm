Feature: HTTP/REST execution end-to-end
  Boots restorm with the MCP server, opens the HTTP sample, and drives the real
  request panel against the Docker Petstore (:8080) and the local http-util mock
  (:8082). Each scenario opens a request tab by name, clicks Send, and asserts on
  the response panel — exercising methods, params, bodies (incl. multipart file
  upload and standalone file body), response shapes (JSON / XML / binary),
  headers, auth, redirects, cookies, errors, timeout, cancellation, handlebars
  on the wire, and history.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the HTTP sample via MCP

  Scenario Outline: HTTP methods round-trip
    When I open the "<request>" request tab via MCP
    And I click Send
    Then the response status is "200"

    Examples:
      | request      |
      | GET echo     |
      | POST echo    |
      | PUT echo     |
      | PATCH echo   |
      | DELETE echo  |
      | HEAD echo    |
      | OPTIONS echo |

  Scenario: The send button holds its on-screen position when the response panel opens
    When I open the "GET echo" request tab via MCP
    And I record the send button position
    And I click Send
    Then the response status is "200"
    And the send button position is unchanged

  Scenario: Query params reach the wire
    When I open the "Query params" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "hello world"
    And the response body contains "\"tag\": \"a\""

  Scenario: Path param interpolates
    When I open the "Path param" request tab via MCP
    And I click Send
    Then the response status is "200"

  Scenario: POST JSON body is echoed
    When I open the "POST echo" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "\"method\": \"POST\""
    And the response body contains "hello"

  Scenario: A QUERY request carries a body to the wire
    When I open the "QUERY echo" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "\"method\": \"QUERY\""
    And the response body contains "available"

  Scenario: Registry badges track the method verb across every surface, verbatim casing included
    When I open the "GET echo" request tab via MCP
    And I favorite the "GET echo" request via MCP
    And I open the "Badge scenario" scenario tab via MCP
    And I activate the "GET echo" request tab
    Then all method badge surfaces show "GET" as "http_get"
    And the sidebar add menu shows the "GET" method badge as "http_get"
    And the scenario add palette shows the "GET" method badge as "http_get"
    When I pick "POST" from the method combo
    Then all method badge surfaces show "POST" as "http_post"
    When I type "Post" into the method combo
    Then all method badge surfaces show "Post" as "http_post"
    When I type "TeSt" into the method combo
    Then all method badge surfaces show "TeSt" as "http_other"

  Scenario: A typed custom verb reaches the wire verbatim, casing preserved
    When I open the "GET echo" request tab via MCP
    And I type "Machin" into the method combo
    And I click Send
    Then the response status is "200"
    And the response body contains "\"method\": \"Machin\""
    When I type "post" into the method combo
    And I click Send
    Then the response status is "200"
    And the response body contains "\"method\": \"post\""

  Scenario: x-www-form-urlencoded body
    When I open the "Form urlencoded" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "user=alice&pass=s3cret"

  Scenario: Raw text body
    When I open the "Raw text" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "just some raw text"

  Scenario: multipart/form-data with a file upload
    When I open the "Pet image upload" request tab via MCP
    And I click Send
    Then the response status is "200"

  Scenario: A standalone file body sends the file's raw bytes with an inferred Content-Type
    When I open the "File body upload" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "restorm upload fixture"
    And the response body contains "\"content-type\": \"text/plain\""

  Scenario: Custom header round-trips
    When I open the "Custom header roundtrip" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "custom-value-42"

  Scenario: Accept content-negotiation reaches the wire
    When I open the "Accept negotiation" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response shows a header "content-type" containing "application/json"
    And the response body contains "\"accept\": \"application/json\""

  Scenario: Multi-value response header is displayed
    When I open the "Multi-value header" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response shows a header "x-multi" containing "one"
    And the response shows a header "x-multi" containing "two"

  Scenario: Basic auth header
    When I open the "Basic auth" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "Basic dXNlcjpwYXNz"

  Scenario: Bearer auth from an env variable
    When I open the "Bearer auth from env" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "Bearer env-secret-token"

  Scenario: API key in the query string
    When I open the "API key in query" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "special-key"

  Scenario: Redirects are followed by default
    When I open the "Redirect follow" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "\"path\": \"/echo\""

  Scenario: The follow-redirects toggle surfaces the raw redirect
    When I open the "Redirect no follow" request tab via MCP
    And I click Send
    Then the response status is "302"

  Scenario: Exceeding the redirect limit surfaces an explicit error
    When I open the "Redirect too many" request tab via MCP
    And I click Send
    Then the response shows an error
    And the response error contains "Too many redirects"

  Scenario: Cookies are stored and re-sent across requests
    When I open the "Cookie set" request tab via MCP
    And I click Send
    Then the response status is "200"
    When I open the "Cookie echo" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "jar-value"

  Scenario: 4xx status surfaces
    When I open the "Status 404" request tab via MCP
    And I click Send
    Then the response status is "404"

  Scenario: 5xx status surfaces
    When I open the "Status 500" request tab via MCP
    And I click Send
    Then the response status is "500"

  Scenario: A server-down request shows a clean error
    When I open the "Server down" request tab via MCP
    And I click Send
    Then the response shows an error

  Scenario: A request that exceeds its timeout errors out
    When I open the "Timeout" request tab via MCP
    And I click Send
    Then the response shows an error

  Scenario: An in-flight request can be cancelled
    When I open the "Slow cancel" request tab via MCP
    And I click Send
    And I click Cancel
    Then the response shows an error

  Scenario: A binary response is preserved and offered as a download
    When I open the "Binary download" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response offers a binary download
    And the response renders the image inline

  Scenario: An XML response renders as text
    When I open the "XML response" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body contains "<note>"

  Scenario: Handlebars helpers resolve on the wire
    When I open the "Handlebars on the wire" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the response body matches a handlebars uuid for header "x-request-id"

  Scenario: A JSON body resolves its variables without breaking the JSON
    When I open the "Handlebars JSON body" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the server received the body as valid resolved JSON

  Scenario: Execution records a history entry that can be replayed
    When I open the "GET echo" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the request has at least 1 history entry

  Scenario: A send with an emptied URL leaves no activity beam behind
    When I open the "GET echo" request tab via MCP
    And I clear the request URL
    And I click Send
    Then the response shows an error
    And the activity beam has stopped on the tab badge and the sidebar badge

  Scenario: A successful send leaves no activity beam behind
    When I open the "GET echo" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the activity beam has stopped on the tab badge and the sidebar badge

  # The value that reaches the socket is the only assertion that cannot be
  # argued with, so the three candidate values answer with three DIFFERENT
  # status codes: 201 for the row that must win, 418 for the earlier row with
  # the same key, 404 for the parent value the sub-environment overrides. A
  # failure therefore names which rule broke rather than merely that one did.
  #
  # The parent row and the first sub-environment row are EXPRESSIONS while the
  # winning row is a plain string. That asymmetry is the defect: it is what an
  # imported variable plus a hand-typed override actually look like, and a
  # fixture where every row is a string passes even with the bug present.
  Scenario: The last enabled row of the active sub-environment reaches the wire
    Given the sample environment's "util" is the expression "http://localhost:8082/status/404"
    And a sub-environment "sub" of the sample environment
    And a request "Override probe" whose URL is "{{util}}"
    When I open the environment folder tab via MCP
    And I select the "sub" environment in the env-folder sidebar
    And I add an environment variable row "util" with value "http://localhost:8082/status/418"
    And I switch the last environment variable row to Expression
    And I add an environment variable row "util" with value "http://localhost:8082/status/201"
    Then the context variables table resolves "util" to "http://localhost:8082/status/201"
    When I open the "Override probe" request tab via MCP
    And I select the "sub" environment on the active request tab
    Then the resolved URL on the request tab is "http://localhost:8082/status/201"
    When I click Send
    Then the response status is "201"
    And the URL actually sent was "http://localhost:8082/status/201"

  Scenario: Disabling the winning row hands the key back to the row above it
    Given the sample environment's "util" is the expression "http://localhost:8082/status/404"
    And a sub-environment "sub" of the sample environment
    And a request "Override probe" whose URL is "{{util}}"
    When I open the environment folder tab via MCP
    And I select the "sub" environment in the env-folder sidebar
    And I add an environment variable row "util" with value "http://localhost:8082/status/418"
    And I switch the last environment variable row to Expression
    And I add an environment variable row "util" with value "http://localhost:8082/status/201"
    And I disable the last environment variable row
    Then the context variables table resolves "util" to "http://localhost:8082/status/418"
    When I open the "Override probe" request tab via MCP
    And I select the "sub" environment on the active request tab
    Then the resolved URL on the request tab is "http://localhost:8082/status/418"
    When I click Send
    Then the response status is "418"
    And the URL actually sent was "http://localhost:8082/status/418"

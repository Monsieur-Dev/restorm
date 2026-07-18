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

  Scenario: Execution records a history entry that can be replayed
    When I open the "GET echo" request tab via MCP
    And I click Send
    Then the response status is "200"
    And the request has at least 1 history entry

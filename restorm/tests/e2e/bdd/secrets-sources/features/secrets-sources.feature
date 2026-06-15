Feature: Secret value sources resolve at execution and stay out of the document
  Exercises the secrets foundation end to end against the in-repo
  auth-service `/echo` reflector. The fixture references an `envVar`
  secret (env var RESTORM_E2E_SECRET) in three growable surfaces — an
  env-folder variable, a request header, and a scenario value — and the
  test process injects the secret's plaintext into the spawned main
  process. The `envVar` resolver reads it from `process.env` at dispatch.

  The request carries two secret-bearing headers: `X-Api-Key` is a
  `SecretValue` directly on the row, and `X-Env-Api-Key` is a Handlebars
  expression templated from the env-folder `apiKey` variable (itself a
  secret). Both must arrive resolved on the wire — proving secret
  hydration covers env-folder variables, not only request KeyValues.

  Under the revised model a secret is resolved into memory and may be
  revealed to the user on demand (it is their own credential); the
  invariant that must hold is that the resolved plaintext is never
  written to the persisted `.restorm` document — only the env-var NAME
  (the lookup key) is stored.

  Scenario: Request-header and env-folder secrets both resolve on the wire but never reach the document
    Given I open the secrets-sources demo collection
    Then the env-folder variable should be marked as a secret
    And the persisted document should store the secret env-var name but never the resolved plaintext
    When I run the "Echo with secret header" request
    Then the echo response should reflect the resolved secret in the X-Api-Key header
    And the echo response should reflect the env-folder secret in the X-Env-Api-Key header
    And the request header should be marked as a secret and reference the env-var name

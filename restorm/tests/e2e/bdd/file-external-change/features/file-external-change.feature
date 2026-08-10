Feature: Open file watched for external changes

  The open `.restorm` file is watched on disk. A third-party rewrite
  (terminal `git pull`, another editor) surfaces a non-blocking, timerless
  toast offering to reload or keep the in-memory version — never a silent
  reload, and never a prompt for the app's own writes. The secrets sidecar
  (`.restorm.env`), whose content is held in memory, is instead re-applied
  SILENTLY.

  Scenario: An external rewrite prompts, and reloading reflects the disk version
    Given a saved project with one request is open
    When the project file is rewritten on disk outside the app
    Then the external-change toast shows up
    When the reload action is chosen
    Then the app reflects the disk version and the toast is gone

  Scenario: The app's own save never prompts
    Given a saved project with one request is open
    When the request is modified through the app and autosaved
    Then no external-change toast shows up

  Scenario: Keeping the in-memory version overwrites the external rewrite
    Given a saved project with one request is open
    When the project file is rewritten on disk outside the app
    Then the external-change toast shows up
    When the keep-mine action is chosen
    Then the disk file holds the in-memory version again

  Scenario: An external secrets-sidecar change is re-applied silently
    Given a saved project with one request is open
    When the secrets sidecar is written on disk outside the app
    Then no external-change toast shows up

  Scenario: An external env-variable change is reflected immediately after reload
    Given a saved project with an env variable used in a request URL is open
    When the variable value is rewritten on disk outside the app
    Then the external-change toast shows up
    When the reload action is chosen
    Then the resolved URL preview shows the new value

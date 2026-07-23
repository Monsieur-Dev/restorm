Feature: Git status bar detection
  The "GIT" status-bar entry only appears once a project is open, and only
  its enabled/locked appearance depends on the folder actually being a git
  repo — see docs/Git/README.md's 3-state gate. Opt out with SKIP_GIT_E2E=1
  on a host that cannot run the git-server docker mock.

  Scenario: Opening a project inside a git repo shows the GIT entry enabled
    Given I open a project cloned from the seed git remote
    Then the status-bar GIT entry is visible and enabled

Feature: Recording-session documentation screenshots

  Capture localized, reproducible screenshots of the recording sessions for
  the website documentation. Runs only under the doc-shots gate
  (RESTORM_DOC_SHOTS=1), like the sibling doc-shots features. The page being
  recorded is the reference harness of the recording e2e (its mock servers
  run from the sample's scenario, all on localhost:8123), so the shots show
  real multi-protocol captures. The mini-browser is a native view a window
  screenshot cannot see: its pixels are captured separately and composited
  into the app shot at the view's exact bounds.

  Scenario: Capture the recording-session views in every locale
    Given the app is running in documentation-capture mode
    And I am signed in with the demo account
    And I open the recording harness project and start its mock servers
    And I create the demo recording session
    When I capture the recording configuration for every locale to "{locale}/enregistrement-configuration.png"
    And I start the demo recording and wait for its captures
    And I capture the recording browser for every locale to "{locale}/enregistrement-navigateur.png"
    And I capture the recording captures view for every locale to "{locale}/enregistrement-captures.png"
    And I stop the demo recording and deduce its routes
    And I capture the recording routes for every locale to "{locale}/enregistrement-routes.png"
    Then I stop the recording harness mock servers

Feature: TagsView

  Scenario: Initial render shows tags
    Given I open the tags view e2e tab
    Then tags view "tagsview-basic" should be visible
    Then tags view "tagsview-basic" should have 2 tags
    Then tags view tags json should be "[\"alpha\",\"beta\"]"

  Scenario: Add tag and commit with Enter
    Given I open the tags view e2e tab
    When I add a tag in tags view "tagsview-basic"
    Then tags view "tagsview-basic" should have 3 tags
    When I type "gamma" into tags view "tagsview-basic" tag 2 input letter by letter
    When I commit tags view "tagsview-basic" tag 2 editing
    Then tags view tags json should be "[\"alpha\",\"beta\",\"gamma\"]"

  Scenario: Edit existing tag then cancel with Escape
    Given I open the tags view e2e tab
    When I start editing tag 0 in tags view "tagsview-basic"
    When I type "alpha2" into tags view "tagsview-basic" tag 0 input letter by letter
    When I cancel tags view "tagsview-basic" tag 0 editing
    Then tags view tags json should be "[\"alpha\",\"beta\"]"

  Scenario: Edit existing tag and commit with blur
    Given I open the tags view e2e tab
    When I start editing tag 1 in tags view "tagsview-basic"
    When I type "beta2" into tags view "tagsview-basic" tag 1 input letter by letter
    When I blur tags view "tagsview-basic" tag 1 input
    Then tags view tags json should be "[\"alpha\",\"beta2\"]"

  Scenario: Remove tag using context menu
    Given I open the tags view e2e tab
    When I open tags view "tagsview-basic" tag 0 context menu
    Then context menu "tagsview-basic-contextmenu" should be visible
    When I click tags view "tagsview-basic" remove tag menu item "Remove tag"
    Then tags view "tagsview-basic" should have 1 tags
    Then tags view tags json should be "[\"beta\"]"


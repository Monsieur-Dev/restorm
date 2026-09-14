Feature: ListView

  Scenario: Initial expansion (isExpanded defaults + isExpanded=false)
    Given I open the list view e2e tab
    Then list view "listview-basic" should be visible
    Then list view "listview-basic" item "folder-a" aria-expanded should be "true"
    Then list view "listview-basic" item "folder-a-sub" aria-expanded should be "true"
    Then list view "listview-basic" item "folder-b" aria-expanded should be "false"

  Scenario: Selection updates harness
    Given I open the list view e2e tab
    When I click list view "listview-basic" item "file-root-0"
    Then list view harness last selection listid should be "listview-basic"
    Then list view harness last selection itemid should be "file-root-0"
    Then list view harness last selection ids should be "file-root-0"

  Scenario: Keyboard navigation changes selection
    Given I open the list view e2e tab
    When I click list view "listview-basic" item "file-root-0"
    When I press "ArrowUp" in list view "listview-basic"
    Then list view harness last selection listid should be "listview-basic"
    Then list view harness last selection itemid should be "folder-b"

  Scenario: Controlled expansion does not change without parent update
    Given I open the list view e2e tab
    Then list view "listview-controlled" should be visible
    Then list view "listview-controlled" item "ctrl-folder" aria-expanded should be "false"
    When I click list view "listview-controlled" item "ctrl-folder"
    Then list view harness last toggle listid should be "listview-controlled"
    Then list view "listview-controlled" item "ctrl-folder" aria-expanded should be "false"

  Scenario: Sticky headers become sticky on scroll (two levels)
    Given I open the list view e2e tab
    Then list view "listview-basic" should be visible
    When I wheel scroll scrollable element "listview-basic-scrollable" vertically by 450
    Then list view "listview-basic" item "folder-a" should have position sticky
    Then list view "listview-basic" item "folder-a-sub" should have position sticky
    Then list view "listview-basic" item "folder-a-sub" top should be > item "folder-a" top

  Scenario: Context menu rename commits
    Given I open the list view e2e tab
    When I open list view "listview-basic" context menu on item "file-root-0"
    Then context menu "listview-basic-contextmenu" should be visible
    When I click context menu "listview-basic-contextmenu" item "Rename"
    When I type "Root file 0 renamed" in list view "listview-basic" rename input
    When I submit list view "listview-basic" rename with Enter
    Then list view harness last rename listid should be "listview-basic"
    Then list view harness last rename itemid should be "file-root-0"
    Then list view harness last rename value should be "Root file 0 renamed"

  Scenario: Delete key requests delete on active item
    Given I open the list view e2e tab
    When I click list view "listview-basic" item "file-root-0"
    When I request delete in list view "listview-basic"
    Then list view harness last delete listid should be "listview-basic"
    Then list view harness last delete itemid should be "file-root-0"

  Scenario: Drag and drop (before/into/after) reports payload
    Given I open the list view e2e tab
    When I drag list view "listview-basic" item "file-root-0" into item "folder-a"
    Then list view harness last drop listid should be "listview-basic"
    Then list view harness last drop sourceid should be "file-root-0"
    Then list view harness last drop targetid should be "folder-a"
    Then list view harness last drop position should be "into"

    When I drag list view "listview-basic" item "a-sub-0" before item "a-sub-1"
    Then list view harness last drop position should be "before"

    When I drag list view "listview-basic" item "a-sub-1" after item "a-sub-2"
    Then list view harness last drop position should be "after"

  Scenario: Virtualised list mounts only the visible window and scrolls through the whole list
    Given I open the list view e2e tab
    Then list view "listview-virtual" should be visible
    Then list view "listview-virtual" mounts item "v-0"
    Then list view "listview-virtual" mounts fewer than 100 rows
    Then list view "listview-virtual" scroll height is at least 129000
    When I scroll list view "listview-virtual" to the bottom
    Then list view "listview-virtual" mounts item "v-4999"
    Then list view "listview-virtual" does not mount item "v-0"
    When I click list view "listview-virtual" item "v-4999"
    Then list view harness last selection itemid should be "v-4999"

  Scenario: A follow-tail list sticks to the bottom while it is at the bottom, and stays put once scrolled up
    Given I open the list view e2e tab
    Then list view "listview-tail" should be visible
    When I click the list view harness append button
    Then list view "listview-tail" is scrolled to the bottom
    Then list view "listview-tail" mounts item "t-39"
    When I scroll list view "listview-tail" to the top
    And I click the list view harness append button
    Then list view "listview-tail" is scrolled to the top
    When I scroll list view "listview-tail" to the bottom
    And I click the list view harness append button
    Then list view "listview-tail" is scrolled to the bottom
    Then list view "listview-tail" mounts item "t-79"

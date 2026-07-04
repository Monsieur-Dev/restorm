Feature: MenuBar

  Scenario: Open and close a top-level menu
    Given I open the menubar e2e tab
    Then menu bar "menubar-basic" should be visible
    When I open menu bar "menubar-basic" menu "menubar-basic-file"
    Then menu bar "menubar-basic" menu "menubar-basic-file" should be open
    When I click outside to close menu bar "menubar-basic"
    Then menu bar "menubar-basic" menu "menubar-basic-file" should be closed

  Scenario: Click item triggers action
    Given I open the menubar e2e tab
    When I open menu bar "menubar-basic" menu "menubar-basic-file"
    When I click menu bar item "menubar-basic-file-open"
    Then menubar action count should be 1
    Then menubar last action should be "open"

  Scenario: Disabled item does not trigger action
    Given I open the menubar e2e tab
    When I open menu bar "menubar-basic" menu "menubar-basic-file"
    When I click menu bar item "menubar-basic-file-revert-disabled"
    Then menubar action count should be 0
    Then menubar last action should be ""

  Scenario: Checked item toggles
    Given I open the menubar e2e tab
    When I open menu bar "menubar-basic" menu "menubar-basic-file"
    Then menubar autosave enabled should be "true"
    When I click menu bar item "menubar-basic-file-autosave"
    Then menubar autosave enabled should be "false"
    When I open menu bar "menubar-basic" menu "menubar-basic-file"
    When I click menu bar item "menubar-basic-file-autosave"
    Then menubar autosave enabled should be "true"

  Scenario: Submenu opens on hover and allows clicking submenu items
    Given I open the menubar e2e tab
    When I open menu bar "menubar-basic" menu "menubar-basic-file"
    When I hover menu bar item "menubar-basic-file-open-recent"
    Then menu bar submenu "menubar-basic-file-open-recent" should be visible
    When I click menu bar item "menubar-basic-file-open-recent-1"
    Then menubar last action should be "open-recent-1"

  Scenario: Keyboard can open and close a menu
    Given I open the menubar e2e tab
    When I press keys "ArrowRight,ArrowDown" in menu bar "menubar-basic"
    Then menu bar "menubar-basic" menu "menubar-basic-file" should be open
    When I press keys "Escape" in menu bar "menubar-basic"
    Then menu bar "menubar-basic" menu "menubar-basic-file" should be closed

  # Roving tabindex: exactly one top-level item is ever a Tab stop, so the
  # bar is reachable from — and lets go back into — the rest of the UI via
  # plain Tab, with no keyboard trap. "menubar-basic-focus-anchor" is a
  # script-only sentinel immediately before the bar (see MenuBarTab.tsx) —
  # it gives these scenarios a deterministic "just before the bar" starting
  # point without depending on the rest of the page's tab order.
  Scenario: Tab reaches the menu bar's first item, and Tab again leaves it
    Given I open the menubar e2e tab
    Then menu bar "menubar-basic" tab-reachable item should be "menubar-basic-file"
    When I focus "menubar-basic-focus-anchor"
    When I press the "Tab" key
    Then the focused element should be "menubar-basic-file"
    When I press the "Tab" key
    Then the focused element should not be inside "menubar-basic"

  Scenario: The roving tab stop follows the last-active top-level menu
    Given I open the menubar e2e tab
    When I click menu bar item "menubar-basic-edit"
    When I click outside to close menu bar "menubar-basic"
    Then menu bar "menubar-basic" tab-reachable item should be "menubar-basic-edit"
    When I focus "menubar-basic-focus-anchor"
    When I press the "Tab" key
    Then the focused element should be "menubar-basic-edit"

  Scenario: Arrow Left/Right move between top-level menus once the bar has keyboard focus
    Given I open the menubar e2e tab
    When I focus "menubar-basic-focus-anchor"
    When I press the "Tab" key
    Then the focused element should be "menubar-basic-file"
    When I press the "ArrowRight" key
    When I press the "ArrowRight" key
    Then menu bar "menubar-basic" tab-reachable item should be "menubar-basic-edit"
    When I press the "ArrowLeft" key
    Then menu bar "menubar-basic" tab-reachable item should be "menubar-basic-file"

  Scenario: Arrow Down opens the focused menu with focus on its first item
    Given I open the menubar e2e tab
    When I focus "menubar-basic-focus-anchor"
    When I press the "Tab" key
    When I press the "ArrowDown" key
    Then menu bar "menubar-basic" menu "menubar-basic-file" should be open
    Then the focused element should be "menubar-basic-file-new"

  Scenario: Arrow Up/Down navigate between sibling items of the open menu
    Given I open the menubar e2e tab
    When I focus "menubar-basic-focus-anchor"
    When I press the "Tab" key
    When I press the "ArrowDown" key
    Then the focused element should be "menubar-basic-file-new"
    When I press the "ArrowDown" key
    Then the focused element should be "menubar-basic-file-open"
    When I press the "ArrowUp" key
    Then the focused element should be "menubar-basic-file-new"

  Scenario: Shortcut triggers action while menu is closed
    Given I open the menubar e2e tab
    Then menubar action count should be 0
    When I trigger menu shortcut "Ctrl+Alt+O"
    Then menubar action count should be 1
    Then menubar last action should be "open"
    Then menu bar "menubar-basic" menu "menubar-basic-file" should be closed

  Scenario: Menu dropdown is scrollable (ScrollableElement)
    Given I open the menubar e2e tab
    When I open menu bar "menubar-basic" menu "menubar-basic-file"
    Then scrollable element "menubar-basic-file-scrollable" should be visible
    When I wheel scroll scrollable element "menubar-basic-file-scrollable" vertically by 250
    Then scrollable element "menubar-basic-file-scrollable" scroll top should be >= 50
    Then scrollable element "menubar-basic-file-scrollable" vertical scrollbar should be visible

  # Responsive layout: the harness wraps a six-menu MenuBar
  # in a width-controllable container. Clicking the width buttons
  # forces the bar through the three modes — `full`, `overflow` (with
  # a trailing "..." button), and `hamburger` (everything inside a
  # single ☰ button) — and asserts both the `data-mode` flag and the
  # presence of the right collapsed-button.
  Scenario: Responsive layout — wide container shows every item inline
    Given I open the menubar e2e tab
    When I set the responsive menubar width to "wide"
    Then menu bar "menubar-responsive" should be in "full" mode
    Then menu bar "menubar-responsive" should have 6 visible items

  Scenario: Responsive layout — medium container collapses overflow into "..."
    Given I open the menubar e2e tab
    When I set the responsive menubar width to "medium"
    Then menu bar "menubar-responsive" should be in "overflow" mode
    Then menu bar "menubar-responsive" overflow button should be visible

  Scenario: Responsive layout — narrow container collapses to hamburger
    Given I open the menubar e2e tab
    When I set the responsive menubar width to "narrow"
    Then menu bar "menubar-responsive" should be in "hamburger" mode
    Then menu bar "menubar-responsive" hamburger button should be visible

  Scenario: Responsive layout — opening the hamburger surfaces every item as a submenu entry
    Given I open the menubar e2e tab
    When I set the responsive menubar width to "narrow"
    Then menu bar "menubar-responsive" should be in "hamburger" mode
    When I open the hamburger menu of menu bar "menubar-responsive"
    When I hover menu bar item "menubar-responsive-help-overflow"
    Then menu bar submenu "menubar-responsive-help-overflow" should be visible


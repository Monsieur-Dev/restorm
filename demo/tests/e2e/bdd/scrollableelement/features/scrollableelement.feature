Feature: ScrollableElement

  Scenario: Vertical auto scroll updates scrollTop and shows scrollbar
    Given I open the scrollable element tab
    Then scrollable element "scrollableelement-vertical-auto" should be visible
    When I wheel scroll scrollable element "scrollableelement-vertical-auto" vertically by 250
    Then scrollable element "scrollableelement-vertical-auto" scroll top should be >= 50
    Then scrollable element "scrollableelement-vertical-auto" vertical scrollbar should be visible

  Scenario: Both axes (arrows) supports horizontal scroll and left shadow
    Given I open the scrollable element tab
    Then scrollable element "scrollableelement-both-auto-arrows" should be visible
    When I click scrollable element "scrollableelement-both-auto-arrows" horizontal arrow right
    Then scrollable element "scrollableelement-both-auto-arrows" scroll left should be >= 5
    When I wheel scroll scrollable element "scrollableelement-both-auto-arrows" horizontally by 350
    Then scrollable element "scrollableelement-both-auto-arrows" left shadow should be visible
    Then scrollable element "scrollableelement-both-auto-arrows" horizontal scrollbar should be visible

  Scenario: Visible mode exposes scrollbars without interaction
    Given I open the scrollable element tab
    Then scrollable element "scrollableelement-visible" should be visible
    Then scrollable element "scrollableelement-visible" vertical scrollbar should be visible
    Then scrollable element "scrollableelement-visible" horizontal scrollbar should be visible

  Scenario: Hidden mode keeps scroll working without rendering scrollbars
    Given I open the scrollable element tab
    Then scrollable element "scrollableelement-hidden" should be visible
    When I wheel scroll scrollable element "scrollableelement-hidden" vertically by 250
    Then scrollable element "scrollableelement-hidden" scroll top should be >= 50
    Then scrollable element "scrollableelement-hidden" vertical scrollbar should be hidden
    Then scrollable element "scrollableelement-hidden" horizontal scrollbar should be hidden

  Scenario: Dragging the slider updates the scroll position
    Given I open the scrollable element tab
    Then scrollable element "scrollableelement-visible" should be visible
    When I drag scrollable element "scrollableelement-visible" vertical slider by 40
    Then scrollable element "scrollableelement-visible" scroll top should be >= 5

  Scenario: Sticky levels stack on scroll
    Given I open the scrollable element tab
    Then scrollable element "scrollableelement-sticky" should be visible
    When I wheel scroll scrollable element "scrollableelement-sticky" vertically by 350
    Then scrollable element "scrollableelement-sticky" sticky element "scrollableelement-sticky-level-1" should have position sticky
    Then scrollable element "scrollableelement-sticky" sticky element "scrollableelement-sticky-level-2" should have position sticky
    Then scrollable element "scrollableelement-sticky" sticky element "scrollableelement-sticky-level-1" top should be >= 0
    Then scrollable element "scrollableelement-sticky" sticky element "scrollableelement-sticky-level-2" top should be >= 0
    Then scrollable element "scrollableelement-sticky" sticky element "scrollableelement-sticky-level-1" z-index should be >= 1
    Then scrollable element "scrollableelement-sticky" sticky element "scrollableelement-sticky-level-2" z-index should be >= 1
    Then scrollable element "scrollableelement-sticky" sticky element "scrollableelement-sticky-level-2" top should be > sticky element "scrollableelement-sticky-level-1" top


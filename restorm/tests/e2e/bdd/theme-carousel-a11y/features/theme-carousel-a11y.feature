Feature: Theme preview cards keep Tab on the card, never the preview
  As a keyboard user, I want Tab to move between theme cards only — never
  through a card's abstract preview (the fake sidebar, title, paragraphs and
  action pills) — so Settings > Appearance stays navigable instead of
  drowning Tab in extra stops per theme.

  Background:
    Given no file is open

  Scenario: Tabbing through the theme carousel only ever stops on a card
    When I open Settings from the gear button
    And I tab through every theme card in the carousel
    Then every tab stop should have been the theme card button, never a preview control

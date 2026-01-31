Feature: ColorPicker component
  The ColorPicker component allows selecting a color and emits changes in hex format.

  Background:
    Given I open the color picker tab

  Scenario: Setting the HEX input updates the value and triggers onChange (basic)
    When I set color picker "colorpicker-basic" hex to "#00ff00"
    Then color picker "colorpicker-basic" last change should be "#00ff00"
    And color picker "colorpicker-basic" hex input value should be "#00ff00"

  Scenario: Clicking in the saturation area triggers a change (basic)
    When I click color picker "colorpicker-basic" saturation at 10% 90%
    Then color picker "colorpicker-basic" last change should not be "#ff00aa"
    And color picker "colorpicker-basic" hex input value should not be "#ff00aa"

  Scenario: Dragging the hue bar triggers a change (basic)
    When I drag color picker "colorpicker-basic" hue to 80%
    Then color picker "colorpicker-basic" last change should not be "#ff00aa"


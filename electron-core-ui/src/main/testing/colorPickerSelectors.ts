function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function colorPickerTestIdSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function colorPickerRootSelector(testId: string): string {
  return colorPickerTestIdSelector(testId)
}

export function colorPickerHexInputSelector(testId: string): string {
  // The Sketch picker renders multiple `.w-color-editable-input` (HEX + RGB).
  // The first input is the HEX input, and is selected by the BDD steps using `.nth(0)`.
  return `${colorPickerRootSelector(testId)} .w-color-editable-input input`
}

export function colorPickerSaturationSelector(testId: string): string {
  return `${colorPickerRootSelector(testId)} .w-color-saturation`
}

export function colorPickerHueSelector(testId: string): string {
  return `${colorPickerRootSelector(testId)} .w-color-hue`
}

export function colorPickerAlphaSelector(testId: string): string {
  return `${colorPickerRootSelector(testId)} .w-color-alpha`
}

export function scrollableElementRootSelector(testId: string): string {
  return `[data-testid="${testId}"]`
}

export function scrollableElementContentSelector(testId: string): string {
  return `[data-testid="${testId}-content"]`
}

export function scrollableElementLeftShadowSelector(testId: string): string {
  return `[data-testid="${testId}-left-shadow"]`
}

export function scrollableElementVerticalScrollbarSelector(testId: string): string {
  return `[data-testid="${testId}-v-scrollbar"]`
}

export function scrollableElementVerticalSliderSelector(testId: string): string {
  return `[data-testid="${testId}-v-slider"]`
}

export function scrollableElementVerticalArrowUpSelector(testId: string): string {
  return `[data-testid="${testId}-v-arrow-up"]`
}

export function scrollableElementVerticalArrowDownSelector(testId: string): string {
  return `[data-testid="${testId}-v-arrow-down"]`
}

export function scrollableElementHorizontalScrollbarSelector(testId: string): string {
  return `[data-testid="${testId}-h-scrollbar"]`
}

export function scrollableElementHorizontalSliderSelector(testId: string): string {
  return `[data-testid="${testId}-h-slider"]`
}

export function scrollableElementHorizontalArrowLeftSelector(testId: string): string {
  return `[data-testid="${testId}-h-arrow-left"]`
}

export function scrollableElementHorizontalArrowRightSelector(testId: string): string {
  return `[data-testid="${testId}-h-arrow-right"]`
}

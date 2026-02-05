# ScrollableElement Component

A React component that provides custom scrollbars with auto-hide functionality, smooth scrolling, and full keyboard accessibility.

## Overview

The `ScrollableElement` component wraps content and provides custom scrollbars that match the behavior. It supports both vertical and horizontal scrolling, with optional arrow buttons, scroll shadows, and configurable visibility modes.

## API Reference

### IScrollableElementOptions

```typescript
interface IScrollableElementOptions {
  readonly useShadows?: boolean; // Show overflow shadows
  readonly handleMouseWheel?: boolean; // Handle mouse wheel events
  readonly mouseWheelSmoothScroll?: boolean; // Smooth scrolling
  readonly horizontal?: 'auto' | 'visible' | 'hidden'; // Horizontal scrollbar visibility
  readonly vertical?: 'auto' | 'visible' | 'hidden'; // Vertical scrollbar visibility
  readonly horizontalScrollbarSize?: number; // Height in px (default: 10)
  readonly verticalScrollbarSize?: number; // Width in px (default: 10)
  readonly horizontalHasArrows?: boolean; // Show left/right arrows
  readonly verticalHasArrows?: boolean; // Show up/down arrows
  readonly arrowSize?: number; // Arrow size in px (default: 11)
  readonly scrollByPage?: boolean; // Click on track scrolls by page
}
```

### IScrollableElementStyles

```typescript
interface IScrollableElementStyles {
  readonly scrollbarSliderBackground?: string;
  readonly scrollbarSliderHoverBackground?: string;
  readonly scrollbarSliderActiveBackground?: string;
  readonly scrollbarShadow?: string;
}
```

### ScrollableElementProps

```typescript
interface ScrollableElementProps {
  children: React.ReactNode;
  options?: IScrollableElementOptions;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
}
```

### Default Styles

```typescript
const defaultScrollableElementStyles: IScrollableElementStyles = {
  scrollbarSliderBackground: 'var(--scrollbarSlider-background)',
  scrollbarSliderHoverBackground: 'var(--scrollbarSlider-hoverBackground)',
  scrollbarSliderActiveBackground: 'var(--scrollbarSlider-activeBackground)',
  scrollbarShadow: 'var(--scrollbar-shadow)'
};
```

## Usage Examples

### Basic Vertical Scroll

```tsx
<ScrollableElement
  options={{ vertical: 'auto', horizontal: 'hidden' }}
  style={{ height: '200px', width: '400px' }}
>
  <div style={{ height: '600px', padding: '20px' }}>
    {/* Long content */}
  </div>
</ScrollableElement>
```

### Horizontal Scroll

```tsx
<ScrollableElement
  options={{ vertical: 'hidden', horizontal: 'auto' }}
  style={{ height: '200px', width: '400px' }}
>
  <div style={{ width: '800px', padding: '20px' }}>
    {/* Wide content */}
  </div>
</ScrollableElement>
```

### Both Axes with Arrows

```tsx
<ScrollableElement
  options={{
    vertical: 'auto',
    horizontal: 'auto',
    verticalHasArrows: true,
    horizontalHasArrows: true,
    useShadows: true
  }}
  style={{ height: '200px', width: '400px' }}
>
  <div style={{ width: '800px', height: '600px', padding: '20px' }}>
    {/* Wide and tall content */}
  </div>
</ScrollableElement>
```

### With Shadows

```tsx
<ScrollableElement
  options={{ 
    vertical: 'auto', 
    horizontal: 'hidden', 
    useShadows: true 
  }}
  style={{ height: '200px', width: '400px' }}
>
  <div style={{ height: '600px', padding: '20px' }}>
    {/* Content with scroll shadows */}
  </div>
</ScrollableElement>
```

### Custom Styling

```tsx
<ScrollableElement
  options={{
    scrollbarSliderBackground: '#ff6b6b',
    scrollbarSliderHoverBackground: '#ff5252',
    scrollbarSliderActiveBackground: '#e53935'
  }}
  style={{ height: '200px', width: '400px' }}
>
  <div style={{ height: '600px', padding: '20px' }}>
    {/* Content with custom scrollbar colors */}
  </div>
</ScrollableElement>
```

### Always Visible Scrollbars

```tsx
<ScrollableElement
  options={{ vertical: 'visible', horizontal: 'visible' }}
  style={{ height: '200px', width: '400px' }}
>
  <div style={{ height: '400px', padding: '20px' }}>
    {/* Content with always visible scrollbars */}
  </div>
</ScrollableElement>
```

## DOM Structure

```tsx
<div className="monaco-scrollable-element">
  {/* Scroll shadows */}
  <div className="shadow top" />
  <div className="shadow left" />
  
  {/* Content wrapper */}
  <div className="scrollable-content">
    {children}
  </div>
  
  {/* Vertical scrollbar */}
  <div className="scrollbar vertical visible">
    <div className="scra arrow-up">▲</div>
    <div className="slider" />
    <div className="scra arrow-down">▼</div>
  </div>
  
  {/* Horizontal scrollbar */}
  <div className="scrollbar horizontal visible">
    <div className="scra arrow-left">◀</div>
    <div className="slider" />
    <div className="scra arrow-right">▶</div>
  </div>
</div>
```

## CSS Classes

- `.scrollable-element`: Main container
- `.scrollable-content`: Content wrapper
- `.scrollbar`: Scrollbar container
- `.scrollbar.vertical`: Vertical scrollbar
- `.scrollbar.horizontal`: Horizontal scrollbar
- `.scrollbar.visible`: Visible scrollbar
- `.scrollbar.invisible`: Hidden scrollbar
- `.slider`: Scrollbar thumb/slider
- `.scra`: Arrow button
- `.shadow`: Scroll shadow
- `.shadow.top`: Top shadow
- `.shadow.left`: Left shadow

## Theme Variables

The component uses the following theme CSS variables for theming:

- `--scrollbarSlider-background`: Default slider background
- `--scrollbarSlider-hoverBackground`: Slider background on hover
- `--scrollbarSlider-activeBackground`: Slider background when active
- `--scrollbar-shadow`: Shadow color for overflow indication

## Behavior

### Auto-hide Logic

- **Auto mode**: Scrollbars appear on mouse enter/scroll and hide after 500ms of inactivity
- **Visible mode**: Scrollbars are always visible
- **Hidden mode**: Scrollbars are never shown

### Smooth Scrolling

- Enabled by default with `mouseWheelSmoothScroll: true`
- Uses `requestAnimationFrame` for smooth animation
- 150ms duration with ease-out timing function

### Mouse Wheel Handling

- Handles both vertical and horizontal wheel events
- Configurable sensitivity and smooth scrolling
- Prevents default browser scrolling behavior

### Drag Behavior

- Click and drag on slider to scroll
- Proportional scrolling based on drag distance
- Smooth position updates during drag

## Keyboard Navigation

- **Arrow keys**: Scroll by line (20px)
- **Page Up/Down**: Scroll by page (container height)
- **Home/End**: Scroll to start/end
- **Shift + Arrow keys**: Horizontal scrolling when available

## Accessibility

### ARIA Attributes

- `role="presentation"` on scrollbar containers
- `aria-hidden="true"` on scrollbar elements
- Proper focus management for keyboard navigation

### Screen Reader Support

- Scrollbars are hidden from screen readers
- Content remains fully accessible
- Keyboard navigation preserved

## AI Usage Notes

### Key Features for AI Integration

1. **Auto-hide scrollbars**: Perfect for clean interfaces that show scrollbars only when needed
2. **Smooth scrolling**: Enhanced user experience with fluid animations
3. **Custom styling**: Easy theming with theme color variables
4. **Flexible configuration**: Support for various scrollbar modes and behaviors
5. **Performance optimized**: Uses ResizeObserver for efficient dimension tracking

### Common Use Cases

- **Code editors**: Replace native scrollbars in monaco editor containers
- **Settings panels**: Scrollable configuration sections
- **File explorers**: Tree views with custom scrolling
- **Terminal outputs**: Scrollable command history
- **Documentation**: Long-form content with smooth scrolling

### Integration Tips

- Use `useShadows: true` for content overflow indication
- Set appropriate `scrollbarSize` for your design system
- Enable arrows for precise navigation in data-heavy interfaces
- Use `onScroll` callback for scroll position tracking
- Combine with themes for consistent styling

### Performance Considerations

- Component uses ResizeObserver for efficient dimension updates
- Smooth scrolling can be disabled for better performance on low-end devices
- Auto-hide reduces visual clutter and improves focus
- Minimal re-renders with optimized state management

## Testing

### `data-testid`

The component supports an optional `data-testid` prop that is applied to the root element and used to derive stable hooks for E2E tests.

When `data-testid="my-scroll"` is provided, the following test ids are available:

- Root: `my-scroll`
- Content (scrollable): `my-scroll-content`
- Left shadow (when visible): `my-scroll-left-shadow`
- Vertical scrollbar: `my-scroll-v-scrollbar`
  - Slider: `my-scroll-v-slider`
  - Arrows (if enabled): `my-scroll-v-arrow-up`, `my-scroll-v-arrow-down`
- Horizontal scrollbar: `my-scroll-h-scrollbar`
  - Slider: `my-scroll-h-slider`
  - Arrows (if enabled): `my-scroll-h-arrow-left`, `my-scroll-h-arrow-right`

### Data attributes

When `data-testid` is provided, numeric data attributes are exposed on the root and content elements:

- `data-scroll-top`, `data-scroll-left`
- `data-container-width`, `data-container-height`
- `data-content-width`, `data-content-height`

### Selectors

Use the pure string selectors from `electron-core-ui/testing`:

- `scrollableElementRootSelector(testId)`
- `scrollableElementContentSelector(testId)`
- `scrollableElementVerticalScrollbarSelector(testId)` / `scrollableElementVerticalSliderSelector(testId)`
- `scrollableElementVerticalArrowUpSelector(testId)` / `scrollableElementVerticalArrowDownSelector(testId)`
- `scrollableElementHorizontalScrollbarSelector(testId)` / `scrollableElementHorizontalSliderSelector(testId)`
- `scrollableElementHorizontalArrowLeftSelector(testId)` / `scrollableElementHorizontalArrowRightSelector(testId)`
- `scrollableElementLeftShadowSelector(testId)`

### Playwright-BDD steps

Reusable steps are available from `electron-core-ui/testing/playwright-bdd`:

- `Then scrollable element {string} should be visible`
- `When I wheel scroll scrollable element {string} vertically by {int}`
- `When I wheel scroll scrollable element {string} horizontally by {int}`
- `When I click scrollable element {string} vertical arrow up`
- `When I click scrollable element {string} vertical arrow down`
- `When I click scrollable element {string} horizontal arrow left`
- `When I click scrollable element {string} horizontal arrow right`
- `When I drag scrollable element {string} vertical slider by {int}`
- `When I drag scrollable element {string} horizontal slider by {int}`
- `Then scrollable element {string} scroll top should be >= {int}`
- `Then scrollable element {string} scroll left should be >= {int}`
- `Then scrollable element {string} vertical scrollbar should be visible|hidden`
- `Then scrollable element {string} horizontal scrollbar should be visible|hidden`
- `Then scrollable element {string} left shadow should be visible`

Sticky helpers (assert sticky positioning by `data-testid`):

- `Then scrollable element {string} sticky element {string} should have position sticky`
- `Then scrollable element {string} sticky element {string} top should be >= {int}`
- `Then scrollable element {string} sticky element {string} z-index should be >= {int}`
- `Then scrollable element {string} sticky element {string} top should be > sticky element {string} top`

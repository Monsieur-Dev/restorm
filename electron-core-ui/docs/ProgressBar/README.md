# ProgressBar Component

## Overview

The `ProgressBar` component is a React implementation of the ProgressBar widget. It provides both infinite and discrete progress indicators with theme styling, theme integration, and full accessibility support.

## API

### Interfaces TypeScript

```typescript
export interface IProgressBarStyles {
  readonly progressBarBackground?: string;
}

export interface IProgressBarOptions extends IProgressBarStyles {
  readonly progressBarBackground?: string;
}

export interface ProgressBarProps {
  options?: IProgressBarOptions;
  mode?: 'infinite' | 'discrete' | 'done';
  value?: number; // For discrete mode: 0-100
  total?: number; // For discrete mode: total work units
  className?: string;
  id?: string;
  'data-testid'?: string;
  onComplete?: () => void;
}
```

### Props

- **options** (`IProgressBarOptions`) : Progress bar configuration
  - `progressBarBackground` : Custom background color for the progress bar

- **mode** (`'infinite' | 'discrete' | 'done'`) : Progress bar mode
  - `infinite` : Continuous progress with animation
  - `discrete` : Progress with specific value (0-100%)
  - `done` : Completed state

- **value** (`number`) : Current progress value (for discrete mode)
- **total** (`number`) : Total work units (for discrete mode)
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the progress bar
- **data-testid** (`string`) : Optional test id applied to the progress bar root element
- **onComplete** (`() => void`) : Callback called when progress is completed

## Usage Examples

### Infinite Progress Bar

```tsx
import { ProgressBar } from 'electron-core-ui/renderer'

<ProgressBar mode="infinite" />
```

### Discrete Progress Bar

```tsx
<ProgressBar 
  mode="discrete" 
  value={50} 
  total={100} 
/>
```

### Custom Color Progress Bar

```tsx
<ProgressBar 
  mode="discrete" 
  value={75} 
  total={100}
  options={{ progressBarBackground: '#ff6b6b' }}
/>
```

### Completed Progress Bar

```tsx
<ProgressBar 
  mode="done" 
  onComplete={() => { /* Progress completed */ }}
/>
```

### Dynamic Progress Updates

```tsx
const [progress, setProgress] = useState(0)

useEffect(() => {
  const interval = setInterval(() => {
    setProgress(prev => {
      if (prev >= 100) {
        clearInterval(interval)
        return 100
      }
      return prev + 10
    })
  }, 500)

  return () => clearInterval(interval)
}, [])

<ProgressBar 
  mode="discrete" 
  value={progress} 
  total={100}
  onComplete={() => { /* Download complete */ }}
/>
```

## Testing

When `data-testid` is provided, the component exposes stable hooks for E2E tests.

### data-testid conventions

- Root: `{id}`
- Progress bit: `{id}-bit`

### Stable data attributes (on root)

- `data-mode`: `infinite | discrete | done`
- `data-is-active`: `true | false`
- `data-is-long-running`: `true | false`
- `data-current-value`: number
- `data-total`: number
- `data-width-percent`: number (rounded)

### Selectors

- `progressBarRootSelector(testId)`
- `progressBarBitSelector(testId)`

### Playwright-BDD steps

- `Then progress bar {string} should be visible`
- `Then progress bar {string} data-mode should be {string}`
- `Then progress bar {string} should be active`
- `Then progress bar {string} should be inactive`
- `Then progress bar {string} width percent should be {int}` (tolerance ±1)
- `Then progress bar {string} aria-valuenow should be {int}`
- `Then progress bar {string} should become long running`

## DOM Structure

The component generates the following DOM structure:

```html
<div class="monaco-progress-container active discrete" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
  <div class="progress-bit" style="background-color: #0E70C0; width: 50%; opacity: 1;"></div>
</div>
```

## CSS Classes Used

- **monaco-progress-container** : Container for the progress bar
- **active** : Applied when progress bar is active
- **infinite** : Applied for infinite mode
- **discrete** : Applied for discrete mode
- **done** : Applied when progress is completed
- **infinite-long-running** : Applied after 10 seconds in infinite mode
- **progress-bit** : The actual progress indicator

## Theme Variables

The component uses the following CSS variables:

- `--progressBar-background` : Background color of the progress bar
- Default fallback: `#0E70C0` (blue)

## Animation Details

### Infinite Mode
- Uses CSS `@keyframes progress` animation
- 4-second duration with infinite iteration
- Long-running mode switches to `steps(100)` timing after 10 seconds
- Optimized for GPU performance

### Discrete Mode
- Smooth width transitions with `transition: width 100ms linear`
- Width calculated as percentage: `(value / total) * 100`

### Done State
- Infinite mode: fades out with `opacity: 0`
- Discrete mode: grows to 100% width
- Auto-hides after 200ms

## Accessibility

The component implements the following ARIA attributes:

- `role="progressbar"` : Indicates this is a progress bar
- `aria-valuemin` : Minimum value (0)
- `aria-valuemax` : Maximum value (total)
- `aria-valuenow` : Current value (for discrete mode)

## State Management

The component automatically handles:
- Mode transitions (infinite ↔ discrete ↔ done)
- Long-running optimization (10-second threshold)
- Auto-completion callbacks
- Cleanup of timeouts and intervals

## Theme Integration

The component automatically adapts to themes through CSS variables. No additional configuration is required.

## Performance

The component uses:
- `useCallback` for optimized re-renders
- Automatic cleanup of timeouts
- Long-running mode optimization for GPU performance
- Efficient state management with `useState` and `useEffect`

## Notes for AI Usage

### Recommended Configuration

For optimal usage, always use theme variables:

```typescript
const defaultProgressBarStyles: IProgressBarStyles = {
  progressBarBackground: 'var(--progressBar-background)'
}
```

### Common Patterns

1. **File Upload Progress**: Use discrete mode with dynamic value updates
2. **Loading States**: Use infinite mode for indeterminate progress
3. **Task Completion**: Use done mode to show completion
4. **Custom Styling**: Override background color for specific use cases

### Integration with Async Operations

```tsx
const [uploadProgress, setUploadProgress] = useState(0)
const [uploadMode, setUploadMode] = useState<'infinite' | 'discrete' | 'done'>('infinite')

const handleFileUpload = async (file: File) => {
  setUploadMode('infinite')
  
  // Simulate upload progress
  for (let i = 0; i <= 100; i += 10) {
    await new Promise(resolve => setTimeout(resolve, 200))
    setUploadProgress(i)
  }
  
  setUploadMode('done')
}

<ProgressBar 
  mode={uploadMode}
  value={uploadProgress}
  total={100}
  onComplete={() => setUploadMode('infinite')}
/>
```

### Multiple Progress Bars

```tsx
const tasks = [
  { id: 1, name: 'Task 1', progress: 30 },
  { id: 2, name: 'Task 2', progress: 60 },
  { id: 3, name: 'Task 3', progress: 90 }
]

{tasks.map(task => (
  <div key={task.id}>
    <h4>{task.name}</h4>
    <ProgressBar 
      mode="discrete" 
      value={task.progress} 
      total={100}
    />
  </div>
))}
```

### Error Handling

```tsx
const [error, setError] = useState(false)

<ProgressBar 
  mode={error ? 'done' : 'discrete'}
  value={error ? 0 : progress}
  total={100}
  options={{ 
    progressBarBackground: error ? '#ff6b6b' : undefined 
  }}
/>
```

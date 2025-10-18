# ProgressBar Component

## Overview

The `ProgressBar` component is a React implementation of VSCode's ProgressBar widget. It provides both infinite and discrete progress indicators with VSCode styling, theme integration, and full accessibility support.

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
- **onComplete** (`() => void`) : Callback called when progress is completed

## Usage Examples

### Infinite Progress Bar

```tsx
import { ProgressBar } from 'electron-vscodelike-core-ui/renderer'

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
  onComplete={() => console.log('Progress completed')}
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
  onComplete={() => console.log('Download complete!')}
/>
```

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

## VSCode Theme Variables

The component uses the following CSS variables:

- `--vscode-progressBar-background` : Background color of the progress bar
- Default fallback: `#0E70C0` (VSCode blue)

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

The component automatically adapts to VSCode themes through CSS variables. No additional configuration is required.

## Performance

The component uses:
- `useCallback` for optimized re-renders
- Automatic cleanup of timeouts
- Long-running mode optimization for GPU performance
- Efficient state management with `useState` and `useEffect`

## Notes for AI Usage

### Recommended Configuration

For optimal usage, always use VSCode theme variables:

```typescript
const defaultProgressBarStyles: IProgressBarStyles = {
  progressBarBackground: 'var(--vscode-progressBar-background, #0E70C0)'
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

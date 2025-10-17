# Molecule UI Integration Notes

## Current Status

The project is set up with Molecule as a dependency (`@dtinsight/molecule@2.0.0-alpha.10`), but it is not currently integrated into the UI.

## Why Molecule is Not Yet Integrated

The alpha version (2.0.0-alpha.10) of Molecule has a different structure compared to stable releases:
- The CSS import path documented in the README (`@dtinsight/molecule/esm/style/mo.css`) does not exist
- CSS files are scattered in individual component directories
- There is no single consolidated CSS file to import

## Current Implementation

The application currently uses a simple React component with VSCode-inspired styling:
- Dark theme background (#1e1e1e)
- Light text color (#d4d4d4)
- VSCode blue accent color (#0e639c)
- Consolas, Monaco, Courier New font stack

## Next Steps for Full Molecule Integration

### Option 1: Wait for Stable Release
Monitor the Molecule releases and upgrade when a stable 2.x version is available with proper CSS exports.

### Option 2: Manual CSS Import
Import individual Molecule CSS files as needed:

```typescript
import '@dtinsight/molecule/esm/client/classNames/style.css'
import '@dtinsight/molecule/esm/client/classNames/common.css'
import '@dtinsight/molecule/esm/client/slots/workbench/index.css'
// ... import other required CSS files
```

### Option 3: Use Molecule Components Without Workbench
Import and use individual Molecule components without the full Workbench wrapper:

```typescript
import { Button, Input, Select } from '@dtinsight/molecule'
// Use components individually
```

## Recommended Approach

1. **For Now**: Keep the current simple implementation with VSCode-inspired styling
2. **Monitor**: Watch Molecule repository for stable 2.x release
3. **Upgrade**: Once stable version is available, integrate full Workbench UI
4. **Alternative**: Consider using Monaco Editor directly with custom UI components

## Resources

- [Molecule GitHub](https://github.com/DTStack/molecule)
- [Molecule Documentation](https://dtstack.github.io/molecule/)
- [Molecule Examples](https://github.com/DTStack/molecule-examples)


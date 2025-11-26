# Getting Started with restorm

## Prerequisites

- Node.js v18 or higher
- pnpm package manager
- Linux, macOS, or Windows with WSL2

## Installation

### 1. Run the Setup Script

The setup script will install pnpm (if not already installed) and all project dependencies:

```bash
./setup.sh
```

### 2. Manual Installation (Alternative)

If you prefer to install manually:

```bash
# Install pnpm globally
npm install -g pnpm

# Install dependencies
pnpm install
```

> **Note**: The project includes a `postinstall` script that automatically installs Electron to work around pnpm 10's build script restrictions.

## Development

### Start the Development Server

```bash
pnpm dev
```

This will:
1. Build the Electron main process
2. Build the preload scripts
3. Start the Vite dev server for the React renderer
4. Launch the Electron application

The application window should open automatically with "Hello restorm" displayed.

### Available Scripts

- `pnpm dev` - Start development mode with hot reload
- `pnpm build` - Build the application for production
- `pnpm preview` - Preview the production build
- `pnpm lint` - Run ESLint to check code quality
- `pnpm lint:fix` - Run ESLint and automatically fix issues
- `pnpm typecheck` - Run TypeScript type checking
- `pnpm package` - Package the application (without installer)
- `pnpm dist` - Build distributable packages (.deb, .rpm, etc.)

## Code Quality

### Linting

The project uses ESLint with strict TypeScript rules. All code must pass linting before committing:

```bash
pnpm lint
```

Configuration: `src/.eslintrc.json`

### Type Checking

TypeScript is configured in strict mode. Run type checking with:

```bash
pnpm typecheck
```

## Internationalization

### Adding New Translations

When adding user-facing strings, always add translations in both languages:

1. **English** (`src/renderer/locales/en/translation.json`):
```json
{
  "myFeature": {
    "greeting": "Hello"
  }
}
```

2. **French** (`src/renderer/locales/fr/translation.json`):
```json
{
  "myFeature": {
    "greeting": "Bonjour"
  }
}
```

### Using Translations in Code

```typescript
import { useTranslation } from 'react-i18next'

const MyComponent: React.FC = () => {
  const { t } = useTranslation()
  
  return <div>{t('myFeature.greeting')}</div>
}
```

### Switching Languages

```typescript
const { i18n } = useTranslation()

// Switch to French
i18n.changeLanguage('fr')

// Switch to English
i18n.changeLanguage('en')

// Get current language
const currentLang = i18n.language
```

## Project Structure

```
restorm/
├── src/                        # Application source code
│   ├── main/                  # Electron main process
│   │   └── index.ts          # Application entry point
│   ├── preload/              # Electron preload scripts
│   │   └── index.ts         # Preload script
│   └── renderer/             # React application
│       ├── index.html       # HTML template
│       ├── src/
│       │   ├── App.tsx      # Main React component
│       │   ├── main.tsx     # React entry point
│       │   ├── i18n.ts      # i18n configuration
│       │   └── locales/     # Translation files
│       │       ├── en/
│       │       │   └── translation.json
│       │       └── fr/
│       │           └── translation.json
├── dist/                       # Build output
│   ├── main/                  # Built main process
│   ├── preload/               # Built preload scripts
│   └── renderer/              # Built renderer
├── dist-electron/              # Distribution packages
├── build/                      # Build scripts and resources
├── electron.vite.config.ts     # Electron-vite configuration
├── tsconfig.json              # TypeScript config for renderer
├── tsconfig.node.json         # TypeScript config for main/preload
├── .eslintrc.json             # ESLint configuration (in src/)
└── package.json               # Dependencies and scripts
```

## Troubleshooting

### Electron Sandbox Issues on Linux

If you encounter sandbox-related errors, the application is configured to disable the sandbox in development mode via the `ELECTRON_DISABLE_SANDBOX=1` environment variable.

For production, you may need to:
```bash
sudo chown root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

### GPU Process Errors

GPU process errors in the console are expected in some environments and do not affect functionality. Electron will fall back to software rendering.

### Module Not Found Errors

If you encounter module not found errors:
1. Delete `node_modules` and `pnpm-lock.yaml`
2. Run `pnpm install` again
3. The `postinstall` script will automatically handle Electron installation

### Hot Reload Not Working

If hot reload stops working:
1. Stop the development server (Ctrl+C)
2. Delete the `dist` directory
3. Restart with `pnpm dev`

## Development Container

The project includes a dev container configuration (`.devcontainer/devcontainer.json`) for VS Code and GitHub Codespaces.

To use it:
1. Install the "Dev Containers" extension in VS Code
2. Open the project in VS Code
3. Click "Reopen in Container" when prompted
4. Dependencies will be installed automatically via the post-create script

## Next Steps

- Read the [main README](./README.md) for architecture details
- Check [MOLECULE_INTEGRATION.md](./MOLECULE_INTEGRATION.md) for UI framework notes
- Explore the codebase and start building features!


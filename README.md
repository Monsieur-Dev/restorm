# Gitable Monorepo

This repository contains two main packages:

1. **electron-core-ui** - A reusable Electron + React foundation library with VSCode-like UI components, theming, logging, window management, and i18n.
2. **gitable** - A modern Git GUI tool that uses the core-ui library.

## 📦 Package Structure

```
gitable/
├── electron-core-ui/    # Generic UI library (will be moved to separate repo later)
│   ├── src/
│   │   ├── main/                   # Main process services (logger, storage, theme, window)
│   │   ├── preload/                # Preload script utilities
│   │   └── renderer/               # React components and hooks
│   ├── resources/                  # Themes and fonts
│   ├── types/                      # TypeScript type definitions
│   └── package.json                # Library package config
│
├── gitable/                        # Gitable application
│   ├── src/
│   │   ├── main/                   # Application main process
│   │   ├── preload/                # Application preload script
│   │   └── renderer/               # Application UI
│   ├── docs/                       # Documentation
│   └── package.json                # Application package config
│
├── .cursor/                        # Cursor IDE configuration
├── .github/workflows/              # GitHub Actions CI/CD workflows
├── .git/                           # Git repository
└── dev.sh                          # Development script with hot reload
```

## 🚀 Quick Start

### Development Setup

The repository uses a custom development workflow for hot reload:

```bash
# From the repository root, run:
./dev.sh
```

This script will:
1. Start TypeScript compilation in watch mode for `electron-core-ui` (both main and renderer)
2. Auto-copy changes from core-ui to gitable's node_modules
3. Start the Gitable application with Electron + Vite dev server

**When you modify core-ui files:**
- TypeScript recompiles automatically (~1-2 seconds)
- Changes are copied to gitable/node_modules automatically
- Press **Ctrl+R** in the Electron app to reload and see changes

### Building Both Packages

To build both packages for production:

```bash
# Build electron-core-ui
cd electron-core-ui
npm install
npm run build

# Build gitable
cd ../gitable
pnpm install
pnpm run build
```

## 📦 electron-core-ui

A generic Electron + React foundation library providing:

- **Services**: Logger, Storage, Theme management, Window state persistence
- **Components**: Custom dropdown, tabs, settings tree view
- **Hooks**: Theme management hook
- **Resources**: VSCode themes, fonts
- **i18n**: Internationalization setup
- **TypeScript**: Full type definitions

### Usage in Applications

Applications like `gitable` reference the core-ui package locally using the `file:` protocol:

```json
{
  "dependencies": {
    "electron-core-ui": "file:../electron-core-ui"
  }
}
```

This allows local development without needing a pnpm workspace or symlinks.

### Future Plans

The `electron-core-ui` package will be moved to its own repository and published to npm, allowing multiple applications to use it as a dependency.

## 🛠️ Gitable

A modern Git GUI tool built with Electron, React, TypeScript, and inspired by VSCode.

### Technology Stack

- **Electron 28** - Desktop application framework
- **React 18** - UI library
- **TypeScript 5** - Type-safe JavaScript
- **Vite 5** - Fast build tool
- **electron-vite** - Optimized Electron + Vite integration
- **i18next** - Internationalization (English + French)
- **pnpm** - Fast, efficient package manager

### Available Commands

```bash
cd gitable

pnpm dev          # Start development server with hot reload
pnpm build        # Build for production
pnpm lint         # Check code quality
pnpm lint:fix     # Fix linting issues automatically
pnpm typecheck    # Run TypeScript type checking
pnpm package      # Package application (without installer)
pnpm dist         # Build distributable packages (.deb, .rpm, etc.)
```

### Documentation

Comprehensive documentation is available in the `gitable/docs` folder:

- **[Stack Setup](./gitable/docs/stack-setup/README.md)** - Complete technical stack overview
- **[Getting Started](./gitable/docs/stack-setup/GETTING_STARTED.md)** - Step-by-step development guide
- **[Theming](./gitable/docs/theming/README.md)** - Theme system documentation
- **[Window Management](./gitable/docs/window-management/README.md)** - Window state persistence

## 🔧 Development Workflow

### Hot Reload for Core-UI Changes

The `dev.sh` script provides a seamless development experience:

1. **Start development**: `./dev.sh` from the repository root
2. **Modify core-ui files**: Edit any file in `electron-core-ui/src/`
3. **Wait 2-3 seconds**: TypeScript recompiles and files are copied
4. **Reload**: Press **Ctrl+R** (or **Cmd+R** on macOS) in the Electron window

### Working on Gitable Only

If you're only modifying Gitable code (not core-ui):

```bash
cd gitable
pnpm dev
```

Changes to Gitable's renderer code will hot-reload automatically via Vite.

## 🌍 Internationalization

The application supports English and French. When adding new user-facing text:

1. Add English translation to `gitable/src/renderer/locales/en/translation.json`
2. Add French translation to `gitable/src/renderer/locales/fr/translation.json`
3. Use with `const { t } = useTranslation()` and `t('your.key')`

## 📄 License

MIT

## 🙏 Acknowledgments

- Inspired by [VSCode](https://code.visualstudio.com/)
- Built with [Molecule UI Framework](https://github.com/DTStack/molecule)
- Uses [electron-vite](https://github.com/alex8088/electron-vite) for optimal build setup

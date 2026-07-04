# restorm

A modern Git GUI tool built with Electron, React, TypeScript, and built with modern UI.

## 🚀 Quick Start

```bash
# Install dependencies and setup the project
./setup.sh

# Start development
pnpm dev
```

## 📚 Documentation

Comprehensive documentation is available in the `/docs` folder:

- **[Stack Setup](./docs/stack-setup/README.md)** - Complete technical stack overview and architecture
- **[Getting Started](./docs/stack-setup/GETTING_STARTED.md)** - Step-by-step guide for development
- **[Molecule Integration](./docs/stack-setup/MOLECULE_INTEGRATION.md)** - UI framework integration notes
- **[MCP server](./docs/mcp/README.md)** - Drive Restorm from Claude Code / Cursor: tool reference, runbook, security model
- **[Git integration](./docs/git-integration.md)** - Track a `.restorm` project in git: status bar, commit-message generator, 4-panel conflict resolution, semi-pull settings, MCP routes (Restorm Pro)

## 🛠️ Technology Stack

- **Electron 28** - Desktop application framework
- **React 18** - UI library
- **TypeScript 5** - Type-safe JavaScript
- **Vite 5** - Fast build tool
- **electron-vite** - Optimized Electron + Vite integration
- **i18next** - Internationalization (English + French)
- **ESLint** - Strict code quality enforcement
- **pnpm** - Fast, efficient package manager

## ✨ Features

- ✅ Modern Electron + React setup
- ✅ TypeScript with strict type checking
- ✅ Hot Module Replacement (HMR) for fast development
- ✅ Internationalization (i18n) with English and French
- ✅ Dark theme
- ✅ Strict ESLint configuration with zero warnings policy
- ✅ Dev container support
- ✅ Cross-platform (Linux, macOS, Windows)

## 📝 Development

### Available Commands

```bash
pnpm dev          # Start development server with hot reload
pnpm build        # Build for production
pnpm lint         # Check code quality
pnpm lint:fix     # Fix linting issues automatically
pnpm typecheck    # Run TypeScript type checking
pnpm package      # Package application (without installer)
pnpm dist         # Build distributable packages (.deb, .rpm, etc.)
```

### Code Quality Standards

- **Zero ESLint warnings** - All code must pass strict linting
- **TypeScript strict mode** - Full type safety required
- **Bilingual support** - All user-facing strings must have EN + FR translations

## 🌍 Internationalization

The application supports English and French. When adding new user-facing text:

1. Add English translation to `src/renderer/locales/en/translation.json`
2. Add French translation to `src/renderer/locales/fr/translation.json`
3. Use with `const { t } = useTranslation()` and `t('your.key')`

## 🐛 Known Issues

- **GPU Process Errors**: Non-critical GPU errors may appear in console on Linux. The application falls back to software rendering automatically.
- **Molecule UI**: The alpha version of Molecule is installed but not yet integrated. See [Molecule Integration](./docs/stack-setup/MOLECULE_INTEGRATION.md) for details.

## 📦 Project Structure

```
restorm/
├── src/                        # Application source code
│   ├── main/                  # Electron main process
│   ├── preload/               # Electron preload scripts
│   └── renderer/              # React application
├── dist/                       # Build output (main, renderer, preload)
├── dist-electron/              # Distribution packages (.deb, .rpm, etc.)
├── build/                      # Build scripts and resources
├── docs/                       # Documentation
│   └── stack-setup/           # Technical documentation
├── .devcontainer/              # Dev container configuration
├── .github/workflows/          # CI/CD workflows
├── electron.vite.config.ts     # Electron + Vite configuration
├── tsconfig.json              # TypeScript configuration (renderer)
├── tsconfig.node.json         # TypeScript configuration (main/preload)
├── package.json               # Dependencies and scripts
├── setup.sh                   # Project setup script
└── README.md                  # This file
```

## 🔧 System Requirements

- **Node.js**: v18 or higher
- **pnpm**: Latest version (installed by setup.sh)
- **OS**: Linux, macOS, or Windows with WSL2
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 500MB for dependencies

## 📖 Learning Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vite Guide](https://vitejs.dev/guide/)
- [i18next Documentation](https://www.i18next.com/)

## 👥 Contributing

This project follows strict coding standards:

1. All code must be in English
2. All commits must pass `pnpm lint` with zero warnings
3. All user-facing strings must have EN + FR translations
4. Follow the existing code style and patterns

## 📄 License

MIT

## 🙏 Acknowledgments


- Built with [Molecule UI Framework](https://github.com/DTStack/molecule)
- Uses [electron-vite](https://github.com/alex8088/electron-vite) for optimal build setup

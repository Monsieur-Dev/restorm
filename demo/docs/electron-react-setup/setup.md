# Electron React TypeScript Project Setup

## Overview

This document describes the setup and configuration of the Electron desktop application using React, TypeScript, Molecule UI, and i18n support.

## Project Structure

```
/workspace/
├── src/
│   ├── main/           # Electron main process
│   ├── renderer/       # React application
│   ├── preload/        # Preload scripts for security
│   ├── shared/         # Shared types and utilities
│   ├── __tests__/      # Jest test files
│   └── locales/        # i18n translation files
├── docs/
│   └── OYO-31/        # This documentation
├── .devcontainer/     # Dev container configuration
├── package.json       # Project dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── forge.config.js    # Electron Forge configuration
├── webpack.*.config.js # Webpack configurations
├── .eslintrc.json     # ESLint configuration
├── .prettierrc        # Prettier configuration
├── jest.config.js     # Jest configuration
└── .gitignore         # Git ignore rules
```

## Technologies Used

- **Electron**: Desktop application framework
- **React**: UI library
- **TypeScript**: Type-safe JavaScript
- **Molecule UI**: VSCode-like UI components
- **i18next**: Internationalization
- **Electron Forge**: Build and packaging
- **Webpack**: Module bundler
- **ESLint**: Code linting
- **Prettier**: Code formatting
- **Jest**: Testing framework
- **pnpm**: Package manager

## Features Implemented

### Core Features

- ✅ Electron main process with security best practices
- ✅ Preload script with contextBridge for secure IPC
- ✅ React application with Molecule UI
- ✅ VSCode themes and color palettes
- ✅ Fonts: Consolas, Monaco, Courier New, monospace
- ✅ VSCode icons from react-icons
- ✅ i18n support (English/French)
- ✅ "Hello Demo" display with translations

### Development Tools

- ✅ Strict ESLint configuration
- ✅ Prettier code formatting
- ✅ Jest testing setup
- ✅ TypeScript strict mode
- ✅ Git branch setup
- ✅ Dev container integration

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+

### Installation

1. Clone the repository
2. Run `pnpm install`
3. Start development: `pnpm start`

### Available Scripts

- `pnpm start`: Start development server
- `pnpm lint`: Run ESLint
- `pnpm lint:fix`: Fix ESLint issues
- `pnpm format`: Format code with Prettier
- `pnpm test`: Run tests
- `pnpm test:watch`: Run tests in watch mode
- `pnpm test:coverage`: Run tests with coverage
- `pnpm type-check`: Type check without emitting
- `pnpm build`: Build for production

## Configuration Details

### TypeScript

- Strict mode enabled
- Separate configs for main/renderer/preload
- Path aliases configured
- Source maps enabled

### Electron Forge

- Webpack plugin for bundling
- TypeScript support
- Development and production builds
- Auto-reload in dev mode

### Security

- Context isolation enabled
- Node integration disabled
- Remote module disabled
- Web security enabled
- Preload script for safe IPC

### i18n

- English and French translations
- Language detection
- Local storage persistence
- React integration

## Testing

The project includes Jest testing setup with:

- TypeScript support
- React Testing Library
- Mock configurations for Electron APIs
- Coverage reporting

## Cursor Rules

Based on the Linear ticket requirements:

1. **Translation Rule**: Each time a string displayed to the user is added to the project, its English and French translations should be added to the translation files.

2. **Linting Rule**: Each time code is produced within the project, the linter should be executed.

## Development Guidelines

- All code must be written in English
- Use TypeScript strict mode
- Follow ESLint rules (no warnings allowed)
- Format code with Prettier
- Write tests for new features
- Add translations for user-facing strings
- Use semantic commit messages

## Troubleshooting

### Common Issues

1. **Dependency conflicts**: Use `pnpm install --force`
2. **TypeScript errors**: Check tsconfig.json configuration
3. **ESLint errors**: Run `pnpm lint:fix`
4. **Build issues**: Clear `.webpack` directory

### Performance

- Use React.memo for expensive components
- Implement proper error boundaries
- Optimize bundle size with Webpack
- Use Electron's built-in performance tools

## Next Steps

- Add more UI components
- Implement file system operations
- Add more language support
- Create installer packages
- Add CI/CD pipeline

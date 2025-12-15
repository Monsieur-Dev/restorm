# Demo Stack Setup

## Overview

This document describes the technical stack and setup process for the Demo project.

## Technology Stack

### Core Technologies

- **Electron**: Desktop application framework
- **React**: UI library for building the user interface
- **TypeScript**: Type-safe JavaScript with strict configuration
- **Molecule**: VSCode-like UI component library (@dtinsight/molecule)

### Build Tools

- **electron-vite**: Modern build tooling optimized for Electron + React
- **Vite**: Fast development server and build tool
- **pnpm**: Fast, disk space efficient package manager

### Code Quality

- **ESLint**: Strict linting with TypeScript, React, and React Hooks plugins
- **TypeScript**: Strict mode enabled for maximum type safety

### Internationalization

- **i18next**: Internationalization framework
- **react-i18next**: React bindings for i18next
- **Languages**: English (EN) and French (FR)

### UI & Theming

- **VSCode Themes**: Official VSCode color palettes and themes
- **VSCode Icons**: Icon set from react-icons
- **Fonts**: Consolas, Monaco, Courier New, monospace

## Project Structure

```
demo/
├── src/
│   ├── main/              # Electron main process
│   │   └── index.ts
│   ├── preload/           # Electron preload scripts
│   │   └── index.ts
│   ├── renderer/          # React application
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── components/
│   │   ├── locales/       # Translation files
│   │   │   ├── en/
│   │   │   │   └── translation.json
│   │   │   └── fr/
│   │   │       └── translation.json
│   │   └── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── electron.vite.config.ts
├── .devcontainer/
│   └── devcontainer.json
├── setup.sh               # Setup script for tools installation
└── .cursorrules           # Project-specific Cursor rules
```

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- pnpm package manager

### Quick Start

1. Run the setup script to install required tools:
   ```bash
   ./setup.sh
   ```

2. Navigate to the src directory and install dependencies:
   ```bash
   cd src
   pnpm install
   ```

3. Run the development server:
   ```bash
   pnpm dev
   ```

### Available Scripts

- `pnpm dev`: Start the application in development mode with hot reload
- `pnpm build`: Build the application for production
- `pnpm lint`: Run ESLint to check code quality
- `pnpm preview`: Preview the production build

## Development Container

The project includes a dev container configuration that:
- Automatically installs pnpm
- Runs `pnpm install` after container creation
- Includes all necessary development tools

## Code Quality Rules

### Linting

- ESLint must be executed on all code production
- No compromises on code quality - all rules must pass
- Configuration includes TypeScript, React, and React Hooks plugins

### Internationalization

- Every user-facing string must have translations in both English and French
- Translation files are located in `src/renderer/locales/{en,fr}/translation.json`

## Architecture

### Electron Main Process

The main process (`src/main/index.ts`) handles:
- Window creation and management
- System-level operations
- Application lifecycle

### Preload Script

The preload script (`src/preload/index.ts`) provides:
- Secure bridge between main and renderer processes
- Exposed APIs for renderer to access Electron features

### React Renderer Process

The renderer process (`src/renderer/`) contains:
- React application code
- Molecule UI components
- Internationalization setup
- Application state management

## VSCode Integration

The project uses Molecule to provide a VSCode-like experience:
- Similar look and feel to VSCode/Cursor
- VSCode color themes and palettes
- VSCode icon set
- Familiar font stack

## Build Configuration

The project uses electron-vite for optimized builds:
- Fast Hot Module Replacement (HMR)
- Optimized production builds
- TypeScript support out of the box
- Separate configurations for main, preload, and renderer processes

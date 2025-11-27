#!/bin/bash

# Post-Create Script for Demo Electron Dev Container
# This script runs after the dev container is created

set -e

echo "🚀 Starting Demo Electron project setup..."

# Update package manager
echo "📦 Updating package manager..."
sudo apt-get update

# Install system dependencies for Electron
echo "🔧 Installing system dependencies for Electron..."
sudo apt-get install -y \
    libnss3-dev \
    libatk-bridge2.0-dev \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2

# Install X11 dependencies for virtual display
echo "🖥️ Installing X11 dependencies for virtual display..."
sudo apt-get install -y \
    xvfb \
    x11-utils \
    x11-xserver-utils \
    dbus-x11

# Install pnpm globally if not present
echo "📦 Installing pnpm..."
if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm
fi

# Install global Node.js packages for Electron development
echo "📦 Installing global Node.js packages..."
npm install -g \
    typescript \
    ts-node \
    eslint \
    prettier \
    @types/node \
    webpack-cli \
    @electron/rebuild

# Install project dependencies
echo "📦 Installing project dependencies..."
cd /workspace
pnpm install

# Install additional dependencies that were missing during debugging
echo "📦 Installing additional dependencies..."
pnpm add -D \
    @electron-forge/plugin-fuses \
    webpack-cli \
    css-loader \
    style-loader

# Rebuild native dependencies for Electron
echo "🔨 Rebuilding native dependencies..."
npx @electron/rebuild

# Run linting to verify setup
echo "🔍 Running linting check..."
pnpm lint

# Run type checking to verify setup
echo "🔍 Running type checking..."
pnpm type-check

# Run tests to verify setup
echo "🧪 Running tests..."
pnpm test

echo "✅ Demo Electron project setup completed successfully!"
echo ""
echo "🎉 Your Electron development environment is ready!"
echo "   - All dependencies installed"
echo "   - TypeScript configured"
echo "   - ESLint and Prettier configured"
echo "   - Jest testing setup"
echo "   - Electron Forge configured"
echo "   - X11 virtual display support"
echo ""
echo "Next steps:"
echo "1. For Linux desktop: Run 'pnpm start' directly"
echo "2. For dev container: Run './scripts/start-x11.sh' then 'pnpm start'"
echo "3. Run 'pnpm lint' to check code quality"
echo "4. Run 'pnpm test' to run tests"
echo "5. Run 'pnpm type-check' to verify TypeScript"
echo ""
echo "X11 Virtual Display:"
echo "  - Run './scripts/start-x11.sh' to start virtual display"
echo "  - Run './scripts/test-electron.sh' to test Electron"
echo "  - See './scripts/README.md' for detailed instructions"
echo ""
echo "Happy coding! 🚀"

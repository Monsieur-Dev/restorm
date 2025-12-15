#!/bin/bash

# Gitable Setup Script
# This script installs all required tools for the Gitable project

set -e

echo "================================================"
echo "Gitable Setup Script"
echo "================================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Node.js is installed
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed.${NC}"
    echo "Please install Node.js v18 or higher from https://nodejs.org/"
    echo "Or use nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Node.js version is too old (v$NODE_VERSION). Please upgrade to v18 or higher.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v) is installed${NC}"
echo ""

# Check if pnpm is installed
echo "Checking pnpm installation..."
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}pnpm is not installed. Installing pnpm...${NC}"
    npm install -g pnpm
    echo -e "${GREEN}✓ pnpm installed successfully${NC}"
else
    echo -e "${GREEN}✓ pnpm $(pnpm -v) is already installed${NC}"
fi
echo ""

# Install project dependencies
echo "Installing project dependencies..."
pnpm install
echo -e "${GREEN}✓ Dependencies installed successfully${NC}"
echo ""

echo "================================================"
echo -e "${GREEN}Setup completed successfully!${NC}"
echo "================================================"
echo ""
echo "Next steps:"
echo "  1. pnpm dev      # Start development server"
echo "  2. pnpm lint     # Run linter"
echo "  3. pnpm build    # Build for production"
echo "  4. pnpm dist     # Build distributable packages"
echo ""

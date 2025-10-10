# Dev Container Setup - OYO-30

## Overview

This document describes the complete dev container setup for the Gitable project, implementing OYO-30 requirements. The dev container provides a fully configured development environment with Electron build capabilities, integrated Git server, and automated initialization.

## Architecture

The dev container setup consists of:

- **Main Development Service**: Node.js 24 environment with Electron build dependencies
- **Git Server Service**: Alpine Linux with SSH-based Git server
- **Post-Create Script**: Automated environment initialization
- **Environment Management**: Configurable variables for ports and credentials

## Files Structure

```
.devcontainer/
├── devcontainer.json      # Dev container configuration
├── docker-compose.yml     # Multi-service orchestration
├── Dockerfile            # Development environment image
├── post-create.sh         # Initialization script
└── .env                   # Environment variables (local)

docs/dev-container/
└── README.md             # This documentation
```

## Configuration Details

### Dev Container Features

- `ghcr.io/devcontainers/features/git:1` - Git integration
- `ghcr.io/devcontainers/features/github-cli:1` - GitHub CLI
- `ghcr.io/devcontainers/features/node:1` - Node.js 24
- `ghcr.io/devcontainers/features/docker-in-docker:2` - Docker support

### VS Code Extensions

- TypeScript support
- Prettier formatting
- JSON/YAML support
- Git integration (GitLens)
- Docker support
- Remote containers

### Services Configuration

#### Development Service
- **Base Image**: `node:24-bullseye`
- **Electron Dependencies**: Complete build environment
- **User**: `node` with sudo privileges
- **Working Directory**: `/workspace`
- **Ports**: 3000 (Application), 22 (SSH)

#### Git Server Service
- **Base Image**: `alpine:latest`
- **SSH Server**: OpenSSH with Git support
- **Credentials**: Static user/password authentication
- **Port**: 22 (configurable)
- **Repositories**: Persistent volume storage

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GIT_SERVER_HOST` | `git-server` | Git server hostname |
| `GIT_SERVER_PORT` | `22` | Git server SSH port |
| `GIT_USER` | `user` | Git server username |
| `GIT_PASSWORD` | `password` | Git server password |
| `NODE_ENV` | `development` | Node.js environment |

## Environment Configuration

### Local Environment File

Create a `.devcontainer/.env` file to customize environment variables. Docker Compose automatically reads this file when located in the same directory as `docker-compose.yml`:

```bash
# Git Server Configuration
GIT_SERVER_HOST=git-server
GIT_SERVER_PORT=22
GIT_USER=user
GIT_PASSWORD=password

# Development Environment
NODE_ENV=development
```

### Default Values

If no `.env` file is provided, the system uses default values defined in `docker-compose.yml`.

## Setup Instructions

### Prerequisites

- Docker Desktop installed and running
- VS Code with Dev Containers extension
- Git configured locally

### Initial Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd gitable
   ```

2. **Checkout the dev container branch**:
   ```bash
   git checkout yoanndiguet/oyo-30-dev-container
   ```

3. **Configure environment** (optional):
   ```bash
   # Create local environment file in .devcontainer directory
   touch .devcontainer/.env
   # Edit .devcontainer/.env with your preferred settings
   ```

4. **Start the dev container**:
   - Open VS Code in the project directory
   - Use "Dev Containers: Reopen in Container"

### Using the Dev Container

1. **Install Dev Containers extension** if not already installed
2. **Reopen in Container**:
   - Command Palette (`Ctrl+Shift+P`)
   - "Dev Containers: Reopen in Container"
3. **Wait for initialization**:
   - Container build and startup
   - Post-create script execution
   - Environment setup completion

## Post-Create Script Features

The `post-create.sh` script automatically:

- Updates package manager
- Installs development tools (curl, wget, vim, nano, htop, tree, jq, unzip, zip)
- Installs Git LFS
- Configures Git user settings
- Generates SSH keys for Git server access
- Adds Git server to known hosts
- Creates workspace directories
- Installs global Node.js packages (TypeScript, ts-node, nodemon, pm2, eslint, prettier)
- Sets up Git repositories directory
- Creates sample repository
- Displays connection information

## Git Server Usage

### Connection Details

- **Host**: `git-server` (or configured `GIT_SERVER_HOST`)
- **Port**: `22` (or configured `GIT_SERVER_PORT`)
- **User**: `user`
- **Password**: `password`

### SSH Key Setup

The post-create script generates an SSH key pair. To use SSH authentication:

1. **Copy the public key** (displayed after container startup)
2. **Add to Git server** authorized_keys:
   ```bash
   # On the Git server container
   echo "your-public-key" >> /home/user/.ssh/authorized_keys
   ```

### Repository Operations

**Clone a repository**:
```bash
git clone user@git-server:repositories/your-repo.git
```

**Create a new repository**:
```bash
# On Git server
mkdir -p /home/user/repositories/new-repo.git
cd /home/user/repositories/new-repo.git
git init --bare
```

## Development Workflow

### Starting Development

1. Open VS Code in dev container
2. Install project dependencies: `npm install`
3. Start development server: `npm run dev`
4. Access application on port 3000

### Git Operations

1. Use the integrated Git server for local repositories
2. Configure remote repositories as needed
3. Use SSH keys for authentication

### Electron Development

The environment includes all necessary dependencies for Electron development:
- Native build tools
- Graphics libraries
- Audio support
- Platform-specific libraries

## Security Considerations

- Git server uses static credentials (change in production)
- SSH keys are generated per container instance
- Sudo privileges are configured for development convenience
- Environment variables should be secured in production

## Maintenance

### Updating Dependencies

To update system packages:
```bash
sudo apt-get update && sudo apt-get upgrade
```

To update Node.js packages:
```bash
npm update -g
```

### Container Cleanup

To clean up containers and volumes:
```bash
docker-compose -f .devcontainer/docker-compose.yml down -v
docker system prune -a
```

## Support

For issues related to the dev container setup:
1. Check the troubleshooting section
2. Validate configuration with test script
3. Review container logs
4. Ensure all prerequisites are met

---

**This dev container setup provides a complete, isolated development environment for Electron applications with integrated Git server capabilities.**
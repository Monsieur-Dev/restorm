#!/bin/bash

# Post-Create Script for Gitable Dev Container
# This script runs after the dev container is created

set -e

echo "🚀 Starting post-create setup..."

# Update package manager
echo "📦 Updating package manager..."
sudo apt-get update

# Set up Git configuration (if not already set)
echo "⚙️ Configuring Git..."
if [ -z "$(git config --global user.name)" ]; then
    git config --global user.name "Dev Container User"
fi
if [ -z "$(git config --global user.email)" ]; then
    git config --global user.email "dev@container.local"
fi

# Create SSH key for Git server access (if it doesn't exist)
echo "🔑 Setting up SSH keys..."
if [ ! -f ~/.ssh/id_rsa ]; then
    ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N "" -C "dev-container-key"
    echo "SSH key generated at ~/.ssh/id_rsa"
fi

# Add Git server to known hosts
echo "🌐 Adding Git server to known hosts..."
ssh-keyscan -p ${GIT_SERVER_PORT:-22} ${GIT_SERVER_HOST:-git-server} >> ~/.ssh/known_hosts 2>/dev/null || true

# Create workspace directories
echo "📂 Creating workspace directories..."
mkdir -p ~/git-repos
mkdir -p ~/projects

# Install Node.js global packages
echo "📦 Installing global Node.js packages..."
npm install -g \
    typescript \
    ts-node \
    nodemon \
    pm2 \
    eslint \
    prettier \
    @types/node

# Create a sample repository
echo "📚 Creating sample Git repository..."
sudo mkdir -p ~/git-repos
sudo chown -R node:node ~/git-repos
cd ~/git-repos
if [ ! -d "sample-repo.git" ]; then
    git init --bare sample-repo.git
    echo "Sample repository created at ~/git-repos/sample-repo.git"
fi

# Display Git server information
echo "ℹ️ Git Server Information:"
echo "  Host: ${GIT_SERVER_HOST:-git-server}"
echo "  Port: ${GIT_SERVER_PORT:-22}"
echo "  User: user"
echo "  Password: password"

# Display SSH key for Git server access
echo "🔑 SSH Public Key (add to Git server authorized_keys):"
cat ~/.ssh/id_rsa.pub

echo "✅ Post-create setup completed successfully!"
echo ""
echo "🎉 Your dev container is ready!"
echo "   - Git server is running on port ${GIT_SERVER_PORT:-22}"
echo "   - Sample repository available at ~/git-repos/sample-repo.git"
echo "   - SSH key generated for Git server access"
echo ""
echo "Next steps:"
echo "1. Add your SSH public key to the Git server's authorized_keys"
echo "2. Clone repositories using: git clone user@${GIT_SERVER_HOST:-git-server}:repositories/your-repo.git"
echo "3. Start developing!"

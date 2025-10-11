#!/bin/bash
# Post-install script for Gitable .deb package
# This script creates a wrapper in /usr/bin that adds required flags

# Remove the symlink if it exists
if [ -L "/usr/bin/gitable" ] || [ -f "/usr/bin/gitable" ]; then
    rm -f "/usr/bin/gitable"
fi

# Create the wrapper script
cat > /usr/bin/gitable << 'EOF'
#!/bin/bash
exec /opt/Gitable/gitable-bin --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer --disable-gpu-compositing "$@"
EOF

# Make it executable
chmod +x /usr/bin/gitable

# Update alternatives if needed
if command -v update-alternatives &> /dev/null; then
    update-alternatives --install /usr/bin/gitable gitable /usr/bin/gitable 100
fi


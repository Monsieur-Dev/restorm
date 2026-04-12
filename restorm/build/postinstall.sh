#!/bin/bash
# Post-install script for restorm .deb/.rpm packages
# Creates a wrapper script that launches the Electron binary with --ozone-platform=x11
# to enable window positioning on Wayland (Electron 38.2.0+ defaults to native Wayland
# which forbids apps from calling setPosition/setBounds).

INSTALL_DIR="/opt/restorm"
WRAPPER="/usr/bin/restorm"

cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/bin/bash
exec /opt/restorm/restorm-bin --no-sandbox --ozone-platform=x11 "$@"
WRAPPER_EOF

chmod 755 "$WRAPPER"

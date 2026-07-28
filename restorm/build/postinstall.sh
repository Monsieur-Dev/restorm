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

# Install the AppStream metainfo so software centres (KDE Discover, GNOME
# Software) show the app name, developer and licence instead of falling back to
# the package filename. Shipped as an extra resource next to the app.
METAINFO_SRC="$INSTALL_DIR/resources/restorm-resources/com.oyo-fr.restorm.metainfo.xml"
METAINFO_DIR="/usr/share/metainfo"
if [ -f "$METAINFO_SRC" ]; then
  mkdir -p "$METAINFO_DIR"
  cp -f "$METAINFO_SRC" "$METAINFO_DIR/com.oyo-fr.restorm.metainfo.xml"
fi

# Refresh the desktop + icon caches so the new entry/icon appear immediately.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true

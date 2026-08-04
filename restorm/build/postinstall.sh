#!/bin/bash
# Post-install script for restorm .deb/.rpm packages.
#
# Creates a launcher wrapper and points the desktop entry at it. The wrapper
# adds two flags the raw binary needs when started from a menu:
#   --no-sandbox            : distros that restrict unprivileged user namespaces
#                             (Ubuntu 24.04+/Kubuntu, AppArmor) SIGTRAP the
#                             Chromium sandbox at startup without it.
#   --ozone-platform-hint=auto : run natively on the session's display server
#                             (Wayland on a Wayland session, X11 otherwise)
#                             instead of forcing XWayland.

INSTALL_DIR="/opt/restorm"
WRAPPER="/usr/bin/restorm"

cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/bin/bash
exec /opt/restorm/restorm-bin --no-sandbox --ozone-platform-hint=auto "$@"
WRAPPER_EOF

chmod 755 "$WRAPPER"

# Point the menu launcher at the wrapper. electron-builder writes the desktop
# entry with Exec=/opt/restorm/restorm-bin (the raw binary) — launching that from
# the menu crashes on sandbox-restricted distros. Rewrite it to the wrapper so
# menu and CLI launch identically. (deb/rpm only — this script never runs for the
# AppImage, whose desktop integration is handled by its own runtime.)
#
# The rewrite also appends %f, the field code that makes the entry accept a
# document: without it the desktop database treats restorm as taking no
# argument, and double-clicking a .restorm launches an empty app. The wrapper
# forwards "$@" to the binary, so the path survives the extra hop.
DESKTOP_FILE="/usr/share/applications/restorm-bin.desktop"
if [ -f "$DESKTOP_FILE" ]; then
  sed -i 's|^Exec=/opt/restorm/restorm-bin.*|Exec=/usr/bin/restorm %f|' "$DESKTOP_FILE"
fi

# Register the .restorm document type. electron-builder declares MimeType= on
# the desktop entry, but the type itself has to exist in the shared MIME
# database before a file manager will map .restorm to it — otherwise the file
# shows up as plain text and the association never fires.
MIME_DIR="/usr/share/mime/packages"
mkdir -p "$MIME_DIR"
cat > "$MIME_DIR/restorm.xml" << 'MIME_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-restorm">
    <comment>Restorm API project</comment>
    <glob pattern="*.restorm"/>
    <icon name="restorm-bin"/>
    <generic-icon name="restorm-bin"/>
  </mime-type>
</mime-info>
MIME_EOF

# The document icon reuses the application icon: a dedicated .restorm document
# visual is a design task of its own, and shipping the app mark is better than
# shipping the generic "unknown file" square.
for SIZE in 16 32 48 64 128 256 512; do
  APP_ICON="/usr/share/icons/hicolor/${SIZE}x${SIZE}/apps/restorm-bin.png"
  MIME_ICON_DIR="/usr/share/icons/hicolor/${SIZE}x${SIZE}/mimetypes"
  if [ -f "$APP_ICON" ]; then
    mkdir -p "$MIME_ICON_DIR"
    cp -f "$APP_ICON" "$MIME_ICON_DIR/application-x-restorm.png"
  fi
done

command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime || true

# Install the AppStream metainfo so software centres (KDE Discover, GNOME
# Software) show the app name, developer and licence instead of falling back to
# the package filename. Shipped as an extra resource next to the app.
METAINFO_SRC="$INSTALL_DIR/resources/restorm-resources/com.monsieurdev.restorm.metainfo.xml"
METAINFO_DIR="/usr/share/metainfo"
if [ -f "$METAINFO_SRC" ]; then
  mkdir -p "$METAINFO_DIR"
  cp -f "$METAINFO_SRC" "$METAINFO_DIR/com.monsieurdev.restorm.metainfo.xml"
fi
# Transitional: drop the pre-rename component id if a previous build left it.
rm -f "$METAINFO_DIR/com.oyo-fr.restorm.metainfo.xml"

# Refresh the desktop + icon caches so the new entry/icon appear immediately.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true

# Rebuild the AppStream cache so software centres pick up the metainfo we just
# copied. dpkg's own appstream trigger only fires for files it tracks — ours is
# dropped by this script, so refresh explicitly. (--force covers "already
# refreshed recently".)
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli refresh-cache --force >/dev/null 2>&1 || appstreamcli refresh --force >/dev/null 2>&1 || true
fi

#!/bin/bash
# Post-remove cleanup for restorm .deb/.rpm.
#
# The postinstall creates two files OUTSIDE dpkg/rpm's tracking — the x11
# launcher wrapper (/usr/bin/restorm) and the AppStream metainfo — so package
# removal wouldn't drop them on its own. Remove them here, then refresh the
# desktop / icon / AppStream caches so the entry disappears from software
# centres immediately.

rm -f /usr/bin/restorm
rm -f /usr/share/metainfo/com.monsieurdev.restorm.metainfo.xml
# Transitional: the pre-rename component id, in case an older build installed it.
rm -f /usr/share/metainfo/com.oyo-fr.restorm.metainfo.xml

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli refresh-cache --force >/dev/null 2>&1 || appstreamcli refresh --force >/dev/null 2>&1 || true
fi

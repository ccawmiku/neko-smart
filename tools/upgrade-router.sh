#!/bin/sh
# Stage native files without stopping independent DNS or losing RAM samples.
set -eu
package="${1:?Usage: upgrade-router.sh /absolute/path/neko-smart-router.ipk}"
case "$package" in /*.ipk) ;; *) echo 'An absolute .ipk path is required' >&2; exit 1;; esac
[ -s "$package" ]
patch_prerm() {
 path=/usr/lib/opkg/info/neko-smart-router.prerm
 if [ -f "$path" ] && ! grep -q IPKG_NO_SCRIPT "$path"; then
  sed -i '2i [ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0' "$path"
 fi
}
patch_prerm
IPKG_NO_SCRIPT=1 opkg install "$package"
patch_prerm
printf '%s\n' 'Native files staged; running DNS and monitoring processes preserved.'

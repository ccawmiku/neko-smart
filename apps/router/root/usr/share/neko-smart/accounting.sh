#!/bin/sh
# Bundled accounting engine; no connection to the old nlbwmon daemon/socket.
set -e
. /lib/functions.sh
config_load neko_smart
config_get directory bandwidth database_directory /var/lib/neko-smart/bandwidth
case "$directory" in /*) ;; *) exit 1;; esac
case "$directory" in *..*|*[!a-zA-Z0-9/_.-]*) exit 1;; esac
mkdir -p "$directory" /var/run/neko-smart/account
chmod 700 "$directory" /var/run/neko-smart /var/run/neko-smart/account
[ "${1:-}" = prepare ] && exit 0
config_get refresh bandwidth refresh_interval 30
config_get commit bandwidth commit_interval 86400
config_get generations bandwidth database_generations 10
config_get interval bandwidth database_interval 1
for value in "$refresh" "$commit" "$generations" "$interval"; do
 case "$value" in ''|*[!0-9]*) exit 1;; esac
done
[ "$refresh" -ge 10 ] && [ "$refresh" -le 3600 ]
[ "$commit" -ge 3600 ] && [ "$commit" -le 604800 ]
[ "$generations" -ge 1 ] && [ "$generations" -le 24 ]
[ "$interval" -ge 1 ] && [ "$interval" -le 28 ]
config_get limit bandwidth database_limit 10000
config_get buffer bandwidth netlink_buffer_size 524288
case "$limit:$buffer" in *[!0-9:]*) exit 1;; esac
[ "$limit" -le 65536 ] && [ "$buffer" -ge 32768 ] && [ "$buffer" -le 4194304 ]
set -- /usr/sbin/neko-smart-account -L "$limit" -b "$buffer" -r "$refresh" -i "$commit" -G "$generations" -I "$interval" -o "$directory" -p /usr/share/neko-smart/protocols.txt
config_get_bool compress bandwidth database_compress 1
config_get_bool prealloc bandwidth database_prealloc 0
[ "$compress" = 0 ] || set -- "$@" -Z
[ "$prealloc" = 0 ] || set -- "$@" -P
config_get networks bandwidth local_network
. /lib/functions/network.sh
for network in $networks; do
 case "$network" in
  *.*|*:*)
   case "$network" in *[!0-9a-fA-F:./]*) exit 1;; esac
   set -- "$@" -s "$network";;
  *)
   case "$network" in ''|*[!a-zA-Z0-9_-]*) exit 1;; esac
   ranges=''
   if network_get_subnets ranges "$network"; then for range in $ranges; do set -- "$@" -s "$range"; done; fi
   ranges=''
   if network_get_subnets6 ranges "$network"; then for range in $ranges; do set -- "$@" -s "$range"; done; fi;;
 esac
done
exec "$@"

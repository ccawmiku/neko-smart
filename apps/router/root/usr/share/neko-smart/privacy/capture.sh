#!/bin/sh
# Network devices may appear after procd starts. Wait without removing DNS rules.
while :;do
 wan=$(/usr/share/neko-smart/privacy/guard.lua wan 2>/dev/null)
 [ -n "$wan" ] && [ -e "/sys/class/net/$wan" ] && break
 sleep 2
done
exec /usr/sbin/neko-smart-observer "$wan" "$1" "$2"

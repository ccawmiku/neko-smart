#!/bin/sh
# Run on the target router. The dedicated test table never receives a hook.
set -eu
table="neko_smart_guard_test_$$"
file="/tmp/$table.nft"
trap 'nft destroy table inet "$table" 2>/dev/null || true; rm -f "$file"' EXIT INT TERM
cat >"$file" <<EOF
destroy table inet $table
add table inet $table
table inet $table {
 map dns_route { type inet_service : inet_service; elements = { 53 : 53535 } }
 chain test { }
}
EOF
for attempt in 1 2 3; do
 nft -c -f "$file"
 nft -f "$file"
 nft list map inet "$table" dns_route | grep -q '53 : 53535'
done
printf '%s\n' 'DNS guard transaction: first load and repeated loads passed'

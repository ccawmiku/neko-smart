#!/bin/sh
# Explicit production cutover, only after PREPARE + collector link + package tests.
set -eu
[ -s /etc/neko-smart/migration.json ]
[ "$(uci -q get neko_smart.report.enabled)" = 1 ]
[ -n "$(uci -q get neko_smart.report.collector_url)" ]
[ -n "$(uci -q get neko_smart.report.token)" ]
success=0
stopped=0
rollback() {
 code=$?
 trap - EXIT INT TERM
 rm -f /var/run/neko-smart/cutover
 if [ "$success" = 0 ] && [ "$stopped" = 1 ]; then
  /etc/init.d/neko-smart stop || true
  for service in router-privacy router-node-health nlbwmon; do
   [ ! -x "/etc/init.d/$service" ] || "/etc/init.d/$service" start || true
  done
  if lua -e 'assert(dofile("/usr/share/router-privacy/guard.lua").firewall_valid())' >/dev/null 2>&1; then
   nft delete table inet neko_smart 2>/dev/null || true
   rm -f /usr/share/nftables.d/ruleset-post/90-neko-smart.nft
  fi
  printf '%s\n' 'Cutover failed; previous services restored, backups retained' >&2
  exit 1
 fi
 exit "$code"
}
trap rollback EXIT
trap 'exit 1' INT TERM
stopped=1
[ ! -x /usr/sbin/nlbw ] || /usr/sbin/nlbw -c commit
for service in router-privacy router-node-health nlbwmon; do
 [ ! -x "/etc/init.d/$service" ] || "/etc/init.d/$service" stop
done
# procd stop is asynchronous. Wait for the old ledger writer to finish gzip/commit.
for wait in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
 pidof nlbwmon >/dev/null 2>&1 || break
 sleep 1
done
if pidof nlbwmon >/dev/null 2>&1; then echo 'Legacy ledger writer did not stop' >&2;exit 1;fi
# Refresh the last in-RAM node history after the old scheduler has stopped.
if [ -s /var/run/router-node-health/history.json ]; then
 cp /var/run/router-node-health/history.json /etc/neko-smart/nodes/history.json
 chmod 600 /etc/neko-smart/nodes/history.json
fi
lua - <<'LUA'
local fs,json=require 'nixio.fs',require 'luci.jsonc'
local function copy(src,dst)
 local sys,util=require 'luci.sys',require 'luci.util'
 local before=assert(fs.stat(src));assert(before.size>0 and before.size<256*1024*1024,'Invalid source file capacity')
 assert(sys.call('cp -p '..util.shellquote(src)..' '..util.shellquote(dst..'.new'))==0,'File copy failed')
 assert(fs.stat(dst..'.new').size==before.size,'File copy size mismatch');assert(fs.rename(dst..'.new',dst));return true
end
local migration=json.parse(fs.readfile('/etc/neko-smart/migration.json')or '{}')
local dir=migration.ledger_directory
if dir then
 assert(dir:match('^/[%w/_.%-]+$')and not dir:find('..',1,true),'Invalid ledger source')
 for name in fs.dir(dir)do if name:match('^[%w_-]+%.db$')or name:match('^[%w_-]+%.db%.gz$')then
  assert(copy(dir..'/'..name,'/var/lib/neko-smart/bandwidth/'..name))
 end end
end
LUA
mkdir -p /var/run/neko-smart
chmod 700 /var/run/neko-smart
touch /var/run/neko-smart/cutover
rm -f /var/run/neko-smart/report-ok.json
/etc/init.d/neko-smart start
ready=0
for wait in 1 2 3 4 5 6 7 8 9 10 11 12; do
 sleep 5
 if lua - <<'LUA'
local fs,json,uci=require 'nixio.fs',require 'luci.jsonc',require('luci.model.uci').cursor()
local root='/var/run/neko-smart/'
local function read(path)return json.parse(fs.readfile(root..path)or '{}')or {}end
local report=read('report-ok.json');assert(report.time and os.time()-report.time<45)
assert(not fs.access(root..'report-error'))
local p=read('privacy/snapshot.json');assert(not p.error)
if uci:get('neko_smart','main','monitor_enabled')=='1'then assert(p.monitor and p.monitor.capture_fresh)end
if uci:get('neko_smart','main','dns_enabled')=='1'then
 assert(p.dns and p.dns.firewall_installed and p.dns.resolver_running and p.dns.health and p.dns.health.available)
 assert(dofile('/usr/share/neko-smart/privacy/guard.lua').firewall_valid())
end
if uci:get('neko_smart','nodes','enabled')=='1'then assert(fs.access(root..'nodes/history.json'))end
if uci:get('neko_smart','bandwidth','enabled')=='1'then assert(fs.access(root..'account.sock'));assert(json.parse(require('luci.sys').exec('/usr/sbin/neko-smart-ledger -c json 2>/dev/null')))end
LUA
 then ready=1;break;fi
done
[ "$ready" = 1 ]
# The new guard must be present before the legacy guard is removed.
/usr/share/neko-smart/privacy/guard.lua status >/dev/null
nft list table inet neko_smart >/dev/null 2>&1
if nft list table inet router_privacy >/dev/null 2>&1; then nft delete table inet router_privacy; fi
rm -f /usr/share/nftables.d/ruleset-post/90-router-privacy.nft
for service in router-privacy router-node-health nlbwmon; do
 [ ! -x "/etc/init.d/$service" ] || "/etc/init.d/$service" disable
done
/etc/init.d/neko-smart enable
lua -e 'local fs,json=require "nixio.fs",require "luci.jsonc";local p="/etc/neko-smart/migration.json";local v=assert(json.parse(fs.readfile(p)));v.active=true;v.activated=os.time();assert(fs.writefile(p..".new",json.stringify(v)));fs.chmod(p..".new","600");assert(fs.rename(p..".new",p))'
success=1
printf '%s\n' 'neko-smart active; legacy services disabled, rollback assets retained'

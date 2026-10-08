local state=dofile(arg[1]or 'apps/router/root/usr/share/neko-smart/report-state.lua')
local function snapshot(stamp)
 return {timestamp=stamp,monitor={enabled=true,capture_fresh=true},dashboard={encryption={encrypted={count=7}}},flows={{host='old.example'}}}
end
local function heartbeat(privacy,enabled,profile)
 assert(privacy.config.profile==profile)
 assert(privacy.monitor.enabled==enabled and privacy.monitor.capture_fresh==false)
 assert(privacy.monitor.conntrack_available==false)
 assert(privacy.dashboard==nil and privacy.dns==nil and #privacy.flows==0)
end
-- Switching to guard must discard even a recent snapshot and active node state.
local privacy,nodes=state.current(snapshot(1999),{timestamp=1999,nodes={n={status='up'}}},{profile='guard',monitor_enabled='1'},true,2000)
heartbeat(privacy,false,'guard');assert(nodes==nil and privacy.timestamp==2000)
-- Turning collection off must not turn its last snapshot into a new observation.
privacy=state.current(snapshot(1999),nil,{profile='full',monitor_enabled='0'},false,2000)
heartbeat(privacy,false,'full')
-- Expired, future, missing and incomplete snapshots become explicitly unobserved.
for _,old in ipairs({snapshot(1984),snapshot(2001),{timestamp=1999}})do
 privacy=state.current(old,nil,{profile='full',monitor_enabled='1'},false,2000)
 heartbeat(privacy,true,'full')
end
privacy=state.current(nil,nil,{profile='full',monitor_enabled='1'},false,2000)
heartbeat(privacy,true,'full')
-- An active, current full snapshot keeps its real observation and metrics.
local live=snapshot(1985);local live_nodes={timestamp=1970,nodes={n={status='up'}}}
privacy,nodes=state.current(live,live_nodes,{profile='full',monitor_enabled='1'},true,2000)
assert(privacy==live and privacy.timestamp==1985 and privacy.monitor.capture_fresh==true)
assert(privacy.dashboard.encryption.encrypted.count==7 and #privacy.flows==1 and nodes==live_nodes)
-- Retained node files are not live when disabled, expired or future-dated.
for _,stamp in ipairs({1969,2001})do
 local _,old_nodes=state.current(snapshot(1999),{timestamp=stamp},{profile='full',monitor_enabled='1'},true,2000)
 assert(old_nodes==nil)
end
local _,disabled_nodes=state.current(snapshot(1999),live_nodes,{profile='full',monitor_enabled='1'},false,2000)
assert(disabled_nodes==nil)
-- Preserve the existing bound and count the omitted flows before truncating.
live=snapshot(2000);live.flows={};for i=1,2050 do live.flows[i]={host='flow'..i}end
privacy=state.current(live,nil,{monitor_enabled='1'},false,2000)
assert(#privacy.flows==2048 and privacy.monitor.report_truncated_flows==2)
print('Reporter live-state and mode transition checks passed')

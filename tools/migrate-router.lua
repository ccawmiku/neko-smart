-- GPL-3.0-or-later. PREPARE only: migrate settings/history, never stop services.
-- Run after installing neko-smart-router with its shipped modules disabled.
local fs,json,uci=require 'nixio.fs',require 'luci.jsonc',require('luci.model.uci').cursor()
assert(fs.access('/usr/share/neko-smart/privacy/guard.lua'),'Install neko-smart-router first')
assert(not fs.access('/etc/neko-smart/migration.json'),'Migration already prepared; preserve current settings')
local function copy(src,dst)
 local sys,util=require 'luci.sys',require 'luci.util'
 local before=assert(fs.stat(src));assert(before.size>0 and before.size<256*1024*1024,'Invalid source file capacity')
 assert(sys.call('cp -p '..util.shellquote(src)..' '..util.shellquote(dst..'.new'))==0,'File copy failed')
 assert(fs.stat(dst..'.new').size==before.size,'File copy size mismatch');assert(fs.rename(dst..'.new',dst));return true
end
local root='/etc/neko-smart';fs.mkdirr(root);fs.chmod(root,'700')
local function atomic(path,text)assert(fs.writefile(path..'.new',text));fs.chmod(path..'.new','600');assert(fs.rename(path..'.new',path))end
-- Explicitly named source assets only. Contains credentials: stays router-local.
for _,name in ipairs({'router_privacy','router_node_health','nlbwmon','openclash','neko_smart'})do
 local data=fs.readfile('/etc/config/'..name);if data then atomic(root..'/before-'..name,data)end
end
local function copy_config(source,section,target)
 local data=uci:get_all(source,section);if not data then return false end
 for key,value in pairs(data)do if key:sub(1,1)~='.'then
  if type(value)=='table'then uci:delete('neko_smart',target,key);uci:set_list('neko_smart',target,key,value)else uci:set('neko_smart',target,key,value)end
 end end;return true
end
local privacy=copy_config('router_privacy','main','main');local nodes=copy_config('router_node_health','main','nodes')
local bandwidth=false;local directory=nil
uci:foreach('nlbwmon','nlbwmon',function(data)
 if bandwidth then return end;bandwidth=true;directory=data.database_directory
 for _,key in ipairs({'database_generations','database_interval','local_network','database_limit','database_prealloc','database_compress','netlink_buffer_size'})do if data[key]then
  if type(data[key])=='table'then uci:set_list('neko_smart','bandwidth',key,data[key])else uci:set('neko_smart','bandwidth',key,data[key])end
 end end
 for _,key in ipairs({'refresh_interval','commit_interval'})do
  local value=tostring(data[key]or (key=='refresh_interval'and '30s'or '24h'));local n,unit=value:match('^(%d+)([smhd]?)$');assert(n,'Unsupported legacy interval; manual adaptation needed')
  local seconds=tonumber(n)*(({s=1,m=60,h=3600,d=86400})[unit]or 1);uci:set('neko_smart','bandwidth',key,tostring(seconds))
 end
 local proto=data.protocol_database or '/usr/share/nlbwmon/protocols';local stat=fs.stat(proto);if stat then assert(stat.size<1024*1024,'Protocol table too large');assert(copy(proto,'/usr/share/neko-smart/protocols.txt'))end
 uci:set('neko_smart','bandwidth','enabled','1')
end)
fs.mkdirr(root..'/nodes');local history=fs.readfile('/var/run/router-node-health/history.json')or fs.readfile('/etc/router-node-health/history.json')
if history then assert(#history<1024*1024 and json.parse(history),'Invalid legacy node history');atomic(root..'/nodes/history.json',history)end
-- Never move/delete the old ledger. Copy complete generations for rollback.
local target='/var/lib/neko-smart/bandwidth';fs.mkdirr(target);fs.chmod(target,'700');local copied=0
if directory then
 assert(directory:match('^/[%w/_.%-]+$')and not directory:find('..',1,true),'Invalid source ledger directory')
 for name in fs.dir(directory)do
  if name:match('^[%w_-]+%.db$')or name:match('^[%w_-]+%.db%.gz$')then
   local stat=fs.stat(directory..'/'..name);assert(stat and stat.size<256*1024*1024,'Ledger capacity exceeded')
   assert(copy(directory..'/'..name,target..'/'..name));fs.chmod(target..'/'..name,'600');copied=copied+1
  end
 end
end
uci:save('neko_smart');assert(uci:commit('neko_smart'))
atomic(root..'/migration.json',json.stringify({prepared=os.time(),privacy=privacy,nodes=nodes,bandwidth=bandwidth,ledger_directory=directory,ledger_files=copied,node_history=history~=nil}))
print(json.stringify({prepared=true,privacy_settings=privacy,node_settings=nodes,bandwidth_settings=bandwidth,ledger_files=copied,node_history=history~=nil}))

-- GPL-3.0-or-later. Local adapter to the installed OpenClash controller.
-- Only explicit, validated user actions can enter this bridge.
local fs,json,sys,uci=require 'nixio.fs',require 'luci.jsonc',require 'luci.sys',require('luci.model.uci').cursor()
local root='/var/run/neko-smart/'
local M={}
local allowed={run_mode={['']=true,['-tun']=true,['-mix']=true},rule_mode={rule=true,global=true,direct=true},meta_sniffer={['0']=true,['1']=true},respect_rules={['0']=true,['1']=true},oversea={['0']=true,['1']=true,['2']=true},stream_unlock={['0']=true,['1']=true}}
local keys={meta_sniffer='enable_meta_sniffer',respect_rules='enable_respect_rules',oversea='china_ip_route',stream_unlock='stream_auto_select'}
local function ack()return json.parse(fs.readfile(root..'openclash-ack.json')or '{}')or {}end
function M.status()
 uci:unload('openclash')
 local available=fs.access('/etc/init.d/openclash')
 local mode=uci:get('openclash','config','en_mode')or ''
 local value={available=available or false,enabled=uci:get('openclash','config','enable')=='1',running=available and sys.call('pidof clash mihomo >/dev/null 2>&1')==0 or false,run_mode=mode:match('(%-tun)$')or mode:match('(%-mix)$')or '',operation_mode=uci:get('openclash','config','operation_mode')or 'fake-ip',rule_mode=uci:get('openclash','config','proxy_mode')or 'rule',config=(uci:get('openclash','config','config_path')or ''):match('[^/]+$')or '',ack=ack()}
 for key,option in pairs(keys)do value[key]=uci:get('openclash','config',option)or '0'end
 return value
end
function M.apply(command)
 if type(command)~='table'or type(command.id)~='string'or not command.id:match('^[%x%-]+$')or #command.id~=36 or type(command.createdAt)~='number'or math.abs(os.time()*1000-command.createdAt)>120000 then return false end
 if command.id==ack().id then return false end
 local action=command.action
 if action~='start'and action~='stop'and action~='restart'and action~='setting'then return false end
 if action=='setting'and(not allowed[command.key]or not allowed[command.key][command.value])then return false end
 local ok,err=pcall(function()
  assert(fs.access('/etc/init.d/openclash'),'OpenClash unavailable')
  if action~='setting'then
   local enabled=action=='stop'and '0'or '1';uci:unload('openclash')
   if uci:get('openclash','config','enable')~=enabled then uci:set('openclash','config','enable',enabled);assert(uci:commit('openclash'))end
   assert(sys.call('/etc/init.d/openclash '..action..' >/dev/null 2>&1')==0,'Service action failed')
  else
   local state=M.status();if state[command.key]==command.value then return end
   -- Calling upstream handlers preserves overwrite and runtime-config semantics.
   local http=require 'luci.http'
   local saved={formvalue=http.formvalue,status=http.status,prepare_content=http.prepare_content,write_json=http.write_json,write=http.write}
   local status=200
   local params=command.key=='run_mode'and {run_mode=command.value}or command.key=='rule_mode'and {rule_mode=command.value}or {setting=command.key,value=command.value}
   http.formvalue=function(key)return params[key]end;http.status=function(code)status=code end;http.prepare_content=function()end;http.write_json=function()end;http.write=function()end
   local success,message=pcall(function()
    local native=require 'luci.controller.openclash'
    local name=command.key=='run_mode'and 'action_switch_run_mode'or command.key=='rule_mode'and 'action_switch_rule_mode'or 'action_switch_oc_setting'
    assert(type(native[name])=='function','Unsupported OpenClash version');native[name]()
   end)
   for key,value in pairs(saved)do http[key]=value end
   assert(success,message);assert(status<400,'OpenClash rejected setting')
  end
 end)
 fs.mkdirr(root);local payload=json.stringify({id=command.id,time=os.time(),ok=ok,error=ok and json.null or tostring(err):sub(1,160)})
 assert(fs.writefile(root..'openclash-ack.json.new',payload));fs.chmod(root..'openclash-ack.json.new','600');assert(fs.rename(root..'openclash-ack.json.new',root..'openclash-ack.json'))
 return true
end
return M

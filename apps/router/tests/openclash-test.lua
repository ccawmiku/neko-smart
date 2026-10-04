-- Adapter checks run with fake filesystem/UCI/controller; they cannot change router settings.
local files,calls={},{}
local config={en_mode='fake-ip',operation_mode='fake-ip',proxy_mode='rule',enable='1'}
package.loaded['nixio.fs']={access=function()return true end,readfile=function(p)return files[p]end,mkdirr=function()end,writefile=function(p,v)files[p]=v;return true end,chmod=function()end,rename=function(a,b)files[b]=files[a];return true end}
package.loaded['luci.model.uci']={cursor=function()return {unload=function()end,get=function(_,_,_,key)return config[key]end,set=function(_,_,_,key,v)config[key]=v end,commit=function()return true end}end}
package.loaded['luci.sys']={call=function(cmd)calls[#calls+1]=cmd;return 0 end}
local http={formvalue=function()end,status=function()end,prepare_content=function()end,write_json=function()end,write=function()end}
package.loaded['luci.http']=http
package.loaded['luci.controller.openclash']={action_switch_oc_setting=function()calls[#calls+1]=http.formvalue('setting')..'='..http.formvalue('value')end,action_switch_run_mode=function()calls[#calls+1]='mode='..http.formvalue('run_mode')end}
local bridge=dofile(arg[1]or '/usr/share/neko-smart/openclash.lua')
local function command(id,key,value)return {id=id,createdAt=os.time()*1000,action='setting',key=key,value=value}end
local id='00000000-0000-0000-0000-000000000001'
assert(not bridge.apply(command(id,'respect_rules','2')))
assert(bridge.apply(command(id,'respect_rules','1')))
assert(calls[#calls]=='respect_rules=1')
assert(not bridge.apply(command(id,'respect_rules','1')))
assert(not bridge.apply(command(id,'execute','reboot')))
local nextid='00000000-0000-0000-0000-000000000002'
assert(bridge.apply(command(nextid,'run_mode','-tun')))
assert(calls[#calls]=='mode=-tun')
assert(bridge.status().ack.id==nextid)
print('OpenClash adapter validation, native dispatch and deduplication passed')

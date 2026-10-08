-- GPL-3.0-or-later. Unified metadata transport; no dependency on retired services.
local fs,nixio,json,uci=require 'nixio.fs',require 'nixio',require 'luci.jsonc',require('luci.model.uci').cursor()
local guard=dofile('/usr/share/neko-smart/privacy/guard.lua')
local history=dofile('/usr/share/neko-smart/nodes/history.lua')
local openclash=dofile('/usr/share/neko-smart/openclash.lua')
local account_scope=dofile('/usr/share/neko-smart/account-scope.lua')
local root='/var/run/neko-smart/'
fs.mkdirr(root);fs.chmod(root,'700')
local boot=(fs.readfile('/proc/sys/kernel/random/boot_id')or tostring(os.time())):gsub('[^%w_-]','')..'-'..tostring(nixio.getpid())
local sequence=0;local archive_index=0;local counters={};local last_settings='';local settings_error=nil
local function atomic(path,text)assert(fs.writefile(path..'.new',text));fs.chmod(path..'.new','600');assert(fs.rename(path..'.new',path))end
local function read(path,limit)local s=fs.stat(path);if s and s.size<(limit or 8*1024*1024)then return json.parse(fs.readfile(path)or '')end end
local function numeric(path)return tonumber(fs.readfile(path)or '')end
local function safe_array(value)return type(value)=='table' and value or {}end
local function bandwidth()
 local statuses={};local bus=require('ubus').connect()
 if bus then for _,name in ipairs({'lan','wan','wan6'})do local ok,status=pcall(bus.call,bus,'network.interface.'..name,'status',{});if ok and status then statuses[name]=status end end;bus:close()end
 local context=account_scope.context(statuses)
 local enabled=uci:get('neko_smart','bandwidth','enabled')=='1';local data=enabled and json.parse(require('luci.sys').exec('/usr/sbin/neko-smart-ledger -c json 2>/dev/null'))or nil
 local periods={};local period_text=enabled and require('luci.sys').exec('/usr/sbin/neko-smart-ledger -c list 2>/dev/null')or '';local period=''
 for date in period_text:gmatch('%d%d%d%d%-%d%d%-%d%d')do if date>period then period=date end;periods[#periods+1]=date end;table.sort(periods,function(a,b)return a>b end);while #periods>24 do table.remove(periods)end
 local names={};local leases=fs.readfile("/tmp/dhcp.leases")or "";if #leases<65536 then for ip,name in leases:gmatch("%d+%s+[%x:]+%s+([^%s]+)%s+([^%s]+)")do if name~="*"then names[ip]=name end end end
 local devices,totals={}, {download=0,upload=0};local columns=data and data.columns or {}
 for index,row in ipairs(data and data.data or {})do if index>8192 then break end;local device={}
  for i,name in ipairs(columns)do device[name]=row[i]end
  device.hostname=names[device.ip]
  device.scope=account_scope.classify(device.ip,context)
  devices[#devices+1]=device;totals.download=totals.download+(tonumber(device.rx_bytes)or 0);totals.upload=totals.upload+(tonumber(device.tx_bytes)or 0)
 end
 local archive=nil
 if #periods>0 then
  archive_index=archive_index%#periods+1;local date=periods[archive_index]
  local past=json.parse(require('luci.sys').exec('/usr/sbin/neko-smart-ledger -c json -t '..date..' 2>/dev/null'))
  if past then local records={};local sums={download=0,upload=0}
   for index,row in ipairs(past.data or {})do if index>8192 then break end;local record={};for i,name in ipairs(past.columns or {})do record[name]=row[i]end;record.hostname=names[record.ip];record.scope=account_scope.classify(record.ip,context);records[#records+1]=record;sums.download=sums.download+(tonumber(record.rx_bytes)or 0);sums.upload=sums.upload+(tonumber(record.tx_bytes)or 0)end
   archive={period=date,devices=records,totals=sums,available=true,capacity_limited=#(past.data or {})>8192}
  end
 end
 local interfaces={};local ok,wan=pcall(guard.wan);local now=nixio.sysinfo().uptime
 if ok and wan and wan:match('^[%w_.:%-]+$')then
  local rx=numeric('/sys/class/net/'..wan..'/statistics/rx_bytes');local tx=numeric('/sys/class/net/'..wan..'/statistics/tx_bytes');local old=counters[wan];local delta=old and now-old.time or 0
  local valid=rx and tx and old and rx>=old.rx and tx>=old.tx and delta>0 and delta<=120
  interfaces[1]={name=wan,rx=rx,tx=tx,rxBps=valid and (rx-old.rx)/delta or json.null,txBps=valid and (tx-old.tx)/delta or json.null,interval=delta,available=rx~=nil and tx~=nil}
  if rx and tx then counters[wan]={rx=rx,tx=tx,time=now}end
 end
 return {available=data~=nil,enabled=enabled,period=period,periods=periods,archive=archive,devices=devices,totals=totals,interfaces=interfaces,network_context=context,refresh_interval=tonumber(uci:get('neko_smart','bandwidth','refresh_interval'))or 30,capacity_limited=data and #(data.data or {})>8192 or false}
end
local function request(method,url,body)
 local base=uci:get('neko_smart','report','collector_url')or '';local token=uci:get('neko_smart','report','token')or ''
 if not base:match('^https?://[%w.:%-]+/?$') or #base>256 or not token:match('^[a-f0-9]+$') or #token~=64 then return nil,'invalid-link' end
 -- HTTP is only accepted for LAN/private endpoints; public reports require TLS.
 if base:match('^http://') and not(base:match('^http://192%.168%.')or base:match('^http://10%.')or base:match('^http://127%.')or base:match('^http://172%.1[6-9]%.')or base:match('^http://172%.2%d%.')or base:match('^http://172%.3[01]%.'))then return nil,'https-required' end
 atomic(root..'headers','Authorization: Bearer '..token..'\nContent-Type: application/json\n')
 if body then atomic(root..'report.json',json.stringify(body))end
 local util=require 'luci.util';local cmd='/usr/bin/curl --silent --show-error --fail --connect-timeout 3 --max-time 10 --proto =http,https --max-filesize 1048576 -H @'..root..'headers -X '..method
 if body then cmd=cmd..' --data-binary @'..root..'report.json'end
 cmd=cmd..' '..util.shellquote(base:gsub('/$','')..url)..' 2>/dev/null'
 local response=require('luci.sys').exec(cmd);fs.unlink(root..'report.json');fs.unlink(root..'headers');return json.parse(response)
end
local function apply_settings(data)
 if type(data)~='table' then return end
 local control=data._openclash;data._openclash=nil
 local control_changed=type(control)=='table'and openclash.apply(control)or false
 local command=data._command;data._command=nil
 if type(command)=='table'and type(command.id)=='string'and #command.id==36 and type(command.node)=='string'and #command.node<=256 and command.createdAt and math.abs(os.time()*1000-command.createdAt)<300000 then
  local ack=read(root..'probe-ack.json')or {};local db=read(root..'nodes/history.json',1024*1024)or {}
  if command.id~=ack.id and db.nodes and db.nodes[command.node]and not db.nodes[command.node].removed then
   atomic(root..'nodes/probe',json.stringify({time=os.time(),node=command.node}));atomic(root..'probe-ack.json',json.stringify({id=command.id,time=os.time(),node=command.node}))
  end
 end
 if next(data)==nil then return control_changed end
 local encoded=json.stringify(data);if encoded==last_settings then return control_changed end
 if data.privacy then local error=guard.validate(data.privacy);if error then settings_error=error;return end end
 local rules={nodes={enabled={0,1},interval={30,3600},timeout={500,10000},max_nodes={1,64},keep_samples={30,360},persistent={0,1},targets='urls'},bandwidth={enabled={0,1},refresh_interval={10,3600},commit_interval={3600,604800},database_generations={1,24},database_interval={1,28},database_limit={0,65536},netlink_buffer_size={32768,4194304},database_prealloc={0,1},database_compress={0,1},local_network='networks'}}
 for section,values in pairs(data)do
  if section~='privacy' then
   if not rules[section]or type(values)~='table'then settings_error='invalid-section';return end
   for key,value in pairs(values)do local rule=rules[section][key];if not rule then settings_error='invalid-key';return end
    if type(rule)=='table'then local n=tonumber(value);if type(value)~='string'or not value:match('^%d+$')or not n or n<rule[1]or n>rule[2]then settings_error='invalid-'..key;return end
    else
     if type(value)~='table'or #value>64 then settings_error='invalid-list';return end
     for _,v in ipairs(value)do
      if type(v)~='string'or #v>512 or v:find('[\r\n%z]')then settings_error='invalid-list-item';return end
      if rule=='urls'and not v:match('^https?://[%w.:%-]+/')then settings_error='invalid-target';return end
      if rule=='networks'and not require('luci.ip').new(v)and not(v:match('^[%w_-]+$')and uci:get('network',v)=='interface')then settings_error='invalid-network';return end
     end
    end
   end
  end
 end
 local changed=false
 for section,values in pairs(data)do local name=section=='privacy'and 'main'or section
  for key,value in pairs(values)do
   if json.stringify(uci:get('neko_smart',name,key))~=json.stringify(value)then
    if type(value)=='table'then uci:delete('neko_smart',name,key);uci:set_list('neko_smart',name,key,value)else uci:set('neko_smart',name,key,value)end;changed=true
   end
  end
 end
 if changed then uci:save('neko_smart');assert(uci:commit('neko_smart'));atomic(root..'settings-applied.json',json.stringify({time=os.time(),settings=data}));last_settings=encoded;settings_error=nil;os.execute('/etc/init.d/neko-smart reload >/dev/null 2>&1 &')else last_settings=encoded;settings_error=nil end
 return control_changed
end
local pending=nil
while true do
 uci:unload('neko_smart');local interval=math.max(10,math.min(300,tonumber(uci:get('neko_smart','report','interval'))or 30));local backend=tonumber(uci:get('neko_smart','report','backend_id'))
 local ok,err=pcall(function()
  if not pending then
   sequence=sequence+1;local privacy=read(root..'privacy/snapshot.json');local nodes=read(root..'nodes/history.json',1024*1024)
   if privacy then
    privacy.config=guard.settings();privacy.monitor.report_truncated_flows=math.max(0,#safe_array(privacy.flows)-2048)
    while #safe_array(privacy.flows)>2048 do table.remove(privacy.flows)end
   else
    privacy={config=guard.settings(),flows={},monitor={report_truncated_flows=0}}
   end
   if nodes then
    for _,node in pairs(nodes.nodes or {})do node.summary=history.summary(node)end
    nodes.probe_ack=read(root..'probe-ack.json')or json.null
    nodes.config={};for _,key in ipairs({'enabled','interval','timeout','max_nodes','keep_samples','persistent','targets'})do nodes.config[key]=uci:get('neko_smart','nodes',key)end
   end
   pending={protocolVersion=1,backendId=backend,bootId=boot,sequence=sequence,observedAt=os.time()*1000,snapshot={privacy=privacy or json.null,nodes=nodes or json.null,bandwidth=bandwidth(),openclash=openclash.status()}}
   pending.snapshot.bandwidth.config={};for _,key in ipairs({'enabled','refresh_interval','commit_interval','database_generations','database_interval','local_network','database_limit','database_prealloc','database_compress','netlink_buffer_size'})do pending.snapshot.bandwidth.config[key]=uci:get('neko_smart','bandwidth',key)end
   pending.snapshot.bandwidth.settings_error=settings_error or json.null
   pending.snapshot.bandwidth.settings_applied=read(root..'settings-applied.json')or json.null
  end
  local response=request('POST','/api/monitor/report',pending)
  if response and type(response.accepted)=='boolean'then atomic(root..'report-ok.json',json.stringify({time=os.time(),boot=boot,sequence=pending.sequence}));pending=nil;fs.unlink(root..'report-error');local desired=request('GET','/api/monitor/agent-settings?backendId='..tostring(backend));if desired then apply_settings(desired)end
  else atomic(root..'report-error','collector-unavailable')end
 end)
 if not ok then atomic(root..'report-error',tostring(err):sub(1,256))end
 -- Only one pending frame is retried; bounded RAM, no flash spool or fake history.
 if pending and os.time()*1000-pending.observedAt>120000 then pending=nil;atomic(root..'report-gap',tostring(os.time()))end
 collectgarbage('collect')
 -- Lightweight command polling; full traffic snapshots retain their normal cadence.
 local until_time=nixio.sysinfo().uptime+interval
 while nixio.sysinfo().uptime<until_time do
  nixio.nanosleep(math.min(5,math.max(1,until_time-nixio.sysinfo().uptime)))
  local desired=request('GET','/api/monitor/agent-settings?backendId='..tostring(backend))
  if desired then local applied,control_changed=pcall(apply_settings,desired);if not applied then atomic(root..'report-error','settings-failed')elseif control_changed then break end end
 end
end

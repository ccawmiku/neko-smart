#!/usr/bin/lua
local uci, fs, sys, util, json = require('luci.model.uci').cursor(), require 'nixio.fs', require 'luci.sys', require 'luci.util', require 'luci.jsonc'
local M = {}
local path='/usr/share/nftables.d/ruleset-post/90-neko-smart.nft'
local function write(pathname,content) fs.mkdirr(fs.dirname(pathname)); assert(fs.writefile(pathname,content));fs.chmod(pathname,'600') end
local function identifier(s) return type(s)=='string' and #s>0 and #s<=32 and s:match('^[%w_.:%-]+$') end
function M.wan(configured)
 configured=configured or uci:get('neko_smart','main','wan_interface') or 'auto'
 if configured~='auto' then assert(identifier(configured),'Invalid WAN interface');return configured end
 local data=util.ubus('network.interface.wan','status',{}) or {}
 local device=data.l3_device or data.device
 assert(identifier(device),'WAN interface unavailable; specify an interface')
 return device
end
function M.validate(data)
 if type(data)~='table' then return 'Configuration must be an object' end
 local allowed={monitor_enabled=1,dns_enabled=1,core_adapter=1,disable_offload=1,wan_interface=1,lan_interface=1,resolver_url=1,fallback_url=1,resolver_ips=1,fallback_ips=1,dns_port=1,watch_domain=1}
 for k,v in pairs(data)do if type(k)~='string' or not allowed[k] then return 'Unknown configuration key' end;if k~='lan_interface' and k~='watch_domain' and k~='resolver_ips' and k~='fallback_ips' and type(v)~='string' then return k..' must be a string' end end
 for _,k in ipairs({'lan_interface','watch_domain','resolver_ips','fallback_ips'})do if data[k]~=nil then if type(data[k])~='table' or #data[k]>64 then return k..' must be a bounded array' end;local n=0;for i,v in pairs(data[k])do n=n+1;if type(i)~='number' or i%1~=0 or i<1 or i>#data[k] or type(v)~='string' then return 'Invalid '..k..' array' end end;if n~=#data[k] then return 'Invalid array' end end end
 for _,key in ipairs({'monitor_enabled','dns_enabled','core_adapter','disable_offload'}) do if data[key] and data[key]~='0' and data[key]~='1' then return key..' must be 0 or 1' end end
 if data.wan_interface and data.wan_interface~='auto' and not identifier(data.wan_interface) then return 'Invalid WAN interface' end
 for _,item in ipairs(data.lan_interface or {}) do if not identifier(item) then return 'Invalid LAN interface' end end
 for _,key in ipairs({'resolver_url','fallback_url'}) do
  local url=data[key]
  if url and url~='' then
   local host=url:match('^https://%[([^%]]+)%]/[^%s]*$') or url:match('^https://([%w%.%-]+)/[^%s]*$')
   local types=require('luci.cbi.datatypes');local ips=data[key=='resolver_url' and 'resolver_ips' or 'fallback_ips'] or {}
   if not host or url:find('[%s%z@#]') or #url>2048 then return 'DNS endpoint must be an HTTPS URL without credentials, fragment or custom port' end
   if not types.ipaddr(host) then if not types.hostname(host) or #ips==0 then return 'Hostname endpoints require pinned bootstrap IPs' end end
   for _,ip in ipairs(ips)do if not types.ipaddr(ip) then return 'Invalid bootstrap IP' end end
  elseif key=='resolver_url' and data.dns_enabled=='1' then return 'Resolver URL required' end
 end
 local port=tonumber(data.dns_port or '53535');if not (data.dns_port or '53535'):match('^%d+$') or not port or port%1~=0 or port<1024 or port>65535 or port==53531 or port==53532 or port==53533 then return 'DNS listener port must be 1024–65535 and not 53531/53532/53533' end
 for _,domain in ipairs(data.watch_domain or {}) do if #domain>253 or not require('luci.cbi.datatypes').hostname(domain) then return 'Invalid watched domain' end end
 return nil
end
function M.settings()
 local data=uci:get_all('neko_smart','main') or {}
 data.lan_interface=type(data.lan_interface)=='table' and data.lan_interface or {data.lan_interface or 'br-lan'}
 data.watch_domain=type(data.watch_domain)=='table' and data.watch_domain or {}
 data.resolver_ips=type(data.resolver_ips)=='table' and data.resolver_ips or {}
 data.fallback_ips=type(data.fallback_ips)=='table' and data.fallback_ips or {}
 for k in pairs(data)do if k:sub(1,1)=='.' or k=='previous_offload' or k=='previous_hw_offload' or k=='interval' then data[k]=nil end end
 return data
end
-- Keep the native dnsmasq -> Mihomo Fake-IP path while the core serves DNS.
-- When it stops/fails, route clients to the independent encrypted resolver.
function M.route_port()
 local fallback=tonumber(uci:get('neko_smart','main','dns_port') or '53535')
 uci:unload('openclash')
 if uci:get('openclash','config','enable')~='1' or sys.call('pidof clash >/dev/null')~=0 then return fallback end
 local port=tonumber(uci:get('openclash','config','dns_port') or '7874')
 if not port or port<1 or port>65535 then return fallback end
 local socket=require('nixio').socket('inet','dgram');if not socket then return fallback end
 socket:setopt('socket','rcvtimeo',1)
 local id=math.random(1,65535);local function word(n)return string.char(math.floor(n/256)%256,n%256)end
 local name='neko-smart-health'
 local query=word(id)..'\1\0\0\1\0\0\0\0\0\0'..string.char(#name)..name..'\7example\3com\0\0\1\0\1'
 socket:connect('127.0.0.1',port);socket:send(query);local answer=socket:recv(4096);socket:close()
 if answer and #answer>=12 and answer:sub(1,2)==word(id) and answer:byte(3)>=128 and (answer:byte(4)%16==0 or answer:byte(4)%16==3) then return 53 end
 return fallback
end
function M.update_route(port)
 assert(port==53 or port==tonumber(uci:get('neko_smart','main','dns_port')or '53535'),'Invalid DNS route')
 local candidate='/var/run/neko-smart/privacy/route.nft'
 write(candidate,'delete element inet neko_smart dns_route { 53 }\nadd element inet neko_smart dns_route { 53 : '..port..' }\n')
 return sys.call('nft -f '..util.shellquote(candidate)..' >/dev/null 2>&1')==0
end
function M.apply()
 local cfg=M.settings();assert(not M.validate(cfg),M.validate(cfg))
 local port=tonumber(cfg.dns_port or '53535')
 local interfaces={};for _,device in ipairs(cfg.lan_interface)do interfaces[#interfaces+1]=util.shellquote(device):gsub("'",'"') end
 assert(#interfaces>0,'LAN interface required')
 local nft=table.concat({
  'add table inet neko_smart', 'flush table inet neko_smart',
  'table inet neko_smart {',
  ' map dns_route { type inet_service : inet_service; elements = { 53 : '..M.route_port()..' } }',
  ' chain dns_in { type nat hook prerouting priority -190; policy accept;',
  ' iifname { '..table.concat(interfaces,', ')..' } meta l4proto { tcp, udp } th dport 53 counter redirect to th dport map @dns_route',
  ' }',
  ' chain dns_local { type nat hook output priority -110; policy accept;',
  ' ip daddr 127.0.0.1 return', ' ip6 daddr ::1 return',
  ' meta l4proto { tcp, udp } th dport 53 counter redirect to :'..port,
  ' }',
  ' chain dns_out { type filter hook output priority 10; policy accept;',
  ' oifname != "lo" meta l4proto { tcp, udp } th dport 53 counter drop',
  ' }',
  ' chain dns_forward { type filter hook forward priority 10; policy accept;',
  ' meta l4proto { tcp, udp } th dport 53 counter drop',
  ' }','}'},'\n')..'\n'
 local candidate='/var/run/neko-smart/privacy/guard.nft';write(candidate,nft)
 assert(sys.call('nft -c -f '..util.shellquote(candidate)..' >/dev/null 2>&1')==0,'Firewall validation failed')
 assert(sys.call('nft -f '..util.shellquote(candidate)..' >/dev/null 2>&1')==0,'Firewall apply failed')
 write(path,nft)
 write('/var/run/neko-smart/privacy/dnsmasq.conf',table.concat({
  'port='..port,'no-resolv','no-poll','no-hosts','bind-dynamic','cache-size=512',
  'strict-order','server=127.0.0.1#53531',(cfg.fallback_url or '')~='' and 'server=127.0.0.1#53532' or '', 'server=/lan/127.0.0.1#53',
  'domain-needed','bogus-priv','log-facility=/dev/null'},'\n')..'\n')
 local dnsconf=fs.readfile('/var/run/neko-smart/privacy/dnsmasq.conf')or ''
 dnsconf=dnsconf..'interface=lo\n';for _,device in ipairs(cfg.lan_interface)do dnsconf=dnsconf..'interface='..device..'\n' end
 write('/var/run/neko-smart/privacy/dnsmasq.conf',dnsconf)
 local bootstrap={'port=53533','listen-address=127.0.0.1','bind-interfaces','no-resolv','no-hosts','cache-size=0','log-facility=/dev/null'}
 for _,entry in ipairs({{'resolver_url','resolver_ips'},{'fallback_url','fallback_ips'}})do
  local host=(cfg[entry[1]] or ''):match('^https://([%w%.%-]+)/')
  if host and not require('luci.cbi.datatypes').ipaddr(host) then bootstrap[#bootstrap+1]='local=/'..host..'/'
   for _,ip in ipairs(cfg[entry[2]])do bootstrap[#bootstrap+1]='address=/'..host..'/'..ip end
  end
 end
 write('/var/run/neko-smart/privacy/bootstrap.conf',table.concat(bootstrap,'\n')..'\n')
 return true
end
function M.disable() fs.unlink(path);sys.call('nft delete table inet neko_smart >/dev/null 2>&1') end
function M.firewall_status()
 local text=sys.exec('nft -j list table inet neko_smart 2>/dev/null')
 return text~='' and json.parse(text) or nil
end
function M.firewall_valid()
 local actual=M.firewall_status();if not actual or type(actual.nftables)~='table' then return false end
 -- Inspect each required hooked chain and its port/redirect/drop expressions.
 local chains,rules={},{}
 for _,obj in ipairs(actual.nftables)do if obj.chain then chains[obj.chain.name]=obj.chain elseif obj.rule then local r=obj.rule;rules[r.chain]=(rules[r.chain] or '')..json.stringify(r.expr) end end
 for name,hook in pairs({dns_in='prerouting',dns_local='output',dns_out='output',dns_forward='forward'})do
  if not chains[name] or chains[name].hook~=hook or not rules[name] or not rules[name]:find('53',1,true) then return false end
  if name=='dns_in' then if not rules[name]:find('redirect',1,true) or not rules[name]:find('dns_route',1,true) then return false end
  elseif name=='dns_local' then if not rules[name]:find('redirect',1,true) or not rules[name]:find(tostring(uci:get('neko_smart','main','dns_port')or '53535'),1,true) then return false end
  else
   -- jsonc discards JSON null values (including nft's {"drop":null}).
   local text=sys.exec('nft -s list chain inet neko_smart '..name..' 2>/dev/null')
   if not text:match('th dport 53 counter drop') then return false end
  end
 end
 for _,device in ipairs(M.settings().lan_interface)do if not rules.dns_in:find('"'..device..'"',1,true)then return false end end
 return true
end
local command=arg and arg[0] and arg[0]:match('/guard.lua$') and arg[1]
if command=='apply' then local ok,err=pcall(M.apply);if not ok then io.stderr:write(tostring(err)..'\n');os.exit(1) end
elseif command=='status' then if not M.firewall_valid()then os.exit(1)end;print('active')
elseif command=='disable' then M.disable()
elseif command=='wan' then local ok,value=pcall(M.wan);if ok then print(value) else io.stderr:write(tostring(value)..'\n');os.exit(1) end end
return M

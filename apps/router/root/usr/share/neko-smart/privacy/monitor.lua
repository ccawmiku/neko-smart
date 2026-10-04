-- Router flow metadata, optional core enrichment and independent DNS health.
-- No application payload, credentials or external IP-classification service.
local nixio,fs,json,uci=require 'nixio',require 'nixio.fs',require 'luci.jsonc',require('luci.model.uci').cursor()
local guard=dofile('/usr/share/neko-smart/privacy/guard.lua')
local analytics=dofile('/usr/share/neko-smart/privacy/analytics.lua')
local M={}
local route_cache={}
local domain_cache,trend={},{}
local root='/var/run/neko-smart/privacy/'
local function array(x)return type(x)=='table' and x or {} end
local function readjson(path,limit)
 local stat=fs.stat(path);if not stat or stat.size>(limit or 4*1024*1024) then return nil end
 return json.parse(fs.readfile(path) or '')
end
local function atomic(path,data)
 local encoded=json.stringify(data);assert(encoded and #encoded<8*1024*1024,'Snapshot too large')
 assert(fs.writefile(path..'.new',encoded));fs.chmod(path..'.new','600');assert(fs.rename(path..'.new',path))
end
local function key(network,src,dst,sport,dport)return table.concat({network or '',src or '',dst or '',tostring(sport or 0),tostring(dport or 0)},'|') end
local function canonical(address)
 if not address then return '' end
 local ip=require('luci.ip').new(address);return ip and ip:string():gsub('/%d+$','') or address
end
function M.parse_conntrack(line)
 local fields={};for name,value in line:gmatch('(%w+)=([^%s]+)')do fields[name]=fields[name] or {};fields[name][#fields[name]+1]=value end
 if not fields.src or not fields.dst then return nil end
 local family=line:match('ipv(%d)') or (fields.src[1]:find(':',1,true) and '6' or '4')
 local network=line:match('%s(tcp)%s') or line:match('%s(udp)%s') or 'other'
 return {source=canonical(fields.src[1]),destination=canonical(fields.dst[1]),source_port=tonumber(array(fields.sport)[1]) or 0,destination_port=tonumber(array(fields.dport)[1]) or 0,
  reply_source=canonical(fields.src[2]),reply_destination=canonical(fields.dst[2]),reply_sport=tonumber(array(fields.sport)[2]) or 0,reply_dport=tonumber(array(fields.dport)[2]) or 0,
  network=network,ip_version=tonumber(family),bytes=(tonumber(array(fields.bytes)[1]) or 0)+(tonumber(array(fields.bytes)[2]) or 0),state=line:match('%s(ESTABLISHED)%s') or line:match('%s(SYN_SENT)%s') or line:match('%s(UNREPLIED)%s') or 'tracked'}
end
local function core_connections()
 if uci:get('neko_smart','main','core_adapter')~='1' then return {},'disabled' end
 local port=tonumber(uci:get('openclash','config','cn_port')) or 9090
 local secret=uci:get('openclash','config','dashboard_password') or ''
 if port<1 or port>65535 or secret:find('[\r\n%z]') then return {},'invalid-configuration' end
 local socket=nixio.socket('inet','stream');if not socket then return {},'unavailable' end
 socket:setopt('socket','rcvtimeo',1);socket:setopt('socket','sndtimeo',1)
 if not socket:connect('127.0.0.1',port) then socket:close();return {},'offline' end
 local request='GET /connections HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAuthorization: Bearer '..secret..'\r\n\r\n'
 if not socket:send(request) then socket:close();return {},'unavailable' end
 local pieces,total={},0;local deadline=nixio.sysinfo().uptime+3
 while true do if nixio.sysinfo().uptime>deadline then socket:close();return {},'time-limit' end;local data=socket:recv(8192);if not data or #data==0 then break end;total=total+#data;if total>2*1024*1024 then socket:close();return {},'capacity-limit' end;pieces[#pieces+1]=data end
 socket:close();local response=table.concat(pieces);local headers,body=response:match('^(.-)\r\n\r\n(.*)$')
 if not headers or not headers:match('^HTTP/[%d%.]+ 200') then return {},'unavailable' end
 if headers:lower():find('transfer%-encoding:%s*chunked') then
  local chunks,pos={},1;while pos<=#body do local finish=body:find('\r\n',pos,true);if not finish then return {},'invalid-response' end;local len=tonumber(body:sub(pos,finish-1),16);if not len then return {},'invalid-response' end;if len==0 then break end;pos=finish+2;if pos+len-1>#body then return {},'invalid-response' end;chunks[#chunks+1]=body:sub(pos,pos+len-1);pos=pos+len+2 end;body=table.concat(chunks)
 end
 local data=json.parse(body);if not data then return {},'invalid-response' end
 local out={}
 for index,connection in ipairs(array(data.connections))do if index>8192 then return out,'capacity-limit' end
  local m=connection.metadata or {};local chains=array(connection.chains);local route=chains[1]=='DIRECT' and 'direct-reported' or chains[1]=='REJECT' and 'blocked-reported' or #chains>0 and 'proxy-reported' or 'unknown'
  local item={route=route,host=m.sniffHost~='' and m.sniffHost or m.host,chains=chains,rule=connection.rule,rule_payload=connection.rulePayload,destination_geoip=m.destinationGeoIP,target_ip=m.destinationIP,target_port=m.destinationPort,bytes=(tonumber(connection.upload)or 0)+(tonumber(connection.download)or 0)}
  item.site_region,item.site_region_evidence=analytics.classify(item)
  out[key(m.network,canonical(m.sourceIP),canonical(m.destinationIP),m.sourcePort,m.destinationPort)]=item
  -- Explicit HTTP/SOCKS clients connect to the router listener, not the final
  -- target. Correlate the exact inbound tuple reported by the standard API.
  if m.inboundIP and m.inboundPort then out[key(m.network,canonical(m.sourceIP),canonical(m.inboundIP),m.sourcePort,m.inboundPort)]=item end
 end
 return out,'available'
end
function M.dns_probe(port)
 local socket=nixio.socket('inet','dgram');if not socket then return false end;socket:setopt('socket','rcvtimeo',2)
 local id=math.random(1,65535);local label='rp-health-'..os.time()..'-'..id
 local function word(n)return string.char(math.floor(n/256)%256,n%256) end
 local query=word(id)..'\1\0\0\1\0\0\0\0\0\0'..string.char(#label)..label..'\7example\3com\0\0\1\0\1'
 socket:connect('127.0.0.1',port);socket:send(query);local answer=socket:recv(4096);socket:close()
 if not answer or #answer<12 or answer:sub(1,2)~=word(id) or answer:byte(3)<128 then return false end
 local code=answer:byte(4)%16;return code==0 or code==3
end
local iplib=require 'luci.ip';local local_prefixes={}
local address_cache,address_cache_count={},0
for _,cidr in ipairs({'10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','127.0.0.0/8','169.254.0.0/16','100.64.0.0/10','192.0.2.0/24','198.51.100.0/24','203.0.113.0/24','::1/128','fc00::/7','fe80::/10','2001:db8::/32'})do local_prefixes[#local_prefixes+1]=iplib.new(cidr)end
local function local_address(address)
 if not address then return true end
 if address_cache[address]~=nil then return address_cache[address] end
 local ip=iplib.new(address);local result=not ip
 if ip then for _,prefix in ipairs(local_prefixes)do if prefix:contains(ip)then result=true;break end end end
 -- Repeated LAN and server addresses dominate large connection tables. Cache
 -- only address locality, never website geography; keep RAM strictly bounded.
 if address_cache_count>=4096 then address_cache,address_cache_count={},0 end
 address_cache[address]=result;address_cache_count=address_cache_count+1
 return result
end
local function watched(domain,list)
 domain=(domain or ''):lower():gsub('%.$',''):gsub(':%d+$','')
 for _,name in ipairs(list)do name=name:lower():gsub('^%.','');if domain==name or domain:sub(-#name-1)=='.'..name then return true end end
 return false
end
local function process_state()
 local result=require('luci.util').ubus('service','list',{name='neko-smart'}) or {};return ((result['neko-smart'] or {}).instances or {})
end
function M.snapshot(previous_health)
 uci:unload('neko_smart');uci:unload('openclash')
 local cfg=guard.settings();local capture=cfg.monitor_enabled=='1' and readjson(root..'capture.json') or {flows={}};capture=capture or {flows={}};local fresh=capture.timestamp and os.time()-capture.timestamp<=15
 local core,core_state={},'disabled';if cfg.monitor_enabled=='1'then core,core_state=core_connections()end;local captured,wan={},{}
 local now=os.time();local active_domains={}
 for _,c in pairs(core)do if c.host and c.host~='' and c.site_region~='unknown' then local domain=c.host:lower():gsub('%.$','');local known=active_domains[domain];if known and known.site_region~=c.site_region then active_domains[domain]={site_region='unknown',site_region_evidence='conflicting-core-domain-evidence',time=now} else active_domains[domain]={site_region=c.site_region,site_region_evidence=c.site_region_evidence,time=now}end end end
 for domain,value in pairs(active_domains)do domain_cache[domain]=value end
 local domain_count=0;for domain,value in pairs(domain_cache)do domain_count=domain_count+1;if now-value.time>300 or domain_count>4096 then domain_cache[domain]=nil end end
 for _,f in ipairs(array(capture.flows))do
  f.source=canonical(f.source);f.destination=canonical(f.destination)
  local k=key(f.network,f.source,f.destination,f.source_port,f.destination_port)
  if f.vantage=='wan-egress' then wan[k]=f else captured[k]=f end
 end
 local out,seen={},{};local count=0;local ct=cfg.monitor_enabled=='1' and io.open('/proc/net/nf_conntrack','r') or nil
 if ct then for line in ct:lines()do count=count+1;if count>16384 then break end;local flow=M.parse_conntrack(line)
  if flow then
   local k=key(flow.network,flow.source,flow.destination,flow.source_port,flow.destination_port);local evidence=captured[k] or wan[k];local c=core[k]
   local direct=fresh and wan[key(flow.network,flow.reply_destination,flow.reply_source,flow.reply_dport,flow.reply_sport)]
   if direct then
    local wk=key(flow.network,flow.reply_destination,flow.reply_source,flow.reply_dport,flow.reply_sport);seen[wk]=true
    route_cache[wk]={first=direct.first,time=os.time(),source=flow.source,source_port=flow.source_port,route='direct-observed',domain=direct.domain,site_region=c and c.site_region,site_region_evidence=c and c.site_region_evidence,rule=c and c.rule,rule_payload=c and c.rule_payload}
   end
   flow.route=direct and 'direct-observed' or c and c.route or 'unknown';flow.route_evidence=direct and 'conntrack-reply-tuple+wan-packet' or c and 'mihomo-api' or 'not-observed'
   if direct and c and c.route=='proxy-reported' then flow.route='conflicting-evidence' end
   flow.domain=(evidence and evidence.domain~='' and evidence.domain) or (c and c.host) or (direct and direct.domain) or ''
   flow.protocol_evidence=(direct or evidence or {}).protocol_evidence or 'not-observed'
   flow.wan_sni_visible=direct and direct.protocol_evidence=='tls-clienthello' and direct.domain~='' or false
   flow.wan_plain_dns=direct and direct.protocol_evidence=='plaintext-dns' or false
   flow.ech_offered=(direct or evidence or {}).ech_offered or false
   flow.wan_protocol=direct and direct.protocol_evidence or nil;flow.wan_ech_offered=direct and direct.ech_offered or false;flow.wan_tls13_offered=direct and direct.tls13_offered or false
   flow.chains=c and c.chains or {};flow.rule=c and c.rule or '';flow.rule_payload=c and c.rule_payload or ''
   flow.site_region=c and c.site_region or 'unknown';flow.site_region_evidence=c and c.site_region_evidence or 'no-core-evidence';flow.core_destination=c and c.target_ip;flow.core_port=c and c.target_port
   flow.external_target=not not (direct or c and ((c.host and c.host~='') or not local_address(c.target_ip or flow.destination)) or not local_address(flow.destination))
   flow.watched_domain=watched(flow.domain,cfg.watch_domain);flow.watched_direct=flow.watched_domain and flow.route=='direct-observed'
   flow.vantage='conntrack';flow.id=k;seen[k]=true;out[#out+1]=flow
  end end;ct:close()end
 for _,f in ipairs(array(capture.flows))do local k=key(f.network,f.source,f.destination,f.source_port,f.destination_port)
  if not seen[k]then f.id=k..'|'..f.vantage;f.route=f.vantage=='wan-egress' and 'wan-egress-unattributed' or 'unknown';f.route_evidence='packet-only';f.wan_sni_visible=f.vantage=='wan-egress' and f.protocol_evidence=='tls-clienthello' and f.domain~='';f.wan_plain_dns=f.vantage=='wan-egress' and f.protocol_evidence=='plaintext-dns';f.watched_domain=watched(f.domain,cfg.watch_domain)
   f.site_region='unknown';f.site_region_evidence='no-core-evidence';f.external_target=not local_address(f.destination)
   f.wan_protocol=f.vantage=='wan-egress' and f.protocol_evidence or nil;f.wan_ech_offered=f.vantage=='wan-egress' and f.ech_offered or false;f.wan_tls13_offered=f.vantage=='wan-egress' and f.tls13_offered or false
   local retained=route_cache[k];if fresh and retained and retained.first==f.first and os.time()-retained.time<=300 then f.route=retained.route;f.route_evidence='retained-conntrack+wan-packet';f.source=retained.source;f.source_port=retained.source_port;f.watched_direct=f.watched_domain;f.site_region=retained.site_region or 'unknown';f.site_region_evidence=retained.site_region_evidence or 'no-core-evidence';f.rule=retained.rule;f.rule_payload=retained.rule_payload end
   out[#out+1]=f end
 end
 for _,f in ipairs(out)do
  if f.site_region=='unknown' and f.domain and f.domain~='' then local known=domain_cache[f.domain:lower():gsub('%.$','')];if known then f.site_region=known.site_region;f.site_region_evidence='retained-domain:'..known.site_region_evidence end end
  f.overseas_direct=f.site_region=='overseas' and f.protocol_evidence~='plaintext-dns' and (f.route=='direct-observed' or f.route=='direct-reported') or false
  f.overseas_sni=f.site_region=='overseas' and f.wan_sni_visible or false
  f.region=f.site_region;f.non_cn_direct=f.overseas_direct -- Compatibility aliases; both now use core evidence.
 end
 local wan_flows={};local management_records=0
 for _,f in pairs(wan)do
  -- On bridged lab/router interfaces local LuCI/SSH responses can also appear
  -- as outgoing packets. Keep them in the evidence table, not WAN privacy ratios.
  if local_address(f.destination) and (f.source_port==80 or f.source_port==443 or f.source_port==22) then management_records=management_records+1 else wan_flows[#wan_flows+1]=f end
 end
 local dashboard=analytics.aggregate(out,wan_flows,fresh)
 dashboard.excluded_management_records=management_records
 trend[#trend+1]={time=now,encrypted=fresh and dashboard.encryption.encrypted.count or json.null,plaintext=fresh and dashboard.encryption.plaintext.count or json.null,unknown=fresh and dashboard.encryption.unknown.count or json.null,sni=fresh and dashboard.sni.visible or json.null,dns=fresh and dashboard.dns.wan_plaintext or json.null};if #trend>60 then table.remove(trend,1)end
 dashboard.trend=trend
 local cache_count=0;for k,v in pairs(route_cache)do cache_count=cache_count+1;if os.time()-v.time>300 or cache_count>2048 then route_cache[k]=nil end end
 local metrics={flows=#out,conntrack_flows=count,proxy=0,direct=0,unknown=0,visible_sni=0,plaintext_dns=0,watched_direct=0,non_cn_direct=0,bytes=0}
 for _,f in ipairs(out)do local route=f.route;if route=='proxy-reported' then metrics.proxy=metrics.proxy+1 elseif route=='direct-observed' or route=='direct-reported' then metrics.direct=metrics.direct+1 else metrics.unknown=metrics.unknown+1 end
  if f.wan_sni_visible then metrics.visible_sni=metrics.visible_sni+1 end;if f.wan_plain_dns then metrics.plaintext_dns=metrics.plaintext_dns+1 end;if f.watched_direct then metrics.watched_direct=metrics.watched_direct+1 end;if f.non_cn_direct then metrics.non_cn_direct=metrics.non_cn_direct+1 end;metrics.bytes=metrics.bytes+(f.bytes or 0)
 end
 local health=previous_health or {checked_at=0};if cfg.dns_enabled=='1' and os.time()-health.checked_at>=60 then health={checked_at=os.time(),available=M.dns_probe(tonumber(cfg.dns_port) or 53535)}end
 local firewall=guard.firewall_valid();local instances=process_state();local dns_running=instances.dns and instances.dns.running or false
 local dns_route=readjson(root..'dns-route.json')
 local offload=uci:get('firewall','@defaults[0]','flow_offloading')=='1' or uci:get('firewall','@defaults[0]','flow_offloading_hw')=='1'
 table.sort(out,function(a,b)return (a.wan_plain_dns and 4 or a.watched_direct and 3 or a.wan_sni_visible and 2 or 0)>(b.wan_plain_dns and 4 or b.watched_direct and 3 or b.wan_sni_visible and 2 or 0)end)
 return {timestamp=os.time(),config=cfg,monitor={enabled=cfg.monitor_enabled=='1',capture_fresh=fresh or false,conntrack_available=ct~=nil,conntrack_capacity_limited=count>16384,offload_enabled=offload,capacity=capture.capacity or 2048,dropped_packets=capture.dropped_packets or 0,evicted_flows=capture.evicted_flows or 0,fragmented_packets=capture.fragmented_packets or 0,core=core_state,classification_source='mihomo-rule-and-destinationGeoIP'},dns={route=dns_route,enabled=cfg.dns_enabled=='1',firewall_installed=firewall,resolver_running=dns_running,health=health,fail_closed=firewall},metrics=metrics,dashboard=dashboard,flows=out},health
end
if arg and arg[0] and arg[0]:match('/monitor.lua$')then
 math.randomseed(os.time());local health
 while true do local ok,result,next_health=pcall(M.snapshot,health);if ok then health=next_health;atomic(root..'snapshot.json',result)else atomic(root..'snapshot.json',{timestamp=os.time(),error=tostring(result),metrics={},flows={}})end;collectgarbage('collect');nixio.nanosleep(5)end
end
return M

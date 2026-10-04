-- Evidence summaries only. Website geography comes from Mihomo, never routing
-- group names, DIRECT/PROXY, an independent domain list or an external lookup.
local M={}
function M.classify(core,providers)
 if type(core)~='table' then return 'unknown','no-core-evidence' end
 local rule=(core.rule or ''):lower();local payload=(core.rule_payload or ''):lower()
 if rule=='ruleset' and type(providers)=='table' then
  local region=providers[core.rule_payload]
  if region=='domestic' or region=='overseas' then return region,'mihomo-rule-provider:'..core.rule_payload end
 end
 if rule=='geosite' then
  if payload=='cn' or payload=='geolocation-cn' or payload=='geosite-cn' then return 'domestic','mihomo-rule:'..rule..':'..payload end
  if payload=='geolocation-!cn' or payload=='geosite-geolocation-!cn' then return 'overseas','mihomo-rule:'..rule..':'..payload end
 end
 if rule=='geoip' and payload~='' then
  if payload=='cn' then return 'domestic','mihomo-rule:geoip:cn' end
  if payload:match('^%a%a$') and payload~='zz' then return 'overseas','mihomo-rule:geoip:'..payload end
 end
 local countries=core.destination_geoip
 if type(countries)=='table' and #countries>0 then
  local cn,other=false,false
  for _,country in ipairs(countries)do country=tostring(country):upper();if country=='CN' then cn=true elseif country:match('^%a%a$') and country~='ZZ' then other=true end end
  if cn and not other then return 'domestic','mihomo-destinationGeoIP:CN' elseif other and not cn then return 'overseas','mihomo-destinationGeoIP' end
 end
 return 'unknown','core-without-geographic-evidence'
end
function M.encryption(protocol)
 if protocol=='tls-clienthello' then return 'encrypted' end
 if protocol=='plaintext-http' or protocol=='plaintext-dns' then return 'plaintext' end
 return 'unknown'
end
local function bucket()return {count=0,bytes=0}end
local function add(b,f)b.count=b.count+1;b.bytes=b.bytes+math.max(0,tonumber(f.bytes)or 0)end
function M.aggregate(flows,wan,fresh)
 local result={basis='wan-outbound-observed-records',inactivity_expiry_seconds=300,available=fresh and true or false,
  encryption={encrypted=bucket(),plaintext=bucket(),unknown=bucket()},protocols={},wan_total=bucket(),
  geography={domestic={count=0,direct=0,proxy=0,sni=0,plaintext_dns=0,lan_dns=0},overseas={count=0,direct=0,proxy=0,sni=0,plaintext_dns=0,lan_dns=0},unknown={count=0,direct=0,proxy=0,sni=0,plaintext_dns=0,lan_dns=0}},
  dns={wan_plaintext=0,lan_plaintext=0},sni={visible=0,overseas=0,domestic=0,unknown=0,ech_offered=0,tls13_offered=0},routes={proxy=0,direct=0,unknown=0,blocked=0,conflicting=0},risks={overseas_direct=0,plaintext_http=0}}
 for _,f in ipairs(wan or {})do
  local protocol=f.protocol_evidence or 'not-observed';local encrypted=M.encryption(protocol)
  add(result.wan_total,f);add(result.encryption[encrypted],f)
  result.protocols[protocol]=result.protocols[protocol] or bucket();add(result.protocols[protocol],f)
 end
 for _,f in ipairs(flows or {})do
  local geo=result.geography[f.site_region or 'unknown'] or result.geography.unknown
  -- Pure LAN/router-local records do not inflate website routing statistics.
  if f.external_target and f.protocol_evidence~='plaintext-dns' then
   geo.count=geo.count+1
   if f.route=='proxy-reported' then result.routes.proxy=result.routes.proxy+1;geo.proxy=geo.proxy+1
   elseif f.route=='direct-observed' or f.route=='direct-reported' then result.routes.direct=result.routes.direct+1;geo.direct=geo.direct+1;if f.site_region=='overseas' then result.risks.overseas_direct=result.risks.overseas_direct+1 end
   elseif f.route=='blocked-reported' then result.routes.blocked=result.routes.blocked+1
   elseif f.route=='conflicting-evidence' then result.routes.conflicting=result.routes.conflicting+1
   else result.routes.unknown=result.routes.unknown+1 end
  end
  if f.protocol_evidence=='plaintext-dns' and f.vantage=='conntrack' and not f.wan_plain_dns or f.protocol_evidence=='plaintext-dns' and f.vantage=='lan-ingress' then result.dns.lan_plaintext=result.dns.lan_plaintext+1;geo.lan_dns=geo.lan_dns+1 end
  if f.wan_plain_dns then result.dns.wan_plaintext=result.dns.wan_plaintext+1;geo.plaintext_dns=geo.plaintext_dns+1 end
  if f.wan_sni_visible then result.sni.visible=result.sni.visible+1;geo.sni=geo.sni+1;local k=f.site_region or 'unknown';result.sni[k]=(result.sni[k]or 0)+1 end
  if f.wan_ech_offered then result.sni.ech_offered=result.sni.ech_offered+1 end
  if f.wan_tls13_offered then result.sni.tls13_offered=result.sni.tls13_offered+1 end
  if f.wan_protocol=='plaintext-http' then result.risks.plaintext_http=result.risks.plaintext_http+1 end
 end
 return result
end
return M

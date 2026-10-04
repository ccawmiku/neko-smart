-- Two-second health routing; firewall changes are atomic. No changes to native
-- OpenClash UCI, dnsmasq configuration, subscriptions or generated YAML.
local guard=dofile('/usr/share/neko-smart/privacy/guard.lua')
local nixio,fs,json=require 'nixio',require 'nixio.fs',require 'luci.jsonc'
local current
while true do
 local port=guard.route_port()
 -- Retry every cycle: fw4 may have recreated the map from its saved include.
 local ok=guard.update_route(port)
 fs.writefile('/var/run/neko-smart/privacy/dns-route.json',json.stringify({port=port,path=port==53 and 'native-fake-ip' or 'independent-doh',applied=ok,timestamp=os.time()}))
 current=port
 nixio.nanosleep(2)
end

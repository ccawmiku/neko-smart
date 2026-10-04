-- IP ownership comes from router interfaces, never the RFC1918 address category.
local ip=require 'luci.ip'
local M={}
function M.context(statuses)
 local context={lan_prefixes={},router_addresses={}}
 for name,status in pairs(statuses or {})do
  for _,key in ipairs({'ipv4-address','ipv6-address'})do
   for _,entry in ipairs(status[key]or {})do
    if entry.address then
     context.router_addresses[#context.router_addresses+1]=entry.address
     if name=='lan' and entry.mask then context.lan_prefixes[#context.lan_prefixes+1]=entry.address..'/'..entry.mask end
    end
   end
  end
  for _,entry in ipairs(status['ipv6-prefix-assignment']or {})do
   local local_address=entry['local-address']
   if local_address and local_address.address then context.router_addresses[#context.router_addresses+1]=local_address.address end
   if name=='lan' and entry.address and entry.mask then context.lan_prefixes[#context.lan_prefixes+1]=entry.address..'/'..entry.mask end
  end
 end
 return context
end
function M.classify(address,context)
 local parsed=type(address)=='string' and ip.new(address)
 if not parsed then return 'unknown' end
 for _,own in ipairs(context.router_addresses or {})do
  local other=ip.new(own);if other and parsed:equal(other)then return 'router' end
 end
 for _,prefix in ipairs(context.lan_prefixes or {})do
  local subnet=ip.new(prefix);if subnet and subnet:contains(parsed)then return 'lan' end
 end
 return #(context.lan_prefixes or {})>0 and 'upstream' or 'unknown'
end
return M

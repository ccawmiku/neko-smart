-- Current configuration and snapshot age determine whether telemetry is live.
-- Keep settings delivery alive without presenting retained files as new observations.
local M={}
local function fresh(data,now,age)
 return type(data)=='table' and type(data.timestamp)=='number' and data.timestamp<=now and now-data.timestamp<=age
end
function M.current(privacy,nodes,config,nodes_enabled,now)
 local full=config.profile~='guard'
 local monitoring=full and config.monitor_enabled=='1'
 if not monitoring or not fresh(privacy,now,15) or type(privacy.monitor)~='table' then
  privacy={timestamp=now,config=config,flows={},monitor={enabled=monitoring,capture_fresh=false,conntrack_available=false,report_truncated_flows=0}}
 else
  privacy.config=config
  if type(privacy.flows)~='table' then privacy.flows={}end
  privacy.monitor.report_truncated_flows=math.max(0,#privacy.flows-2048)
  while #privacy.flows>2048 do table.remove(privacy.flows)end
 end
 -- The scheduler refreshes this timestamp independently of each node's probe interval.
 if not full or not nodes_enabled or not fresh(nodes,now,30) then nodes=nil end
 return privacy,nodes
end
return M

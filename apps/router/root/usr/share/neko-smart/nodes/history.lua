-- Compact bounded samples + seven days of hourly aggregates; no active polling here.
local M={}
function M.new(name,kind,now)return {name=name,type=kind,status='unknown',created=now,checked=0,ok=0,failed=0,unknown=0,streak=0,recoveries=0,samples={},hours={},events={}}end
local function bounded(list,n)while #list>n do table.remove(list,1)end end
function M.record(node,now,delay,error,keep,target)
 local success=type(delay)=='number' and delay>0 and delay<=120000
 local measured=success or error=='probe-failed';local previous=node.status
 node.checked=now;node.last_target=target;if success then node.last_error=nil else node.last_error=error end
 node.samples[#node.samples+1]={now,success and delay or -1,measured and (success and 1 or 0) or -1};bounded(node.samples,keep)
 if measured then
  if success then node.ok=node.ok+1;node.streak=0;node.status='up'
   if node.down_since then node.recoveries=node.recoveries+1;node.last_recovery=now;node.last_outage=now-node.down_since;node.down_since=nil end
  else node.failed=node.failed+1;node.streak=node.streak+1;node.status=node.streak>=2 and 'down' or 'degraded';if node.status=='down' and not node.down_since then node.down_since=now end end
 else node.unknown=node.unknown+1;node.status='unknown';node.streak=0 end
 if previous~=node.status then node.events[#node.events+1]={time=now,from=previous,to=node.status,reason=success and 'probe-ok' or error or 'monitor-unavailable'};bounded(node.events,64)end
 local stamp=math.floor(now/3600)*3600;local hour=node.hours[#node.hours]
 if not hour or hour[1]~=stamp then hour={stamp,0,0,0,0,0};node.hours[#node.hours+1]=hour end
 if success then hour[2]=hour[2]+1;hour[4]=hour[4]+delay;hour[5]=math.max(hour[5],delay)elseif measured then hour[3]=hour[3]+1 else hour[6]=hour[6]+1 end
 while #node.hours>0 and (node.hours[1][1]<stamp-167*3600 or #node.hours>168)do table.remove(node.hours,1)end
end
function M.summary(node)
 local sorted={};local ok,failed,unknown=0,0,0;local sum,jitter,last=0,0,nil;local gaps=0
 for _,s in ipairs(node.samples)do if s[3]==1 then ok=ok+1;sum=sum+s[2];sorted[#sorted+1]=s[2];if last then jitter=jitter+math.abs(last-s[2]);gaps=gaps+1 end;last=s[2]elseif s[3]==0 then failed=failed+1;last=nil else unknown=unknown+1;last=nil end end
 table.sort(sorted);local n=#sorted
 return {samples=#node.samples,measured=ok+failed,unknown=unknown,availability=ok+failed>0 and ok/(ok+failed)*100 or nil,median=n>0 and sorted[math.ceil(n/2)]or nil,p95=n>0 and sorted[math.ceil(n*.95)]or nil,min=n>0 and sorted[1]or nil,max=n>0 and sorted[n]or nil,mean=n>0 and sum/n or nil,jitter=gaps>0 and jitter/gaps or nil}
end
return M

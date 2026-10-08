local fs,nixio,json,uci=require 'nixio.fs',require 'nixio',require 'luci.jsonc',require('luci.model.uci').cursor()
local core=dofile('/usr/share/neko-smart/nodes/core.lua');local history=dofile('/usr/share/neko-smart/nodes/history.lua')
local ram='/var/run/neko-smart/nodes/history.json';local disk='/etc/neko-smart/nodes/history.json'
local function read(path)local s=fs.stat(path);if s and s.size<1024*1024 then return json.parse(fs.readfile(path)or '')end end
local db=read(ram)or read(disk)or {version=1,nodes={}};db.nodes=db.nodes or {};local boot=os.time();local inventory,inventory_time={},0;local checkpoint=boot;local last_write=0
-- Restored availability describes measured history, never the current live state.
for _,node in pairs(db.nodes)do node.status='unknown';node.streak=0;node.down_since=nil end
local function atomic(path,text)assert(fs.writefile(path..'.new',text));fs.chmod(path..'.new','600');assert(fs.rename(path..'.new',path))end
local function run()
 uci:unload('neko_smart');local cfg=uci:get_all('neko_smart','nodes')or {}
 local interval=math.max(30,math.min(3600,tonumber(cfg.interval)or 120));local timeout=math.max(500,math.min(10000,tonumber(cfg.timeout)or 3000));local max=math.max(1,math.min(64,tonumber(cfg.max_nodes)or 32));local keep=math.max(30,math.min(360,tonumber(cfg.keep_samples)or 120))
 local targets=type(cfg.targets)=='table' and cfg.targets or {cfg.targets or 'https://www.gstatic.com/generate_204'};local now=os.time()
 if now-inventory_time>=60 then
  local data,err=core.get('/proxies',2);db.core_state=data and 'available' or err;inventory_time=now
  if data and type(data.proxies)=='table' then inventory={};local total=0
   local builtin={Direct=true,Reject=true,Compatible=true,RejectDrop=true,Pass=true,PassRule=true,DNS=true}
   for name,node in pairs(data.proxies)do if type(node)=='table' and not node.all and not builtin[node.type] and #name<=256 then total=total+1;inventory[#inventory+1]={name=name,type=node.type}end end
   table.sort(inventory,function(a,b)return a.name<b.name end);db.discovered=total;db.capacity_limited=total>max;while #inventory>max do table.remove(inventory)end
   local names={};for _,item in ipairs(inventory)do names[item.name]=true;if not db.nodes[item.name]then db.nodes[item.name]=history.new(item.name,item.type,now)end;db.nodes[item.name].removed=false;db.nodes[item.name].type=item.type end
   -- Prune removed and builtin nodes immediately so deleted nodes do not linger or display.
   for name,node in pairs(db.nodes)do if builtin[node.type] or not names[name] then db.nodes[name]=nil end end
  end
 end
 local due
 local requested=read('/var/run/neko-smart/nodes/probe');fs.unlink('/var/run/neko-smart/nodes/probe')
 if requested and requested.time and now-requested.time<60 and db.nodes[requested.node] and not db.nodes[requested.node].removed then db.nodes[requested.node].checked=0 end
 for _,item in ipairs(inventory)do local node=db.nodes[item.name];if now-(node.checked or 0)>=interval and (not due or node.checked<due.checked)then due=node end end
 if due then
  if db.core_state~='available' then history.record(due,now,nil,'core-offline',keep,nil)
  else
   local delay,used;local inconclusive=false
   for i,target in ipairs(targets)do if i>2 then break end;used=target
    local result,err=core.get('/proxies/'..core.encode(due.name)..'/delay?timeout='..timeout..'&url='..core.encode(target),math.ceil(timeout/1000)+1)
    if result and tonumber(result.delay) and result.delay>0 then delay=result.delay;break end
    if err=='core-offline' or err=='401' or err=='403' or err=='response-capacity-limit' or err=='404' then inconclusive=true;break end
   end
   history.record(due,now,delay,inconclusive and 'monitor-unavailable' or 'probe-failed',keep,used)
  end
 end
 db.timestamp=os.time();db.boot=boot;db.interval=interval;db.timeout=timeout;db.keep_samples=keep;db.persistence=cfg.persistent=='1';db.last_checkpoint=checkpoint
 if now-last_write>=5 then local encoded=json.stringify(db);assert(#encoded<1024*1024,'History capacity limit');atomic(ram,encoded);last_write=now
  if cfg.persistent=='1' and now-checkpoint>=3600 then atomic(disk,encoded);checkpoint=now end
 end
end
while true do local ok,err=pcall(run);if not ok then fs.writefile('/var/run/neko-smart/nodes/error',tostring(err):sub(1,512))else fs.unlink('/var/run/neko-smart/nodes/error')end;collectgarbage('collect');nixio.nanosleep(1)end

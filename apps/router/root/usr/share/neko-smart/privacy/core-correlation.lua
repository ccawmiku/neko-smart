-- Match exact tuples, including the listener tuple recorded after REDIRECT/DNAT.
-- A source port alone is insufficient: different destinations may reuse it.
local M={}
function M.key(network,src,dst,sport,dport)
 return table.concat({network or '',src or '',dst or '',tostring(sport or 0),tostring(dport or 0)},'|')
end
function M.add(index,key,item)
 if index[key]==nil then index[key]=item elseif index[key]~=item then index[key]=false end
end
function M.match(index,flow)
 local item=index[M.key(flow.network,flow.source,flow.destination,flow.source_port,flow.destination_port)]
 if item~=nil then return item or nil,item and 'original-tuple' or 'ambiguous-tuple' end
 if flow.reply_source and (flow.reply_source~=flow.destination or flow.reply_sport~=flow.destination_port)then
  item=index[M.key(flow.network,flow.source,flow.reply_source,flow.source_port,flow.reply_sport)]
  if item and tostring(item.target_port)==tostring(flow.destination_port)then return item,'dnat-inbound-tuple' end
 end
 return nil,'unmatched'
end
return M

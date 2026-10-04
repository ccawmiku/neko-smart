-- Stable, local Mihomo REST boundary. Credentials stay on the router.
local nixio,json,uci=require 'nixio',require 'luci.jsonc',require('luci.model.uci').cursor()
local M={}
function M.encode(s)return (s:gsub('[^%w%-_%.~]',function(c)return string.format('%%%02X',c:byte())end))end
function M.get(path,timeout)
 uci:unload('neko_smart');uci:unload('openclash')
 local inherited=uci:get('neko_smart','nodes','use_openclash')~='0'
 local port=tonumber(inherited and uci:get('openclash','config','cn_port') or uci:get('neko_smart','nodes','api_port'))or 9090
 local secret=(inherited and uci:get('openclash','config','dashboard_password') or uci:get('neko_smart','nodes','api_secret'))or ''
 if port<1 or port>65535 or secret:find('[\r\n%z]') or path:find('[\r\n%z]')then return nil,'invalid-api-configuration' end
 local socket=nixio.socket('inet','stream');if not socket then return nil,'socket-unavailable' end
 socket:setopt('socket','rcvtimeo',timeout or 5);socket:setopt('socket','sndtimeo',timeout or 5)
 if not socket:connect('127.0.0.1',port)then socket:close();return nil,'core-offline' end
 local req='GET '..path..' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAuthorization: Bearer '..secret..'\r\n\r\n'
 if not socket:send(req)then socket:close();return nil,'send-failed' end
 local parts,size={},0
 while true do local part=socket:recv(8192);if not part or #part==0 then break end;size=size+#part;if size>1024*1024 then socket:close();return nil,'response-capacity-limit' end;parts[#parts+1]=part end
 socket:close();local head,body=table.concat(parts):match('^(.-)\r\n\r\n(.*)$')
 if not head then return nil,'invalid-response' end
 if not head:match('^HTTP/[%d%.]+ 200') then return nil,head:match('^HTTP/[%d%.]+ (%d+)') or 'request-failed' end
 if head:lower():find('transfer%-encoding:%s*chunked')then
  local chunks,pos={},1;while pos<=#body do local stop=body:find('\r\n',pos,true);if not stop then return nil,'incomplete-response' end;local len=tonumber(body:sub(pos,stop-1),16);if not len then return nil,'invalid-chunk' end;if len==0 then break end;pos=stop+2;if pos+len-1>#body then return nil,'incomplete-response' end;chunks[#chunks+1]=body:sub(pos,pos+len-1);pos=pos+len+2 end;body=table.concat(chunks)
 end
 local data=json.parse(body);return data,data and nil or 'invalid-json'
end
return M

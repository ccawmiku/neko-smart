local root=arg[1] or '/usr/share/neko-smart/privacy/'
local correlation=dofile(root..'core-correlation.lua')
local analytics=dofile(root..'analytics.lua')
local item={target_port='443'};local index={}
correlation.add(index,correlation.key('tcp','192.168.1.12','192.168.1.1',12345,7892),item)
local fake={network='tcp',source='192.168.1.12',source_port=12345,destination='198.18.0.5',destination_port=443,reply_source='192.168.1.1',reply_sport=7892}
local match,method=correlation.match(index,fake);assert(match==item and method=='dnat-inbound-tuple')
fake.source_port=12346;assert(not correlation.match(index,fake));fake.source_port=12345
fake.destination_port=80;assert(not correlation.match(index,fake));fake.destination_port=443
fake.reply_source='127.0.0.1';assert(not correlation.match(index,fake));fake.reply_source='192.168.1.1'
fake.network='udp';assert(not correlation.match(index,fake));fake.network='tcp'
correlation.add(index,correlation.key('tcp','192.168.1.12','192.168.1.1',12345,7892),{target_port='443'})
assert(not correlation.match(index,fake),'Ambiguous listeners must not select a target')
correlation.add(index,correlation.key('tcp','192.168.1.12','198.18.0.5',12345,443),item)
assert(correlation.match(index,fake)==item,'Exact tuple takes precedence')
local regions={ChinaRules='domestic',ForeignRules='overseas'}
assert(analytics.classify({rule='RuleSet',rule_payload='ChinaRules'},regions)=='domestic')
assert(analytics.classify({rule='RuleSet',rule_payload='ForeignRules'},regions)=='overseas')
assert(analytics.classify({rule='RuleSet',rule_payload='ForeignRules'})=='unknown')
assert(analytics.classify({rule='Match',rule_payload='',route='proxy-reported',chains={'Japan'}},regions)=='unknown')
assert(analytics.classify({rule='GeoIP',rule_payload='CN'})=='domestic')
assert(analytics.classify({rule='GeoSite',rule_payload='geolocation-!cn'})=='overseas')
assert(analytics.encryption('tls-incomplete')=='unknown')
assert(analytics.encryption('quic-uninspected')=='unknown')
print('Privacy tuple and classification checks passed')

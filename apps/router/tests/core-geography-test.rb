require ARGV.fetch(0, '/usr/share/neko-smart/privacy/core-geography')
def check(value)
  raise 'Provider classification failed' unless value
end
def provider(path, behavior = 'domain')
  { 'url' => "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/#{path}.mrs", 'behavior' => behavior }
end
check(CoreGeography.region(provider('geosite/geolocation-!cn')) == 'overseas')
check(CoreGeography.region(provider('geosite/category-ai-chat-!cn')) == 'overseas')
check(CoreGeography.region(provider('geosite/cn')) == 'domestic')
check(CoreGeography.region(provider('geoip/cn', 'ipcidr')) == 'domestic')
check(CoreGeography.region(provider('geosite/apple')).nil?)
check(CoreGeography.region(provider('geosite/cn', 'ipcidr')).nil?)
check(CoreGeography.region({ 'url' => 'https://example.com/geolocation-!cn.mrs', 'behavior' => 'domain' }).nil?)
check(CoreGeography.region(provider('geosite/cn').merge('url' => provider('geosite/cn')['url'] + '?alternative=1')).nil?)
check(CoreGeography.providers({ 'rule-providers' => { 'MisleadingForeignName' => provider('geosite/cn'), 'geolocation-cn' => provider('geosite/apple') } }) == { 'MisleadingForeignName' => 'domestic' })
check(CoreGeography.region(provider('geosite/cn').merge('url' => 'https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cn.mrs')) == 'domestic')
puts 'Trusted provider metadata checks passed'

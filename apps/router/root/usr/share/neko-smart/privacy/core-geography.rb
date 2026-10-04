# Geographic provider labels from the active Mihomo configuration. No lookups,
# independent lists, routing decisions or subscription credentials are exported.
require 'yaml'
module CoreGeography
  def self.region(provider)
    url = provider.fetch('url', '')
    return nil unless url.is_a?(String)
    # Exact official source paths also exclude credentials, custom ports and queries.
    path = url.match(%r{\Ahttps://github\.com/MetaCubeX/meta-rules-dat/raw/(?:refs/heads/)?meta/geo/(geosite|geoip)/([^/?#]+)\.(?:mrs|yaml|list)\z}) ||
           url.match(%r{\Ahttps://raw\.githubusercontent\.com/MetaCubeX/meta-rules-dat/meta/geo/(geosite|geoip)/([^/?#]+)\.(?:mrs|yaml|list)\z}) ||
           url.match(%r{\Ahttps://(?:cdn|fastly|testingcf)\.jsdelivr\.net/gh/MetaCubeX/meta-rules-dat@meta/geo/(geosite|geoip)/([^/?#]+)\.(?:mrs|yaml|list)\z})
    return nil unless path
    kind, category = path.captures
    return nil unless provider['behavior'] == (kind == 'geosite' ? 'domain' : 'ipcidr')
    if kind == 'geoip'
      return 'domestic' if category.downcase == 'cn'
      return 'overseas' if category.match?(/\A[a-z]{2}\z/i) && category.downcase != 'zz'
    else
      return 'overseas' if category == 'geolocation-!cn' || category.end_with?('-!cn')
      return 'domestic' if %w[cn geolocation-cn].include?(category) || category.end_with?('-cn')
    end
    nil
  rescue TypeError, NoMethodError
    nil
  end
  def self.providers(config)
    result = {}
    (config['rule-providers'] || {}).each do |name, provider|
      next unless provider.is_a?(Hash)
      region = self.region(provider)
      result[name] = region if region
    end
    result
  end
end
if $PROGRAM_NAME == __FILE__
  begin
    path = ARGV.fetch(0)
    raise 'Configuration too large' if File.size(path) > 4 * 1024 * 1024
    config = YAML.safe_load(File.read(path), permitted_classes: [], permitted_symbols: [], aliases: true)
    CoreGeography.providers(config || {}).each do |name, region|
      next unless name.is_a?(String) && name.bytesize <= 255 && !name.match?(/[\r\n\t]/)
      puts "#{name}\t#{region}"
    end
  rescue StandardError
    # Unsupported or invalid configuration leaves geography unclassified.
  end
end

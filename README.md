# neko-smart

基于 [Neko Master](https://github.com/foru17/neko-master) 的路由器监控扩展，把流量隐私、节点健康和设备带宽合并到一个产品。新增页面沿用原生 React、shadcn/ui、Recharts 和明暗主题，不嵌入原 OpenClash 监控页面。

## 功能

- 深度核心控制：迁入 MetaCubeXD 控制逻辑并提供原生策略组、实时连接、规则、Provider、日志与运行设置；共用亮色/暗色主题及后端选择，详见 [上游升级边界](docs/upstream-upgrades.zh.md)。

- 保留 Neko 原有代理流量、域名、设备、国家、规则与策略统计。
- 隐私与安全：WAN 加密/明文/未知比例、协议证据、国内外 DNS、可见 SNI、国外直连、连接详情与历史图表；明确采集丢包、容量限制、硬件卸载和分类缺失。
- 节点监控：逐节点历史延迟、P50/P95、抖动、采样成功率、状态时间条、故障/恢复事件、七天小时趋势与受限的手动复测。
- 路由器带宽：独立 conntrack 设备账本、IPv4/IPv6、上传/下载、接口速度、历史周期查询；代理关闭仍可运行。
- 独立监控设置：参数校验、路由器回读、应用状态、受限的版本化上报。
- 安全 DNS：阿里 DoH 主用、DNSPod DoH 备用，均不可用时不回退明文；代理/面板关闭不会撤销 DNS 防护。

## 架构

`apps/router` 是 neko-smart 自己维护的 OpenWrt 安装包，统一拥有抓包、DNS 防护、节点探测、带宽引擎与上报。旧 router-privacy、router-node-health、nlbwmon 服务只作为迁移来源，切换完成后停用。

`apps/collector/src/modules/monitor` 和对应 repository 管理认证、设置、快照、每分钟历史与账本周期；`apps/web/components/features/monitor` 提供原生页面；契约位于 `packages/shared/src/monitor.ts`。

监控数据作为 SQLite 控制/健康元数据保存，也适用于原代理统计使用 ClickHouse 的部署。不同来源字节数不相加，不重复累计快照。原 Go Agent 的协议与包名保持兼容。

## 本机运行

Node.js、pnpm 9.15.9：

```sh
pnpm install --frozen-lockfile
pnpm --filter @neko-master/shared build
pnpm --filter @neko-master/collector build
pnpm --filter @neko-master/web build
```

Windows 可通过 `tools/run-limited.ps1` 给整个进程树设置 CPU 和内存上限。`tools/run-center.ps1` 提供本机测试启动方式，Web 默认 18082、API 3001、WS 3002，数据库与日志位于忽略的 `.private`。该本机脚本按照用户当前要求关闭页面登录；正式容器部署使用原生访问控制设置。

```powershell
./tools/run-limited.ps1 -MemoryMiB 1536 -Command 'powershell -NoProfile -File tools/run-center.ps1'
```

容器从本仓库源码构建：`docker compose up -d --build`。Compose 限制 2 核/1536 MiB，默认禁止在线 GeoIP 查询。CI 只向本 fork 的 GHCR 发布，不向上游作者的镜像仓库推送。

## 路由器迁移

1. 使用目标 OpenWrt SDK 构建 `apps/router`，安装 `neko-smart-router`。默认功能关闭，不接管现有服务。
2. 运行 `lua tools/migrate-router.lua`：在路由器本地备份旧设置，复制节点历史和完整带宽周期账本。配置与凭证不得提交到公共仓库。
3. 在监控设置创建路由器连接，把 collector_url/backend_id/token 写入路由器 `/etc/config/neko_smart` 的 report 节，并启用 report。
4. 执行 `sh tools/cutover-router.sh`。它保存最后一份账本，验证新 DNS、抓包、历史、带宽和上报之后，停用旧三个服务；失败自动恢复。
5. OpenClash 保留代理与现代配置界面。原监控包和迁移备份暂时保留用于回滚，不再运行。

中心服务可以离线，路由器独立防护继续运行。上报只保留一个待重试快照，超时产生缺口，不在闪存无限排队。连接令牌单独限定 backend，页面免登录不等于采集接口匿名开放。公网中心必须用 HTTPS。

## 证据边界

页面表示已经观测到的证据，不能证明全部流量绝对安全。443 不等于确认加密；核心 sniffHost 不等于 WAN SNI；ECH 提议不等于成功隐藏；LAN DNS 不等于 WAN 泄露。未解析的 QUIC、丢包、硬件卸载、观察器中断保留未知。

国内外分类使用 Mihomo 实际规则和 destinationGeoIP，缺失或冲突为未知。默认 `GEOIP_ALLOW_ONLINE=0`；只有显式设为 1 才允许 Neko 原在线 GeoIP 查询及回退。历史账本能恢复累计设备用量，不能补造过去没有采集的实时速度曲线。

## 许可与上游升级

上游 Web/Collector 保持 MIT；迁入的路由器代码 GPL-3.0-or-later；vendored nlbwmon 为 ISC。详见 [NOTICE](NOTICE.md)、[扩展说明](docs/extended-monitoring.zh.md) 和 [上游原始文档](docs/upstream-README.md)。保留 upstream remote，新增功能集中在独立模块；上游升级仍需合并检查，不能承诺零维护。

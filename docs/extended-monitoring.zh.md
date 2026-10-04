# 合并监控实现与迁移说明

项目名称 neko-smart，fork 为 ccawmiku/neko-smart，上游基线 6f72cfd0db69e2952713f24a648812407fef1e78。该版本直接合并路由器采集源码及带宽引擎，不再使用旧监控服务的 API 作为运行依赖。

## 数据口径

Mihomo 统计仍由原 Collector 处理；隐私使用 WAN 抓包和连接证据；设备用量来自本项目独立 socket 的 conntrack 账本；接口速度来自内核接口计数器差值。四者不相加。

每分钟隐私历史为缓存记录快照，不能当作新增连接数。窗口里缺失采样保留空缺。节点统计是实际 HTTP/HTTPS 探测采样，不声称连续 uptime；延迟空缺不能补零。带宽历史周期按原始账本保留，上报每轮导入一个周期，最多 24 个。账本协议按端口定义，不能当作加密判定。

## 代码边界

- 路由器配置统一 `/etc/config/neko_smart`，服务 `neko-smart`，nft 表 `inet neko_smart`。
- 隐私、节点和带宽采集使用独立 procd 实例并降低调度优先级。Node/Next 监控中心可在路由器 Docker 运行，使用独立的 CPU、内存和日志限制，见 [路由器部署与实测](router-runtime.zh.md)。
- RAM 快照 `/var/run/neko-smart`；节点持久化 `/etc/neko-smart/nodes`；设备账本 `/var/lib/neko-smart/bandwidth`。
- 标准 Mihomo API 是唯一代理核心接口；不修改核心或 metacubexd。
- 每个路由器连接使用 32 字节随机令牌，服务端只存 SHA256；上报 bootId/sequence 去重，旧时间报告不能覆盖新状态。
- 原 Agent payload 保持不变，新监控协议版本为 1。
- monitor_latest/monitor_history/monitor_ledgers 为 SQLite 控制数据，原 traffic writer 与 ClickHouse 路由保持原口径。
- 数据清理、backend 删除和连接令牌轮换均有对应测试。

## 切换与回滚

先 prepare 保存旧 UCI、节点历史、完整周期账本；旧模块仍运行。cutover 提交旧账本后停止旧三个守护程序，等待原带宽进程实际退出后再复制最后的文件，启动新程序。只有收到新上报、抓包新鲜、DNS 解析成功且防火墙有效时才完成切换。

任一步失败恢复旧服务；删除新 DNS 表之前必须确认旧防护规则有效。迁移不删除 OpenClash 订阅、节点、策略、配置文件和原代理服务。旧安装包与路由器本地备份保留用于回滚，默认不再启动。

## 资源与限制

Windows 中心测试进程树 CPU 限制 12.5% 宿主、1536 MiB 内存；生产构建需要独立的 2560 MiB 有限预算，不能用构建预算代替运行测量。OpenWrt 实验机 2 vCPU / 1024 MiB。尚未完成相同业务负载的长期吞吐/CPU 对照，不能宣称合并后已提升性能。

每份快照、流详情、节点数、探测样本、账本记录和数据库查询都有容量限制；达到容量时显示限制。在线 GeoIP 默认关闭，本地库缺失保留未知，不发送目标 IP 给第三方。

## 来源

[Neko Master](https://github.com/foru17/neko-master)、[nlbwmon](https://github.com/jow-/nlbwmon)、[LuCI 带宽页面](https://github.com/openwrt/luci/blob/master/applications/luci-app-nlbwmon/htdocs/luci-static/resources/view/nlbw/display.js)。许可见 NOTICE。验证结果以实际检查日志为准，不以示例数据代替真实采集。

## 首次迁移验收（2026-10-04，r6）

路由器安装 neko-smart-router 0.1.0-r6；三个旧监控服务已停止并禁用开机启动，OpenClash 核心仍运行。原 OpenClash UCI 和两个配置文件的 SHA256 与迁移前相同。7 个节点历史已恢复，完整带宽周期账本与原文件校验值一致，新采集包含设备/协议账本记录。DoH 解析、nft 防护、抓包新鲜度与中心上报均已核验。

Collector 12 个测试文件、75 项测试通过，生产 Web 构建及类型检查通过，前后端 API 路由审计缺失为 0；Lua 与 Shell 语法检查、C 包解析测试通过。全量前端 lint 存在上游既有错误，新增监控组件 lint 通过，未将全量 lint 描述为通过。

新节点页面支持受限的手动复测（每 30 秒一次），命令绑定已有节点并有五分钟有效期。历史账本查询使用选中周期，不把最新周期数据伪装成历史。真实路由器未给所有目标提供可用的国内外分类，这些连接保留未知，并在页面显示缺口。

路由器包使用与设备匹配的 SDK（本次为 OpenWrt 24.10.6 x86_64）：将 `apps/router` 复制到 SDK 的 `package/neko-smart-router`，在 `.config` 中启用 `CONFIG_PACKAGE_neko-smart-router=y`，准备 libubox/libnl-tiny/zlib 依赖后执行 `make -j1 package/neko-smart-router/compile V=s`。只安装此包，不能将 SDK 生成的其他内核模块一起覆盖到设备。

页面验收覆盖四个新页面、浅色/深色主题、1440px 桌面与 390px 手机宽度：无页面 JavaScript 错误、无整页横向溢出，中英文入口可用。路由器确认了一次真实手动复测，节点探测时间前进；当前账本可读取 134 条设备/协议记录。

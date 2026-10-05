# 路由器 DNS 与校园认证排查（2026-10-05）

已确认的 DNS 故障来自原生防护服务：`flush table` 保留了命名映射，随后再次声明 `dns_route` 的已有元素会使 nft 检查报 `File exists`。fw4 在启动时恢复了重定向规则，而原生服务启动失败，导致请求被送往没有监听的 DNS 端口。

修复使用单次 nft 事务中的 `destroy table` 和重新创建表。整个事务检查通过后才提交，支持首次启动、已有表、服务重新加载以及 fw4 重新加载。目标固件使用 nftables 1.1.1。

验证包括独立测试表连续加载三次、生产防护连续应用、fw4 配置检查、路由器域名解析、两条 DoH 上游健康检查和 LAN 访问。测试脚本为 `apps/router/tests/guard-idempotency-test.sh`。

校园认证另有一个独立问题：认证服务器位于 CGNAT 地址段，Tailscale 的反伪造输入规则丢弃了从 WAN 到达的 TCP 回包。抓包显示 SYN-ACK 已到达 WAN，却未完成握手。认证程序增加仅针对配置中的认证 IP、认证网卡、HTTP 源端口和 established/related 回包的例外；保留其余反伪造规则。真实客户端 User-Agent 请求恢复 HTTP 200，并获得有效登录表单。已有会话在线状态、DNS 解析和网站 HTTPS 访问均已确认；没有主动注销已有校园认证会话。

凌晨高负载期间，Beszel 记录的 neko-smart 容器 CPU 通常为 0.4%～2.8%，系统 CPU 显著更高。NAS 到 Telegram 的部分流量进入 DIRECT，并存在大量断线重连。现有记录不足以精确分摊重启前各原生进程的 CPU，不能据此排除原生监控和内核转发开销，也不能把所有网卡流量都解释为成功传输的应用数据。每日 05:00 的网络重启任务已备份并取消，周三系统重启任务保留。

## 原生组件更新

OpenWrt SDK 会生成外层 `prerm`，`Package/.../prerm` 实际生成 `prerm-pkg`，不能把 `default_prerm` 再放进该钩子。外层脚本也没有自动尊重 `IPKG_NO_SCRIPT`。

从旧版更新时使用：

```sh
sh tools/upgrade-router.sh /tmp/neko-smart-router_0.1.0-r11_x86_64.ipk
```

该脚本在安装前后补齐外层脚本的跳过条件，再暂存原生文件。普通安装的 postinst 钩子也补齐条件。暂存文件不会自动替换已经运行的 Lua 进程；按改动范围选择必要的服务重新加载。安装 r11 时已核对 DNS 与监控全部实例 PID 不变、原有 OpenClash/YAML、监控设置和认证设置不变。

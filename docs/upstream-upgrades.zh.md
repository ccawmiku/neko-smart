# 上游升级边界

MetaCubeXD 基线为 1.273.1 / 8bbc8f58fef71148a94fb5c0ff808f79b057337d；Neko Master 基线为 6f72cfd。MetaCubeXD 当前使用 Vue/Nuxt，neko-smart 使用 React。运行时只加载一个应用和一套主题，不复制其整套 UI 或使用 iframe。

## 导入与自有代码

`packages/shared/src/metacubexd/client.ts` 迁入上游的策略组、节点延迟、Provider 和规则控制函数。唯一框架适配是把 Vue 隐式 `useRequest()` 换成显式 `RequestTransport` 注入；接口名称、URL 编码和超时逻辑保留。完整来源、版本、函数清单与许可证分别保存在同目录 upstream.json 和 LICENSE。类型通过共享的框架无关记录表示，未知字段保留兼容，业务判断显式校验。

`apps/collector/src/modules/core-control` 拥有后台认证、已配置后端寻址、连接和日志传输、响应限制、操作并发限制与设置白名单。控制器不接收任意地址/接口路径，不把控制器密钥发送到新页面。日志按需开启、200 条环形缓存、30 秒未访问释放，不占用永久采集进程。

`apps/web/components/features/core-control` 拥有统一界面、搜索、状态和确认弹窗。它与原统计及新监控共用 backendId、React Query、next-intl、shadcn/ui 和明暗主题 token。新查询按 backendId 隔离；只轮询当前子页，尊重自动刷新开关。核心当前连接和历史流量不重复累计。

Neko 原有文件中的接入仅包括：app.ts 注册控制器、导航添加入口、TabId 增加一项、Content 增加一个分支、api.ts/query keys 增加公开客户端。升级时先保留这几个接入点，再独立验证功能模块；无需移植 MetaCube 的 Vue 主题系统。

## 更新流程

1. 执行 `node tools/check-upstreams.mjs`，只查看两边最新提交以及已导入函数是否仍存在，不自动覆盖源码。
2. 在独立分支 merge Neko upstream；审查上述接入点和共享 backend/auth 契约。
3. 对比 MetaCube upstream.json 中基线与目标的 useApi.ts；只迁移实际变化的控制逻辑，并同步基线、来源 hash、许可证。不要下载网页后直接覆盖本产品。
4. 运行 shared build、Collector 类型检查及测试、API 路由审计、Web 生产构建。核验未知字段、404/405 功能不支持、204 空响应、URI 编码、多后端隔离和无效参数拦截。
5. 验证每个子页在亮色/暗色与手机/桌面下的加载、空数据、错误及正常状态。先验证只读操作；连接关闭、规则切换等破坏当前访问的操作用模拟核心测试。

## 支持范围

本版整合远程 Mihomo 控制：策略组选择/取消固定、节点延迟、实时连接关闭、规则查看/可用时禁用、两类 Provider 更新、代理 Provider 健康检查、实时日志、模式/日志级别/IPv6/LAN 运行设置、DNS/Fake-IP 缓存清理。内核不支持的接口返回明确失败，不伪造成功。

MetaCube 的桌面进程管理、系统代理、内置内核升级和其专用 Agent 配置文件管理不接管本路由器，现有 OpenClash 继续管理持久配置和内核。页面说明运行设置的持久化边界。原版面板仍可独立更新；本产品从标准接口和少量有来源的控制函数兼容升级，而非依赖它的 DOM 或主题 class。无法承诺任何未来版本都零修改。

## 本次验收（2026-10-04）

13 个 Collector 测试文件、83 项测试通过。Shared、Collector、Web 编译与类型检查通过，新增组件和服务 lint 通过，API 路由审计缺失为 0。真实 Mihomo 的八类只读资源均返回 200，一次原生节点延迟测试返回实际耗时。六个子页在桌面/手机、亮色/暗色下无页面 JavaScript 错误及整页横向溢出，中英文入口可用。原设置和代理运行未被改写；路由器采集包无须更新。

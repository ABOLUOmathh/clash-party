# 2.0.5-custom.1

## 官方 2.0.5 同步与自定义组件更新

- 基于官方 Clash Party 2.0.5，同步其本地配置重构（简易模式合并进本地配置、以 YAML 格式保存）、MCP 服务、Tailscale 认证通知、可信订阅别名配置等全量新特性与修复
- 保留 Clash Party Custom 独立应用身份、更新通道、Custom Mihomo 持久运行时与 Custom Sub-Store 运行时
- 内置 Mihomo 更新至最新正式版 `v1.19.34-custom.1`
- Fresh install 与内置重装的 Sub-Store 后端统一升级至最新正式版 `2.44.23-custom.1`
- 完整保留 HeySocks VLESS e/h、OneSocks、HeySocks XHTTP、BLACKSTONE SS-2022、SOCKS5-over-WebSocket 与 Custom Mihomo 升级保护

# 2.0.5

## 新功能

- 简易模式合并到本地配置，支持直接以 Mihomo YAML 保存配置，并新增本地配置重新加载按钮
- 新增 MCP 服务，支持配置端口及访问令牌
- 订阅支持自定义主页，导入时自动填充订阅信息，并支持选择代理组
- 新增 Tailscale 节点认证通知，可点击通知打开认证链接
- 新增 InternetData 网络 IP 信息查询源
- 支持配置可信订阅的 YAML 别名解析上限
- 新增 Linux 便携 tarball 压缩包

## 优化

- 切换到本地配置时增加 DNS 覆写确认提示
- 订阅到期日期跟随系统区域格式显示
- 调整应用会话缓存位置，统一存放到缓存目录
- 点击标题栏时自动收起已打开的菜单

## 修复

- 修复本地配置未正确继承受控设置、受控设置优先级及出站模式保留问题
- 修复标准资源中代理集合缺失，以及更新代理集合后代理组未刷新的问题
- 修复关闭 use-hosts 后仍保留 hosts 覆写的问题
- 修复未加引号的 REALITY short-id 被错误解析为数字的问题
- 修复 macOS 启动时 DNS 保护未刷新，以及内核已有权限时重复授权失败的问题
- 修复 Windows 管理员重启时授权提示异常及取消授权后应用退出的问题
- 修复 Windows 管理员权限检测超时后错误缓存结果的问题
- 修复 Windows 内核清理可能影响其他程序或其他用户会话中内核进程的问题
- 修复旧版 Windows 开机启动任务提示文件不存在的问题
- 修复 Windows 轻量模式下关机后系统代理未关闭的问题
- 修复 Windows 绝对资源路径识别及准备脚本路径包含空格时的问题

## 安全

- 限制外部链接可打开的协议
- 避免原始错误日志泄露订阅令牌

## 其他

- 更新依赖

# 2.0.3-custom.1

## 官方 2.0.3 同步与自定义组件更新

- 基于官方 Clash Party 2.0.3，同步其新功能、性能优化与修复
- 保留 Clash Party Custom 独立应用身份、更新通道、Custom Mihomo 持久运行时与 Custom Sub-Store 运行时
- 内置 Mihomo 更新至 `v1.19.31-custom.1`
- Fresh install 与内置重装的 Sub-Store 后端统一至 `2.41.0-custom.1`
- 修复 Custom Mihomo 运行时状态 IPC 在 preload 白名单中的缺失
- Custom tag 与官方构建工作流隔离，避免自定义发布误触发上游 release workflow
- 保留 HeySocks VLESS e/h、OneSocks、HeySocks XHTTP、BLACKSTONE、SOCKS5-over-WebSocket 与 Custom Mihomo 升级保护

# 2.0.3

## 新功能

- 新增 Smart 内核模型管理与下载功能，支持模型状态展示
- 规则配置新增 Smart 规则类型，支持单独设置规则模型
- DNS 设置新增防覆写保护选项
- TUN 设置新增支持 MIPS 堆栈选项
- 新增开机静默启动设置，仅在托盘区保留图标
- 新增全局快捷键设置，支持呼出界面、切换系统代理与 TUN
- 新增系统托盘图标颜色与尺寸设置

## 性能优化

- 重写并优化拓扑测试模块，降低内存占用并提高稳定性
- 优化配置生成性能，重构覆写逻辑并提高覆写安全性
- 优化 macOS 应用匹配逻辑，提升规则执行准确性
- 优化网络列表及规则集列表渲染性能
- 优化连接识别逻辑，提升连接识别率与稳定性

## 修复

- 修复 Smart 内核覆写在配置加载时可能被移除的问题
- 修复 Smart 内核在连接中断或网络切换时无法正确选择节点的问题
- 修复系统代理、开机启动等状态与系统不同步的问题
- 修复 macOS 权限缺失导致核心无法启动时未提示授权的问题
- 修复 macOS 在内核崩溃或退出时可能残留孤儿进程的问题
- 修复 Sub-Store 兜底页面在特定路径下无法访问的问题
- 修复订阅配置含多余空格时可能导致崩溃的问题
- 修复订阅配置包含部分节点时配置合并可能导致崩溃的问题
- 修复规则项中包含特殊字符可能导致界面崩溃的问题
- 修复 Linux 特定环境下系统代理无法启用的问题
- 修复 macOS 11 系统下窗口关闭按钮可能失效的问题
- 修复网络拓扑界面在浅色主题下无法看清文字的问题
- 修复部分 Emoji 字体加载失败的问题

## 其他

- 重写流量统计存储并自动迁移历史数据
- CI 新增格式、lint、类型检查及单元测试
- 更新机场服务端对接指南，并移除 `https-proxy-agent` 依赖

# 2.0.2-custom.10

## HeySocks VLESS e/h 与自定义组件同步

- 内置 Mihomo 更新至 `v1.19.30-custom.6`
- Fresh install 与内置重装的 Sub-Store 后端统一至 `2.37.0-custom.5`
- Sub-Store 支持 HeySocks VLESS 自定义 `e` / `h` 参数的 URI 解析、保留与 Mihomo 配置输出
- Mihomo custom.6 增加对应的 HeySocks VLESS `e` / `h` 线协议兼容
- 使用真实 HeySocks VLESS 节点完成 REALITY + Vision A/B 联网验证
- 保留 OneSocks、HeySocks XHTTP、BLACKSTONE、SOCKS5-over-WebSocket 与 Custom Mihomo 升级保护

# 2.0.2-custom.9

## OneSocks 与自定义组件同步

- 内置 Mihomo 更新至 `v1.19.30-custom.5`
- Fresh install 与内置重装的 Sub-Store 后端统一至 `2.37.0-custom.4`
- Sub-Store 支持 OneSocks `os://` 分享链接解析以及 Mihomo `type: os` 节点保留与输出
- 使用真实 OneSocks 节点完成 Sub-Store → Clash Party → Mihomo 实际联网验证，当前验证配置启用了 UOT
- 修复 macOS PKG postinstall 对 `Clash Party Custom.app` 的安装路径解析
- 保留 HeySocks XHTTP、BLACKSTONE、SOCKS5-over-WebSocket 与 Custom Mihomo 升级保护

# 2.0.2-custom.6

## Custom Mihomo 运行时版本与组件同步

- 修复 Custom Mihomo 指定版本运行时下载安装，资产名称与 `ABOLUOmathh/mihomo` Releases 保持一致
- 支持在 Clash Party 内选择并安装 Custom Mihomo Release 版本
- 内置 Mihomo 保持 `v1.19.30-custom.4`
- Custom Sub-Store 更新至 `2.37.0-custom.3`
- 包含 Trojan URI fragment 名称保留与 Taiwan 国旗识别修复
- 保留 HeySocks XHTTP、BLACKSTONE 与既有 Custom 内核兼容能力

# 2.0.2-custom.5

## 自定义组件同步

- 内置 Mihomo 更新至 `v1.19.30-custom.4`
- 支持 HeySocks XHTTP `e: true` 实际节点配置
- 保留 HeySocks XHTTP TCP 与 UOT v0/v1/v2 支持
- Custom Sub-Store 更新至 `2.37.0-custom.2`
- Sub-Store 支持 HeySocks XHTTP 分享链接解析与 Mihomo 配置输出
- 保留 BLACKSTONE、SOCKS5-over-WebSocket 与 Custom 内核升级保护

# 2.0.2-custom.4

## 自定义内核同步

- 内置 Mihomo 更新至 `v1.19.30-custom.2`
- 保留 SOCKS5-over-WebSocket 传输支持
- 增加 BLACKSTONE Shadowsocks 2022 兼容支持
- 支持 BLACKSTONE UDP-over-TCP（UOT legacy v1）
- 支持 BLACKSTONE full-base64 `ss://` 分享链接导入
- 自定义 Mihomo 版本列表使用 `ABOLUOmathh/mihomo` Releases
- 自定义内核升级时避免调用上游 `/upgrade` 路径覆盖 Custom Mihomo
- 保留 Custom Sub-Store 集成

# 2.0.2

## 修复 (Fix)

- 修复数字小键盘的加、减、乘、除及小数点按键无法正确注册为全局快捷键的问题
- 修复首次使用欢迎引导中的提示弹层位置配置无效、可能显示异常的问题
- 修复 Linux ARM64 等交叉编译产物可能混入宿主机架构系统代理模块的问题，并增加原生模块架构校验
- 修复 Linux 无法注册托盘图标的问题

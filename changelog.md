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

- 新增订阅 DNS 覆写保护，避免意外覆盖自定义解析配置
- Smart 内核新增模型状态、手动下载及自动更新设置
- 支持按 WiFi SSID 自动切换订阅，macOS 使用事件驱动检测
- 新增自定义 GitHub 下载代理和覆写全局开关快捷入口
- 机场插件支持多网关、备用发现源、签名发现文档、网关说明及网络请求自动回退

## 性能优化

- 优化应用启动流程，首屏完成后再执行其余初始化
- 合并连接列表高频更新，页面不可见时暂停处理
- 修复连接页面、IPC 监听器及 Monaco 编辑器相关资源泄漏

## 修复

- 修复恶意 `rule-providers` 配置可能执行任意命令的安全问题
- 修复内核下载校验、解压失败及 macOS 路径含空格时的权限问题
- 修复 Smart 组生成、设置热重载及模型重复下载问题
- 修复 PAC、Gist、悬浮窗、覆写拖拽与并发读写等稳定性问题
- 修复规则编辑器、WebDAV、流量表格及配置读写问题
- 修复系统唤醒后内核、TUN 或系统代理失效，以及内核启动失败提示异常的问题
- 修复 macOS 开机自启、内核残留、托盘状态及安装包公证票据问题
- 修复 Windows WiFi 权限频繁请求、ARM64 安装包及 Windows 8/8.1 系统代理兼容问题
- 修复代理组搜索中文输入中断、TUN 重复重建及代理列表高度异常问题
- 修复订阅流量大数值解析、Sub-Store 回退路径及 Emoji 字体下载问题
- 提升机场插件的订阅校验、自动更新、设备回收、凭据保护、超时和并发安全性

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

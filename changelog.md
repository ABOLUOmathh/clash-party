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

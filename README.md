# SZXmusic v0.2.0

基于 Tauri 2 + Rust + React/TypeScript 的 Windows 桌面 B 站音源液态玻璃音乐播放器与黑胶唱片库。

## 主要特性

- 磨砂玻璃唱片箱 + 液体主题切换（Liquid Theme Reveal）+ Web Audio 合成水声
- B 站扫码登录（Windows DPAPI 本地加密存储）+ 收藏夹增量同步（不向 B 站上报播放历史）
- 多 P / 合集视频严格按分 P 顺序连播，分 P 列表标题清洗、规则重算修复与展示
- 楷体「字 / 弹」分离视图：字幕优先读取视频原字幕，其次对齐歌名/歌手/时长检索歌词；弹幕支持 B 站 `seg.so` 实时分片解析与 XML 回退
- 正则解析器调试面板折叠与反馈自动清理
- 桌面壁纸层固定小部件（`HWND_BOTTOM` 嵌入桌面壁纸层，支持三档尺寸与四角停靠）
- Windows 用户级注册表集成（`HKCU` `App Paths`、`Capabilities`、`szxmusic://` URL 协议与开机自启）

## 本地开发与构建

前置依赖：Node.js、Rust（见 `rust-toolchain.toml`）、Windows MSVC 工具链与 WebView2 Runtime；构建安装包需安装 NSIS。

```bash
npm install
npm run dev            # 仅前端开发预览
npm run tauri build    # 构建生产前端、Rust Release 可执行文件与 NSIS 安装包
```

运行 Rust 工作区测试：

```bash
cargo test --workspace --manifest-path src-tauri/Cargo.toml
```

## 发行包结构（v0.2.0）

- `SZXmusic_0.2.0_x64-setup.exe`：Windows x64 NSIS 安装程序
- `SZXmusic-v0.2.0-win-x64-portable.zip`：绿色便携压缩包（包含 `SZXmusic.exe`、`WebView2Loader.dll`、`rules/default.toml` 与 `README-v0.2.txt`）
- `SHA256SUMS.txt`：安装包与便携版文件的 SHA-256 校验值

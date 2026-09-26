# osu!lyrics

给 osu!lazer 用的 Windows 悬浮歌词工具。它在游戏外运行，通过本机的 [tosu](https://github.com/tosuapp/tosu) 读取当前谱面与播放位置，不修改游戏，也不复制 osu! 源码。

![osu!lyrics 在 osu!lazer 旁显示冰蓝色样的歌词与控制面板](docs/osu-lyrics-window.png)

## 使用

1. 从 [Releases](https://github.com/Meredith2328/osulyrics/releases) 下载 `osu-lyrics-0.4.8-portable.exe`，双击运行。无需安装 Node.js。当前包未签名，Windows 可能显示「未知发布者」；可用 Release 附带的 SHA-256 文件核对下载内容。
2. 打开 osu!lazer。首次使用若提示缺少 tosu，点击「安装」；程序会下载固定版本并校验 SHA-256。建议把游戏设为无边框或窗口模式，以便外部歌词窗口置顶。
3. 播放或预览歌曲后，工具会自动查找同步歌词。没找到时可搜索其他版本、导入 LRC，或编辑当前歌词；「−／＋」每次校时 0.5 秒。

拖动歌词可移动位置，拖动边缘可缩放；点锁图标锁定位置。左上角粉色音符可收起或展开控制面板；面板本身也能拖动、从边缘缩放。「歌词外观」可调大小、透明度、颜色、排版和中文翻译，顶部有四种快捷色样。初次运行默认白粉色样，上图演示冰蓝色样。位置、样式、锁定状态与校时会保存在本机，重启后保留。

**Ctrl+Alt+Shift+L** 可隐藏或显示整个悬浮窗口；也可右键通知区域的音符图标操作。完全退出请使用该菜单。若快捷键被其他软件占用，仍可通过通知区域控制。

本地配置与歌词放在 `%APPDATA%\osu-lyrics-companion`。**日常使用更推荐上面的便携 EXE**，无需安装 Node.js。`start.cmd` 和 `start.ps1` 仅供从源码运行：前者可双击，后者可执行 `powershell -ExecutionPolicy Bypass -File .\start.ps1`；两者会在首次运行时安装依赖。源码测试用 `npm test`。

## 技术选型

- [Electron](https://www.electronjs.org/) 提供透明置顶窗口、通知区域图标与全局快捷键。工具不会向 osu! 注入代码。EXE 的体积主要来自附带的 Chromium/Node.js 运行时；打包时只保留英、简中、繁中和日文语言资源。
- [tosu](https://github.com/tosuapp/tosu) 作为独立本机程序，提供 osu!lazer 的曲目、谱面时间、暂停与改速信息；本工具从 `127.0.0.1:24050/json/v2` 读取，按游戏报告的时间轴同步歌词。
- [LRCLIB](https://lrclib.net/docs) 提供带时间戳的 LRC。匹配时综合曲名、歌手、时长与语言；本地导入或编辑的歌词优先。缺少中文时可调用 Google 翻译的非官方网页接口生成译文，使用该功能时歌词文本会发送给 Google，服务可能变动或不可用。
- 窗口字体附带 [Nunito Sans](assets/fonts/OFL.txt)（SIL Open Font License）；粉色音符图标由本仓库脚本绘制。未打包游戏字体、音频、谱面或歌词。

## 版权与用途

这是非官方的个人游玩辅助工具，与 osu!、ppy 或相关创作者没有隶属或背书关系。**osu! 名称、标识及游戏素材归 osu!/ppy 等相应权利人；歌曲、封面、谱面和歌词分别归其作者及权利人。** 请勿把从歌词服务取得的内容当作本仓库授权的可再分发素材。本工具仅为方便游玩而制作，不提供或转售游戏与歌曲内容；具体权利以 [osu! 的音乐授权说明](https://osu.ppy.sh/legal/en/Music_licensing) 和各素材许可为准。

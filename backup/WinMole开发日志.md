WinMole是一个完整的 Windows 桌面工具工程实践案例。从灵感捕捉、技术选型、架构设计、功能迭代、到打包交付，每一步都有清晰的决策依据和技术细节记录。本文档可作为未来桌面工具开发项目的参考模板。

# WinMole 开发日志

> **从零到一的 Windows 轻量清理工具**  
> 一次完整的桌面工具工程实践，及与 Mole (macOS) 的设计对话  


## 目录

1. [项目起源与设计理念](#01-项目起源与设计理念)
2. [技术架构](#02-技术架构)
3. [功能演进：核心引擎](#03-功能演进核心引擎)
4. [功能演进：用户界面](#04-功能演进用户界面)
5. [功能演进：系统工具](#05-功能演进系统工具)
6. [工程实践](#06-工程实践)
7. [回顾与展望](#07-回顾与展望)
8. [附录：项目文件结构 & 命令速查](#附录项目文件结构--命令速查)


## 01. 项目起源与设计理念

WinMole 诞生于一次跨平台的设计对话。macOS 上有 Mole——一款五合一原生清理工具，以「一次买断、无遥测、本机扫描」为核心理念。Windows 生态缺少这样一款**轻量、克制、无侵入**的系统工具。WinMole 的目标不是取代 CCleaner，而是提供一款开发者视角的日常维护伴侣。

### 为什么叫 WinMole

Mole（鼹鼠）在 macOS 上做了五件事：系统清理、软件管理、磁盘分析、状态监控、大文件扫描。它的设计哲学是「五颗星球」——每一项功能独立运转，互不依赖，用户可以只用一个。WinMole 继承了这套理念，同时针对 Windows 平台的独特问题（注册表、回收站 API、GBK 编码）做了大量平台适配。

### 设计约束

| 约束项 | 选择 | 理由 |
|--------|------|------|
| 语言 | Python 3.13 | 零编译成本，快速迭代 |
| GUI 框架 | Tkinter（内置） | 零额外依赖，开箱即用 |
| 终端框架 | Rich | 彩色终端 + 进度条 + 表格 |
| 系统调用 | ctypes + psutil + winreg | 直接调用 Windows API |
| 打包 | PyInstaller (onedir) | 独立 exe，无需安装 Python |
| 国际化 | 自建 locales.py | 中英双语，一键切换 |

> **核心原则：独立 exe，不写注册表，不驻留后台，本机扫描不上传。** 这是对 Mole 设计哲学的直接延续，也是 WinMole 与市面上大多数 Windows 清理工具的根本区别。


## 02. 技术架构

WinMole 采用**引擎与界面分离**的架构：一个核心引擎（`winmole_engine.py`）同时服务于命令行版（`winmole_simple.py`）和图形界面版（`winmole_gui.py`）。清理规则从 YAML 配置文件加载，支持用户自定义扩展。

### 模块总览

| 模块 | 职责 | 关键技术 |
|------|------|----------|
| `winmole_engine.py` | 核心引擎：六大类，处理所有底层逻辑 | ctypes · psutil · winreg · yaml |
| `winmole_simple.py` | 命令行界面：7 个功能菜单 | Rich (Console, Table, Panel, Progress) |
| `winmole_gui.py` | 图形界面：5 个标签页 | Tkinter (ttk.Notebook, Thread) |
| `locales.py` | 国际化：中英双语 | 80+ key 的字典映射 |
| `cleanup_rules.yaml` | 清理规则配置 | 9 条系统规则 + 浏览器 + 构建产物 |

### 引擎六大类

| 类 | 功能 | 关键方法 |
|----|------|----------|
| `Config` | 加载 YAML 规则，路径展开，PyInstaller 兼容 | `_load()` · `_get_app_dir()` |
| `SystemCleaner` | 扫描和清理系统垃圾，含回收站特殊处理 | `scan()` · `clean()` · `_empty_recycle_bin()` |
| `AppUninstaller` | 读取已安装应用、静默卸载、残留扫描 | `get_installed_apps()` · `uninstall()` · `scan_residuals()` |
| `RegistryCleaner` | 扫描无效注册表项，支持分类选择和批量清理 | `scan()` · `clean()` |
| `BuildArtifactCleaner` | 扫描 node_modules / target / build 等构建产物 | `scan()` · `clean()` |
| `SizeUtils` | 格式化文件大小（B / KB / MB / GB） | `format_size()` |

> **架构决策**：引擎与界面分离带来了两个好处——第一，命令行和 GUI 共享同一套清理逻辑，不会出现行为不一致；第二，打包时可以独立编译 CLI 和 GUI 两个 exe，用户按需选择，不强制安装图形界面。


## 03. 功能演进：核心引擎

核心引擎的开发贯穿了整个项目周期。其中最复杂的两个子系统是**回收站清理**和**应用卸载**——两者都需要直接调用 Windows API，而非简单的文件系统操作。

### 回收站清理：绕过文件系统陷阱

初版直接用 `shutil.rmtree("C:/$Recycle.Bin")`。这在 Windows 上静默失败——`$Recycle.Bin` 是系统保护文件夹，Python 的文件 API 无权访问。表现是「清理成功」但磁盘空间一点没变。

修复方案是通过 ctypes 直接调用 Shell32 API：

```python
# 获取回收站大小
ctypes.windll.shell32.SHQueryRecycleBinW("C:\\")

# 清空回收站（0x0001 = NOPROGRESSUI + flag）
ctypes.windll.shell32.SHEmptyRecycleBinW(0, None, 0x0001)
```

同时增加了 **< 1KB 保护**：当 API 返回的大小不足 1KB 时视为已空，避免对元数据残留反复调用 API。这条保护规则挽回了约 1.88MB 的误判空间。

### 清理反馈：从静默到透明

`shutil.rmtree` 的另一个问题是 `ignore_errors=True` 吞掉了所有错误信息——缩略图被 Explorer 锁定、临时文件被其他进程占用，这些 PermissionError 全部静默消失。我们修改了清理流程：

1. `_clean_contents()` 改为返回 `(deleted, failed)` 元组，不再吞异常
2. `clean()` 对每条规则返回三态：**cleaned** / **partial** / **failed**
3. GUI 新增详细结果弹窗，逐项显示 [OK] / [*] / [FAIL] + 原因
4. 关闭弹窗后自动重扫，确认实际清理效果

### 应用卸载与残留扫描

`AppUninstaller` 从注册表 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall` 读取已安装应用列表（实际加载了 137 个条目）。卸载流程分为三步：

1. 静默卸载：调用应用的 QuietUninstallString 或 UninstallString
2. 残留扫描：检查 AppData、ProgramData、Program Files 下的对应目录
3. 可选清理：用户确认后批量删除残留文件和注册表项

### 注册表清理

`RegistryCleaner` 扫描四类问题：无效软件条目、启动项残留、文件关联孤项、最近文件历史。支持按类别选择和批量清理，每次操作前生成预览清单。


## 04. 功能演进：用户界面

WinMole 提供**双模式界面**：基于 Rich 的终端交互界面（CLI）和基于 Tkinter 的图形界面（GUI）。二者共享同一引擎，但面向不同的使用场景——CLI 适合快速操作和远程维护，GUI 适合新手和一次性批量任务。

### GUI：五大标签页

| 标签页 | 功能 | 关键交互 |
|--------|------|----------|
| 系统清理 | 扫描 + 批量清理临时文件、缓存、回收站 | 16 项规则，进度条，结果弹窗 |
| 应用卸载 | 已安装应用列表 + 单个卸载 + 残留扫描 | 搜索过滤，确认对话框 |
| 注册表 | 扫描无效注册表项 + 分类清理 | 按类别勾选，批量操作 |
| 构建产物 | 扫描 node_modules / target 等 | 浏览选择目录，预览后清理 |
| 关于 | 版本信息 + 技术栈 | 项目链接 |

清理操作在后台线程执行（`threading.Thread`），不阻塞 UI。进度通过 `root.after()` 回传主线程更新。清理完成后弹出详细结果对话框，用户能看到每一项规则的实际清理结果，而不仅仅是一个「完成」提示。

### 中英文一键切换

`locales.py` 维护了约 80 个 key 的中英双语文案。GUI 右上角的语言切换按钮触发 `_toggle_lang()` 方法，遍历所有已注册的控件字典 `_w`，动态更新文字而不重建 UI：

```python
def _toggle_lang(self):
    self._lang = "zh" if self._lang == "en" else "en"
    for widget, key, fmt in self._w:
        widget.config(text=self.t(key).format(**fmt))
```

> 所有按钮使用 Emoji 文字图标（🔍 扫描、🧹 清理、🔄 刷新、❌ 卸载等），而非外部图片文件。这保证了打包后的 exe 零外部资源依赖。之前尝试过 base64 内嵌 PNG 方案（18 种 16x16 彩色图标），最终因为终端兼容性原因回退到更简洁的 Emoji 文字方案。

### CLI：从简单到丰富的演进

命令行版的迭代是整个项目中最活跃的部分。初版只有基础的清理和状态显示，后续根据 Mole 的界面设计逐个重写了三个核心模块：磁盘分析、系统监控、软件卸载。每一次重写都遵循同一个原则：**交互密度要够、键盘操作要快、视觉效果要有区分度**。


## 05. 功能演进：系统工具

CLI 的三个系统工具模块——磁盘分析、系统监控、软件卸载——都经历了从「能用」到「用起来爽」的完整重设计。每一次重写的参照物都是 Mole 的 macOS 界面，但目标不是照搬，而是理解其**交互逻辑**，再在 Windows 终端环境下重新实现。

### 磁盘分析器

初版只是一个分区列表：`C: 总 500G / 已用 320G (64%)`。重写后的版本是**交互式目录级分析器**：

- 默认从用户目录开始扫描，而非分区根目录——更贴近实际使用场景
- 水平条形图排名，按大小降序，色阶动态（>50% 红 / 25-50% 黄 / 10-25% 青 / <10% 灰）
- `N` + 数字：钻入子目录；`B`：返回上级；`L`：大文件模式
- `D`：驱动器切换器（含使用率条形图）；`P`：自定义路径

最大的技术难点是性能——扫描包含数百个子目录的用户文件夹时，Python 递归遍历可能耗时数秒。我们加入了实时扫描计数显示和按文件数截断（单目录最多显示前 50 个子项），保证界面在 1 秒内渲染完成。

### 系统监控器

按照 Mole 的 `mo status` 设计，重写为双列三行的信息面板布局，六大数据面板覆盖了系统运行的全部关键指标：

| 面板 | 指标 | 技术实现 |
|------|------|----------|
| CPU | 总使用率 + 8 核独立进度条 + 实时频率 | psutil.cpu_percent + cpu_freq |
| Memory | Used / Free / Available 三条进度条 | psutil.virtual_memory |
| Disk | C: 使用率 + I/O 读写速度条 | psutil.disk_usage + disk_io_counters |
| Power | 电池电量 + 充电状态（桌面机显示 N/A） | psutil.sensors_battery |
| Network | 上下行速度 + IP 地址 | psutil.net_io_counters + net_if_addrs |
| Processes | Top5 内存占用进程 | psutil.process_iter |

> **CPU 数据 0.0% Bug**：这是一个隐蔽的 psutil API 陷阱。两次 `cpu_percent()` 调用（先 interval=0.5，再 percpu=True）导致第二次 percpu 追踪器从第一次的终点启动，基线丢失，所有核心显示 0.0%。修复仅需一行：`cpu_percent(interval=0.5, percpu=True)` 单次调用 + sum/len 算总使用率。

### 一键释放内存

通过 ctypes 调用 `EmptyWorkingSet` Windows API，遍历所有进程，强制修剪工作集（working set），将被进程占用但未活跃使用的物理内存归还系统。

- 实测效果：88.7% → 62.8%，释放 2.02 GB，无需重启
- 遍历 147 个进程，成功修剪 139 个，系统保护进程自动跳过 8 个
- 不需要管理员权限——EmptyWorkingSet 是非特权 API

### 软件卸载器

从分页 Rich Table 重写为 Mole 风格的紧凑交互列表。核心变化：

- 直接打字即搜索，实时筛选，不再需要先输关键字再等翻页
- 应用按大小降序排列，>1GB 红色、>100MB 黄色，一眼识别大型应用
- 选中后展开详情卡片：Publisher / Version / Size / Location / Uninstaller
- 卸载后可选残留扫描，遍历 AppData / ProgramData / Program Files
- 键盘快捷键：`#` 选中 / `/` 搜索 / `X` 清搜索 / `S` 切换排序 / `Q` 退出

### 乱码全 ASCII 化

Windows 终端的一个持续痛点：中文终端默认字体（Consolas / 新宋体）不支持 Unicode 方块字符 `█` `░` 和 Emoji `📁` `📄`。即使开了 `chcp 65001`，也只是解决了编码问题，字体缺字仍然显示方框或菱形乱码。最终方案：所有视觉元素（条形图、图标、省略号）全部使用纯 ASCII 可打印字符，`#` 填充 + `-` 空白 + `[D]` 目录 + `[F]` 文件，在任何 Windows 终端字体下都不会出现乱码。


## 06. 工程实践

从项目清理到一键打包，WinMole 的工程化过程涉及**文件管理、路径兼容、PyInstaller 编译、双重构建**等多个环节。每一步都有实际踩坑和对应的解决方案。

### 项目清理

开发过程中积累了 12 个冗余文件——4 个旧版本 Python 文件、2 个废弃的 bat 启动器、一套 Go 原型空壳（main.go + cmd/ + internal/ + lib/ + tests/）。清理后核心文件精炼为 11 个：

| 类别 | 文件 | 说明 |
|------|------|------|
| 核心 | `winmole_engine.py` · `winmole_simple.py` · `winmole_gui.py` | 引擎 + CLI + GUI |
| 配置 | `locales.py` · `cleanup_rules.yaml` · `requirements.txt` | 国际化 + 规则 + 依赖 |
| 脚本 | `run.bat` · `setup.bat` · `package.bat` | 运行 + 环境 + 打包 |
| 文档 | `README.md` · `.gitignore` | 说明 + Git |

### 一键打包

`package.bat` 是项目交付的核心。它自动完成：

1. 检查 venv 和依赖 → 自动安装 PyInstaller
2. 清理旧构建产物（build / dist / *.spec）
3. 双模式编译：
   - `WinMole_GUI.exe`：--windowed --onedir，无控制台窗口
   - `WinMole_CLI.exe`：--console --onedir，终端程序
4. assembling 发布包到 `dist/WinMole_v1.0/`，含主菜单启动器

编译参数经过精心调教：`--hidden-import` 显式声明 yaml / psutil / Rich / Tkinter 避免遗漏；`--exclude-module` 排除 matplotlib / numpy / pandas 减小编译体积（从 ~120MB 降至 66MB）；`--add-data` 包含 cleanup_rules.yaml 配置文件。

### PyInstaller 路径兼容

PyInstaller 打包后 `__file__` 不可用，导致 `cleanup_rules.yaml` 加载失败。修复方案是通过 `sys.frozen` 判断运行环境：

```python
def _get_app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent  # PyInstaller
    return Path(__file__).parent           # 源码运行
```

这个兼容层放在 `Config.__init__()` 中，引擎所有需要读取外部文件的地方都统一走 `_get_app_dir()` 路径。

> **打包验证结果**  
> CLI 构建成功：WinMole_CLI.exe (5MB + 28MB _internal)  
> GUI 构建成功：WinMole_GUI.exe (5MB + 28MB _internal)  
> 发布包总大小 66MB，CLI exe 端到端验证通过，交互菜单正常运行


## 07. 回顾与展望

WinMole 是一次完整的**「从灵感 → 原型 → 迭代 → 打包交付」**的桌面工具工程实践。从看到 Mole 的那一刻到最终生成独立的 exe 发布包，总共经历了约 6 小时的密集开发和 20 余次功能迭代。

### 关键决策回顾

| 决策点 | 选择 | 正确性复盘 |
|--------|------|-----------|
| 语言选型 | Python 而非 Go | 正确。Python 的 ctypes + winreg + psutil 生态让 Windows API 调用成本极低。Go 原型只写了 main.go 就放弃了 |
| GUI 框架 | Tkinter 而非 PyQt | 正确。Tkinter 内置零依赖，打包后体积减少约 40MB。功能足够覆盖 5 标签页的简单 GUI |
| 双界面 | CLI + GUI 各自独立 | 正确。共享引擎、独立编译，用户按需选择。CLI 的迭代速度远快于 GUI |
| 打包方式 | PyInstaller onedir | 正确。onefile 虽更便携但启动慢 3-5 秒，onedir 启动 <1 秒，体验更好 |
| 全 ASCII | 放弃 Unicode 和 Emoji | 正确但意外。本以为 chcp 65001 就够了，实际上终端字体缺字是无解的，纯 ASCII 是最安全的方案 |

### 踩过的坑

1. **回收站操作**：shutil.rmtree 对系统保护文件夹无效，必须用 Shell32 API
2. **CPU 数据归零**：psutil.cpu_percent 的多次调用会冲突，内部状态管理比文档暗示的复杂
3. **Unicode 渲染**：chcp 65001 只解决编码层，字体缺 glyph 是无解的。放弃 Unicode 比换字体更可靠
4. **PyInstaller 路径**：`__file__` 在 frozen 环境不可用，所有文件读写在打包前就要考虑 sys.frozen 分支
5. **清理反馈缺失**：静默失败（ignore_errors=True）是最差的设计——用户不知道哪些失败了，也不知道为什么

### 数据一览

| 指标 | 数值 |
|------|------|
| 总开发耗时 | ~6 小时 |
| 功能迭代 | 20+ 次 |
| 核心代码行 | ~1,800 行（5 个 .py 文件） |
| 清理规则 | 9 条系统规则 + 10 种构建产物 |
| 发布包大小 | 66 MB（含两个独立 exe） |
| 支持语言 | 中 / 英，80+ key 双语覆盖 |
| 实测内存释放 | 2.02 GB（88.7% → 62.8%） |

### 未来方向

- **增量清理引擎**：而非全量扫描，只扫变更项，提升重扫速度
- **清理历史日志**：记录每次清理的文件清单，支持回滚和审计
- **系统托盘模式**：驻留后台，支持定时清理和内存自动释放
- **国际化扩展**：日语、韩语支持，适配东亚字体渲染
- **自动更新**：检测 GitHub Release 新版本，一键升级

> WinMole 的核心价值不在于功能数量，而在于设计选择：独立 exe、不写注册表、不驻留后台、本机扫描不上传。这些约束来自对 Mole 设计哲学的深入理解，也来自对 Windows 工具市场现状的清醒判断。好的工具不需要「什么都能做」——它只需要把自己承诺的几件事做到极致。


## 附录：项目文件结构 & 命令速查

### A. 文件结构

```
WinMole/
├── winmole_engine.py      # 核心引擎（六大类）
├── winmole_simple.py      # CLI 命令行界面
├── winmole_gui.py         # GUI 图形界面
├── locales.py             # 中英双语
├── cleanup_rules.yaml     # 清理规则配置
├── requirements.txt       # Python 依赖
├── README.md              # 项目说明
├── run.bat                # 本地运行（TUI/GUI 双模式）
├── setup.bat              # 一键初始化环境
├── package.bat            # 一键打包脚本
├── .gitignore             # Git 忽略规则
├── venv/                  # Python 虚拟环境
└── dist/
    └── WinMole_v1.0/      # 发布包
        ├── 启动.bat        # 主菜单启动器
        ├── cleanup_rules.yaml
        ├── README.md
        ├── GUI/
        │   ├── WinMole_GUI.exe
        │   └── _internal/
        └── CLI/
            ├── WinMole_CLI.exe
            └── _internal/
```

### B. CLI 菜单

| # | 功能 | 关键操作 |
|---|------|----------|
| 1 | 系统清理 | 扫描 → 确认 → 清理 |
| 2 | 软件卸载 | 实时搜索 → 选中 → 卸载 → 残留扫描 |
| 3 | 磁盘分析 | N 进入子目录 · B 返回 · L 大文件 · D 切换驱动器 |
| 4 | 系统监控 | R 刷新 · Q 退出 · 双列六面板 |
| 5 | 构建产物 | 浏览目录 → 扫描 → 清理 |
| 6 | 安装包清理 | 扫描 Downloads → 清理 |
| 7 | 释放内存 | 一键清空工作集 |
| 0 | 退出 | |

### C. 常用命令

```bash
# 本地运行（TUI）
venv\Scripts\python winmole_simple.py

# 本地运行（GUI）
venv\Scripts\python winmole_gui.py

# 一键打包
package.bat

# 发布包位置
dist\WinMole_v1.0\启动.bat
```

### D. 技术参考

- Mole (macOS)：五合一清理工具，WinMole 的设计参照。作者 tw93，开源 MIT 协议
- psutil 文档：系统信息获取标准库，支持 Windows / macOS / Linux
- Rich 文档：Python 终端 UI 框架，Table / Panel / Progress / Prompt
- PyInstaller 文档：Python → 独立 exe 打包工具，支持 windowed / console 双模式
- Shell32 API：EmptyWorkingSet / SHEmptyRecycleBinW / SHQueryRecycleBinW

> **速览**：WinMole 是一个完整的 Windows 桌面工具工程实践案例。从灵感捕捉、技术选型、架构设计、功能迭代、到打包交付，每一步都有清晰的决策依据和技术细节记录。本文档可作为未来桌面工具开发项目的参考模板。
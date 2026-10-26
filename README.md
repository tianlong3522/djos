# DJOS — 面向 x86 主机的私有 NAS 系统

DJOS 是一款安装在普通 x86 电脑主机上的 NAS 操作系统：采用群晖 DSM 风格的 Web 管理界面与核心功能集，U 盘插入后**一键自动安装、全程无需人工干预**，装完即用。

- 管理界面：`http://<本机IP>:8800` 或 `http://djos.local:8800`
- 初始账户：`admin`　初始密码：安装完成页显示（默认 `DJOS@2026`，首次登录强制修改）
- 系统底座：Debian 12（Stable），存储：Btrfs（压缩 + 快照），应用生态：Docker

---

## 功能一览

| 模块 | 能力 |
| --- | --- |
| 系统概览 | CPU / 内存 / 网络实时图表、健康度、容量水位、告警通知、操作审计 |
| 存储空间 | Btrfs 存储池（单盘 / RAID 0 / RAID 1）、zstd 压缩、只读快照 |
| 磁盘信息 | lsblk 磁盘清单、S.M.A.R.T. 健康详情与短自检 |
| 共享文件夹 | SMB（Windows 网络邻居）/ NFS、回收站、只读属性 |
| 文件管理 | 浏览、新建、上传、下载、重命名、回收站删除 |
| 套件中心 | 一键部署 Jellyfin、qBittorrent、Syncthing、Nextcloud、Gitea 等（Docker） |
| Docker | 容器启停、日志查看、删除 |
| 备份任务 | Btrfs 快照 / rsync 双模式，cron 计划，执行记录 |
| 用户管理 | 多用户、管理员授权、停用、改密，与系统账户联动 |
| 系统设置 | 主机名、时区、SSH 开关、自动安全更新、重启 / 关机 |
| 日志中心 | systemd 日志 + 操作审计双视图 |

## 一键安装（飞牛式体验）

1. 用写盘工具把 `DJOS-x.x.x-amd64.iso` 写入 U 盘（见下）。
2. U 盘插入目标 x86 主机，开机从 U 盘启动（BIOS/UEFI 均可）。
3. 安装器自动识别系统盘（跳过 U 盘自身）、分区、安装、配置引导，**全程无人值守**。
4. 屏幕显示管理地址与初始密码，10 秒后自动重启，拔下 U 盘即可。

自定义默认项：编辑 U 盘根目录 `djos/autoinstall.conf`（主机名、目标磁盘、时区等，默认全自动）。

## 制作安装 U 盘

Windows（管理员 PowerShell）：

```powershell
build\windows\make-usb.ps1 -Iso .\DJOS-1.0.0-amd64.iso
```

Linux / macOS：

```bash
build/make-usb.sh DJOS-1.0.0-amd64.iso
```

两个脚本都会列出可移动磁盘、二次确认后写入并校验。

## 自行构建 ISO

任意装有 Docker 的机器（含 Windows）：

```bash
# 注意：构建上下文必须是仓库根目录（Dockerfile 需要用 -f 指定）
docker build -f build/Dockerfile -t djos-builder .
docker run --rm --privileged -v "$PWD/out:/project/out" djos-builder
```

原生 Debian/Ubuntu 环境：

```bash
sudo build/build-iso.sh        # 输出 out/DJOS-<版本>-amd64.iso 及 sha256
```

GitHub Actions：push 到 main 即自动构建并上传 ISO 工件（见 `.github/workflows/build-iso.yml`）。

## 目录结构

```
DJOS/
├── build/                  # live-build 构建链（hooks、chroot  overlay、包清单、Dockerfile）
│   ├── build-iso.sh        # 一键构建混合 ISO（BIOS+UEFI）
│   ├── make-usb.sh         # Linux/macOS 写盘
│   └── windows/make-usb.ps1# Windows 写盘
├── packages/catalog.json   # 套件中心应用目录
├── src/
│   ├── api/                # Flask 管理后端（认证/存储/共享/文件/套件/备份/设置）
│   ├── installer/          # djos-install 无人值守安装器、djos-firstboot 首启初始化
│   └── web/                # DSM 风格单页控制台（原生 JS，含离线演示模式）
└── VERSION
```

## 常见问题

- **支持哪些 CPU？** 任何 x86-64 主机（Intel/AMD，含 J4125、N5105 等低功耗平台），内存 ≥ 2 GB，系统盘 ≥ 16 GB。
- **数据盘会被清空吗？** 安装器只写入选定的系统盘；数据盘进入系统后在"存储空间"中创建存储池时才格式化，并需输入 `ERASE` 二次确认。
- **没有机器能先试玩吗？** 登录页点击"进入界面演示"即可体验完整界面（数据为模拟）。

#!/bin/bash
# DJOS NAS PVE 一键部署脚本（在 PVE 宿主机 Shell 中执行，无需 U 盘）
#
# 用法:
#   bash djos-pve-deploy.sh [VMID] [磁盘GB]
# 示例:
#   bash djos-pve-deploy.sh 107 500      # 重建 VM 107，500G 磁盘
#   bash djos-pve-deploy.sh              # 自动取下一个可用 VMID，默认 500G
#
# 原理: 磁盘排在启动顺序首位、CD 兜底——空盘时自动回落到 CD 进入 Live 安装，
#       装完重启后磁盘已有 GRUB，直接从硬盘引导，之后每次开机都不再碰 CD。
set -euo pipefail

VMID="${1:-$(pvesh get /cluster/nextid)}"
DISK_GB="${2:-500}"
ISO_NAME="DJOS-1.2.5-amd64.iso"
ISO_DIR="/var/lib/vz/template/iso"
ISO_PATH="$ISO_DIR/$ISO_NAME"
STORAGE="local-lvm"
MIRROR="https://gh-proxy.com/"
BASE_URL="https://github.com/tianlong3522/djos/releases/download/v1.2.5"

echo "==> DJOS 部署: VM=$VMID 磁盘=${DISK_GB}GB 存储=$STORAGE"

# 0. 已存在的 VM：确认后销毁重建
if qm status "$VMID" >/dev/null 2>&1; then
    echo "!! VM $VMID 已存在"
    read -r -p "   销毁并重建该 VM（含其磁盘）? 输入 yes 继续: " A
    [ "$A" = "yes" ] || exit 1
    qm stop "$VMID" 2>/dev/null || true
    qm destroy "$VMID" --purge 2>/dev/null || true
fi

# 1. 获取 ISO：优先单文件；超过 2GiB 的版本为分卷 part-00..NN，自动合并并校验
mkdir -p "$ISO_DIR"
if [ ! -s "$ISO_PATH" ]; then
    if wget -q --spider "${MIRROR}${BASE_URL}/$ISO_NAME"; then
        echo "==> 下载 $ISO_NAME（约 474MB，走 gh-proxy 加速）"
        wget -c -O "$ISO_PATH" "${MIRROR}${BASE_URL}/$ISO_NAME"
    elif wget -q --spider "${MIRROR}${BASE_URL}/$ISO_NAME.part-00"; then
        echo "==> 下载分卷 $ISO_NAME.part-00..NN（走 gh-proxy 加速）"
        for n in 00 01 02 03 04 05 06 07 08 09; do
            P="${ISO_NAME}.part-$n"
            if ! wget -q --spider "${MIRROR}${BASE_URL}/$P"; then
                break
            fi
            wget -c -O "$ISO_DIR/$P" "${MIRROR}${BASE_URL}/$P"
        done
        cat "$ISO_DIR/${ISO_NAME}".part-* > "$ISO_PATH"
        rm -f "$ISO_DIR/${ISO_NAME}".part-*
    else
        echo "ISO 获取失败，请手动上传 $ISO_NAME 到 $ISO_DIR" >&2
        exit 1
    fi
fi
[ -s "$ISO_PATH" ] || { echo "ISO 文件为空" >&2; exit 1; }
echo "==> ISO 就绪: $ISO_PATH ($(( $(stat -c%s "$ISO_PATH") / 1024 / 1024 ))MB)"

# 1.5 SHA256 校验（分卷合并后应与官方一致）
wget -qO "$ISO_DIR/$ISO_NAME.sha256.tmp" "${MIRROR}${BASE_URL}/$ISO_NAME.sha256" || true
if [ -s "$ISO_DIR/$ISO_NAME.sha256.tmp" ]; then
    EXPECT=$(awk '{print $1}' "$ISO_DIR/$ISO_NAME.sha256.tmp")
    ACTUAL=$(sha256sum "$ISO_PATH" | awk '{print $1}')
    if [ "$EXPECT" = "$ACTUAL" ]; then
        echo "==> SHA256 校验通过"
    else
        echo "SHA256 校验失败: expect=$EXPECT actual=$ACTUAL" >&2
        exit 1
    fi
    rm -f "$ISO_DIR/$ISO_NAME.sha256.tmp"
fi

# 2. 创建 VM（磁盘优先、CD 兜底）
qm create "$VMID" --name DJOS --ostype l26 \
    --cores 2 --memory 4096 --balloon 0 \
    --net0 virtio,bridge=vmbr0,firewall=0 \
    --scsihw virtio-scsi-pci \
    --scsi0 "${STORAGE}:${DISK_GB},iothread=1,ssd=1" \
    --ide2 "local:iso/${ISO_NAME},media=cdrom" \
    --boot 'order=scsi0;ide2' \
    --vga std --serial0 socket --onboot 1

qm start "$VMID"

echo
echo "✅ VM $VMID 已创建并启动"
echo "   首次开机: 空盘 → 自动回落 CD → Live 环境全自动安装（约 2-5 分钟）→ 自动重启进硬盘"
echo "   以后开机: 直接磁盘引导，CD 不再参与"
echo "   进度查看: PVE 控制台；装完访问 http://<VM-IP>:8800（admin / djos123）"

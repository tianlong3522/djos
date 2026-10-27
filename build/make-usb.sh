#!/usr/bin/env bash
# Linux / macOS 下把 DJOS ISO 写入 U 盘。
# 用法：sudo ./make-usb.sh /dev/sdX ../../out/DJOS-1.0.0-amd64.iso
set -euo pipefail

DEVICE="${1:-}"
ISO="${2:-}"

if [ -z "$DEVICE" ] || [ -z "$ISO" ]; then
    echo "用法: sudo $0 /dev/sdX <DJOS.iso>" >&2
    echo
    echo "可用磁盘："
    lsblk -d -o NAME,SIZE,TRAN,MODEL
    exit 1
fi

[ "$(id -u)" -eq 0 ] || { echo "需要 root 权限" >&2; exit 1; }
[ -b "$DEVICE" ] || { echo "不是块设备：$DEVICE" >&2; exit 1; }
[ -f "$ISO" ] || { echo "ISO 不存在：$ISO" >&2; exit 1; }

echo "目标设备：$DEVICE"
lsblk -d -o NAME,SIZE,TRAN,MODEL "$DEVICE" || true
echo "警告：该设备上的全部数据将被擦除。"
read -r -p "输入 ERASE 继续：" answer
[ "$answer" = "ERASE" ] || { echo "已取消"; exit 1; }

umount "${DEVICE}"* 2>/dev/null || true
dd if="$ISO" of="$DEVICE" bs=4M status=progress oflag=direct conv=fsync
sync
echo "✅ 写入完成：$DEVICE"

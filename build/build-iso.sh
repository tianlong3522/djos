#!/usr/bin/env bash
# 直接构建 DJOS 可 U 盘直写的混合引导 ISO：
#   debootstrap 引导 base → chroot 内装包 → mksquashfs → grub-mkrescue 生成 BIOS+UEFI 双引导 ISO
# 不再依赖 live-build，所有步骤显式可控。需要 root。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build/live"
CHROOT="$BUILD/chroot"
ISODIR="$BUILD/iso"
OUT="$ROOT/out"
VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"

# 软件源可用环境变量覆盖；默认阿里云（国内外均可访问）
MIRROR="${DJOS_MIRROR:-https://mirrors.aliyun.com/debian}"
MIRROR_SEC="${DJOS_MIRROR_SECURITY:-https://mirrors.aliyun.com/debian-security}"

if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 root 运行：sudo ./build/build-iso.sh" >&2
    exit 1
fi

for cmd in debootstrap mksquashfs grub-mkrescue xorriso; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "缺少构建工具：$cmd" >&2
        exit 1
    }
done

echo "==> 清理旧构建"
rm -rf "$BUILD"
mkdir -p "$CHROOT" "$ISODIR/live" "$ISODIR/boot/grub" "$OUT"

echo "==> debootstrap 引导 Debian 12 (bookworm/amd64)"
# 预装 ca-certificates，否则 chroot 内 apt 无法校验 https 源
debootstrap --arch=amd64 --variant=minbase --include=ca-certificates \
    bookworm "$CHROOT" "$MIRROR"

echo "==> 写入 chroot 软件源"
cat > "$CHROOT/etc/apt/sources.list" <<EOF
deb $MIRROR bookworm main contrib non-free non-free-firmware
deb $MIRROR bookworm-updates main contrib non-free non-free-firmware
deb $MIRROR_SEC bookworm-security main contrib non-free non-free-firmware
EOF
rm -rf "$CHROOT/etc/apt/sources.list.d"
mkdir -p "$CHROOT/etc/apt/sources.list.d"

# 安装期间不自动拉起服务
printf '#!/bin/sh\nexit 101\n' > "$CHROOT/usr/sbin/policy-rc.d"
chmod +x "$CHROOT/usr/sbin/policy-rc.d"

echo "==> chroot 内更新包列表"
chroot "$CHROOT" env DEBIAN_FRONTEND=noninteractive apt-get update

echo "==> 解析软件包清单"
PKGS="$(grep -vE '^[[:space:]]*(#|$)' "$ROOT/build/package-lists/djos.list.chroot" | tr -d '\r' | tr '\n' ' ')"
INSTALL=""
MISSING=""
for p in $PKGS; do
    if chroot "$CHROOT" apt-cache show "$p" >/dev/null 2>&1; then
        INSTALL="$INSTALL $p"
    else
        MISSING="$MISSING $p"
    fi
done
[ -z "$MISSING" ] || echo "    跳过当前源中不存在的包：$MISSING"
for p in live-boot live-boot-initramfs-tools linux-image-amd64 systemd-sysv; do
    case " $INSTALL " in
        *" $p "*) ;;
        *) echo "缺少必需软件包：$p" >&2; exit 1 ;;
    esac
done

echo "==> 安装系统软件包（耗时最长）"
chroot "$CHROOT" env DEBIAN_FRONTEND=noninteractive \
    apt-get install -y --no-install-recommends $INSTALL
chroot "$CHROOT" apt-get clean

echo "==> 注入 DJOS 文件"
cp -a "$ROOT/build/includes.chroot/." "$CHROOT/"
mkdir -p "$CHROOT/opt/djos/api" "$CHROOT/opt/djos/web" \
    "$CHROOT/opt/djos/installer" "$CHROOT/opt/djos/packages"
cp -a "$ROOT/src/api/." "$CHROOT/opt/djos/api/"
cp -a "$ROOT/src/web/." "$CHROOT/opt/djos/web/"
cp -a "$ROOT/src/installer/." "$CHROOT/opt/djos/installer/"
cp -a "$ROOT/packages/." "$CHROOT/opt/djos/packages/"
cp "$ROOT/VERSION" "$CHROOT/opt/djos/VERSION"

echo "==> 执行 chroot 配置钩子"
cp "$ROOT/build/hooks/0100-djos.hook.chroot" "$CHROOT/tmp/djos-hook.sh"
chmod +x "$CHROOT/tmp/djos-hook.sh"
chroot "$CHROOT" /tmp/djos-hook.sh
rm -f "$CHROOT/tmp/djos-hook.sh"

echo "==> 基础系统设置"
printf 'DJOS\n' > "$CHROOT/etc/hostname"
grep -q '^127.0.1.1' "$CHROOT/etc/hosts" 2>/dev/null ||
    printf '127.0.1.1\tDJOS\n' >> "$CHROOT/etc/hosts"
mkdir -p "$CHROOT/volume1" "$CHROOT/var/lib/djos" "$CHROOT/var/log/djos"
chmod 755 "$CHROOT/volume1"

echo "==> 生成 initramfs（含 live-boot 支持）"
chroot "$CHROOT" update-initramfs -u -k all

echo "==> 清理 chroot"
rm -f "$CHROOT/usr/sbin/policy-rc.d"
rm -rf "$CHROOT/var/cache/apt/archives"/*.deb "$CHROOT/var/lib/apt/lists"/* \
    "$CHROOT/tmp"/* "$CHROOT/var/tmp"/*
mkdir -p "$CHROOT/proc" "$CHROOT/sys" "$CHROOT/dev" "$CHROOT/run" "$CHROOT/tmp"

echo "==> 拷贝内核与 initrd"
KERNEL="$(find "$CHROOT/boot" -maxdepth 1 -name 'vmlinuz-*' -printf '%f\n' | sort | tail -1)"
INITRD="$(find "$CHROOT/boot" -maxdepth 1 -name 'initrd.img-*' -printf '%f\n' | sort | tail -1)"
[ -n "$KERNEL" ] || { echo "未找到内核镜像" >&2; exit 1; }
[ -n "$INITRD" ] || { echo "未找到 initrd" >&2; exit 1; }
cp "$CHROOT/boot/$KERNEL" "$ISODIR/live/vmlinuz"
cp "$CHROOT/boot/$INITRD" "$ISODIR/live/initrd.img"
echo "    $KERNEL / $INITRD"

echo "==> 生成 squashfs（xz 压缩，耗时较长）"
mksquashfs "$CHROOT" "$ISODIR/live/filesystem.squashfs" \
    -comp xz -b 1M -noappend -no-progress

echo "==> 写入 GRUB 引导菜单"
cat > "$ISODIR/boot/grub/grub.cfg" <<'EOF'
set default=0
set timeout=3

menuentry "DJOS Live 系统" {
    linux /live/vmlinuz boot=live components quiet loglevel=3 console=tty0
    initrd /live/initrd.img
}

menuentry "DJOS Live 系统（安全图形模式）" {
    linux /live/vmlinuz boot=live components quiet loglevel=3 console=tty0 nomodeset
    initrd /live/initrd.img
}
EOF

echo "==> 生成混合引导 ISO（BIOS + UEFI）"
TARGET="$OUT/DJOS-$VERSION-amd64.iso"
rm -f "$TARGET"
grub-mkrescue --output="$TARGET" "$ISODIR" \
    -- -volid "DJOS_$VERSION" -appid DJOS -publisher "DJOS Project"

[ -f "$TARGET" ] || { echo "ISO 生成失败" >&2; exit 1; }
( cd "$OUT" && sha256sum "$(basename "$TARGET")" > "$(basename "$TARGET").sha256" )

echo
echo "✅ 构建完成：$TARGET"
ls -lh "$TARGET"
echo "   校验文件：$TARGET.sha256"
echo "   Windows 写盘：build\\windows\\make-usb.ps1 -Iso \"$TARGET\""

#!/usr/bin/env bash
# 在 Debian 12 / Ubuntu 22.04+ 构建主机上生成可 U 盘直写的 DJOS 混合 ISO。
# 需要 root（live-build 需要挂载与 chroot）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build/live"
OUT="$ROOT/out"
VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"

# 软件源可用环境变量覆盖；默认阿里云（国内外均可访问，deb.debian.org 在部分网络下不可达）
MIRROR="${DJOS_MIRROR:-https://mirrors.aliyun.com/debian}"
MIRROR_SEC="${DJOS_MIRROR_SECURITY:-https://mirrors.aliyun.com/debian-security}"

if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 root 运行：sudo ./build/build-iso.sh" >&2
    exit 1
fi

for cmd in lb xorriso mksquashfs; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "缺少构建工具：$cmd。请安装 live-build xorriso squashfs-tools。" >&2
        exit 1
    }
done

echo "==> 清理旧构建"
rm -rf "$BUILD"
mkdir -p "$BUILD" "$OUT"

cd "$BUILD"
echo "==> 初始化 live-build (Debian 12 bookworm / amd64)"
lb --version 2>&1 | head -1 || true

# Debian 版 live-build 对 bookworm 安全源 Suite 处理不一致：
# 有的版本仍会生成已废弃的 bookworm/updates（apt update 404），进而导致
# chroot 内包列表为空、所有软件包 "Unable to locate package"。
# 因此统一由脚本显式给出 main / updates / security 三条源。
SYS_SOURCES="deb $MIRROR bookworm main contrib non-free non-free-firmware
deb $MIRROR bookworm-updates main contrib non-free non-free-firmware
deb $MIRROR_SEC bookworm-security main contrib non-free non-free-firmware"

SEC_OPTS=""
if lb config --help 2>/dev/null | grep -q -- '--security'; then
    SEC_OPTS="--security false"
    echo "    检测到 --security 选项：关闭自动安全源（由脚本自行写入）"
else
    echo "    未检测到 --security 选项：将由脚本覆盖生成的源"
fi

lb config noauto \
    --mode debian \
    --distribution bookworm \
    --architecture amd64 \
    --archive-areas "main contrib non-free non-free-firmware" \
    --binary-images iso-hybrid \
    --debian-installer false \
    --initsystem systemd \
    --memtest none \
    --linux-flavours amd64 \
    --bootappend-live "boot=live components quiet loglevel=3 console=tty0 live-config.autologin=lightdm live-config.username=djos" \
    --mirror-bootstrap "$MIRROR" \
    --mirror-chroot "$MIRROR" \
    --mirror-chroot-security "$MIRROR_SEC" \
    --mirror-binary "$MIRROR" \
    --mirror-binary-security "$MIRROR_SEC" \
    --iso-application "DJOS" \
    --iso-publisher "DJOS Project" \
    --iso-volume "DJOS $VERSION" \
    $SEC_OPTS

echo "==> 注入 DJOS 文件"
# 兜底：任何仍带 bookworm/updates 的配置统一改成 bookworm-security
LBFIX=$(grep -rl 'bookworm/updates' config 2>/dev/null || true)
if [ -n "$LBFIX" ]; then
    echo "$LBFIX" | while read -r f; do sed -i 's#bookworm/updates#bookworm-security#g' "$f"; done
    echo "    已修正安全源 Suite：$LBFIX"
fi

# 完整软件源写入 sources.list.d，chroot 阶段即使 live-build 重写
# /etc/apt/sources.list 也不会影响这里，保证 apt 一定能取到包列表。
mkdir -p config/archives
printf '%s\n' "$SYS_SOURCES" > config/archives/djos.list.chroot
echo "    已写入软件源：config/archives/djos.list.chroot"

mkdir -p config/includes.chroot
cp -a "$ROOT/build/includes.chroot/." config/includes.chroot/

mkdir -p config/includes.chroot/opt/djos/{api,web,installer,packages}
cp -a "$ROOT/src/api/." config/includes.chroot/opt/djos/api/
cp -a "$ROOT/src/web/." config/includes.chroot/opt/djos/web/
cp -a "$ROOT/src/installer/." config/includes.chroot/opt/djos/installer/
cp -a "$ROOT/packages/." config/includes.chroot/opt/djos/packages/
cp "$ROOT/VERSION" config/includes.chroot/opt/djos/VERSION

mkdir -p config/package-lists
cp "$ROOT/build/package-lists/djos.list.chroot" config/package-lists/

mkdir -p config/hooks/live
cp "$ROOT/build/hooks/0100-djos.hook.chroot" config/hooks/live/
chmod +x config/hooks/live/0100-djos.hook.chroot

mkdir -p config/hooks/binary
cp "$ROOT/build/hooks/0500-grub-timeout.hook.binary" config/hooks/binary/
chmod +x config/hooks/binary/0500-grub-timeout.hook.binary

# 引导菜单超时：live-build 默认无限等待，导致开机卡在 GRUB 菜单。
# 主保险：直接修改构建机 live-build 模板（无论字面量还是变量占位，统一改成 5 秒）。
LB_TPL="/usr/share/live/build/bootloaders"
if [ -d "$LB_TPL" ]; then
    find "$LB_TPL" -type f \( -name 'grub.cfg*' -o -name '*.in' \) -print0 |
        xargs -0 -r sed -i -E 's/^set timeout=.*/set timeout=5/; s/\$\{LB_BOOTLOADERS_TIMEOUT\}/5/g' || true
    echo "    已将 live-build 引导模板 timeout 设为 5 秒"
else
    echo "    未找到 $LB_TPL（依赖 binary hook 兜底）"
fi

dump_apt_state() {
    echo "---- 诊断：chroot 软件源 ----"
    cat chroot/etc/apt/sources.list 2>/dev/null || echo "(chroot/etc/apt/sources.list 不存在)"
    for f in chroot/etc/apt/sources.list.d/*; do
        [ -f "$f" ] || continue
        echo "[$f]"
        cat "$f"
    done
    echo "---- 诊断：chroot apt 包列表 ----"
    ls chroot/var/lib/apt/lists 2>/dev/null | head -20 || echo "(无)"
    echo "---- 诊断结束 ----"
}
trap dump_apt_state ERR

echo "==> 引导阶段 lb bootstrap"
lb bootstrap

echo "==> 校验并强制写入 chroot 软件源"
mkdir -p chroot/etc/apt/sources.list.d
printf '%s\n' "$SYS_SOURCES" > chroot/etc/apt/sources.list
printf '%s\n' "$SYS_SOURCES" > chroot/etc/apt/sources.list.d/djos.list
dump_apt_state

echo "==> chroot 内预取包列表"
chroot chroot apt-get update 2>&1 | tail -n 20 || true

echo "==> chroot 阶段（安装软件包，耗时最长）"
if ! lb chroot; then
    echo "!! chroot 阶段失败，修正软件源后重试一次"
    dump_apt_state
    printf '%s\n' "$SYS_SOURCES" > chroot/etc/apt/sources.list
    printf '%s\n' "$SYS_SOURCES" > chroot/etc/apt/sources.list.d/djos.list
    chroot chroot apt-get update 2>&1 | tail -n 20 || true
    lb chroot
fi

echo "==> binary 阶段（生成 ISO）"
lb binary

echo "==> 修正引导菜单超时（5 秒自动进入 Live）"
# GRUB 配置链（grub.cfg/config.cfg/theme.cfg）中无 set timeout 时默认无限等待；
# 在渲染产物 binary/boot/grub/config.cfg 尾部追加 timeout=5，再用 live-build
# 官方 binary_iso 重打包（保留完整 BIOS/UEFI 引导记录；绝不用 xorriso 就地改 ISO）。
if [ -f binary/boot/grub/config.cfg ]; then
    sed -i -E 's/^set timeout=.*/set timeout=5/' binary/boot/grub/config.cfg binary/boot/grub/theme.cfg 2>/dev/null || true
    grep -q "^set timeout" binary/boot/grub/config.cfg || printf '\nset timeout=5\n' >> binary/boot/grub/config.cfg
    echo "    timeout=5 已写入渲染产物，重新打包 ISO"
    rm -f "$OUT"/live-image-*.iso "$OUT"/binary.hybrid.iso "$OUT"/binary.iso
    lb binary_iso
else
    echo "    未找到 binary/boot/grub/config.cfg，跳过超时修正"
fi

ISO=""
for candidate in "live-image-amd64.hybrid.iso" "DJOS-$VERSION-amd64.hybrid.iso" \
    "DJOS-$VERSION-amd64.iso"; do
    if [ -f "$candidate" ]; then
        ISO="$candidate"
        break
    fi
done
if [ -z "$ISO" ]; then
    ISO="$(find . -maxdepth 1 -name '*.iso' -print -quit)"
fi
[ -n "$ISO" ] || {
    echo "构建完成但未找到 ISO 文件" >&2
    exit 1
}

TARGET="$OUT/DJOS-$VERSION-amd64.iso"
mv "$ISO" "$TARGET"
( cd "$OUT" && sha256sum "$(basename "$TARGET")" > "$(basename "$TARGET").sha256" )

echo
echo "✅ 构建完成：$TARGET"
echo "   校验文件：$TARGET.sha256"
echo "   Windows 写盘：build\\windows\\make-usb.ps1 -Iso \"$TARGET\""

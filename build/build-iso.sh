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
lb --version || true
# 注意：不同发行版的 live-build 版本差异较大，这里只使用各版本都支持的选项；
# iso-hybrid + amd64 的默认引导器即为 syslinux + grub-efi（BIOS/UEFI 双引导）。
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
    --bootappend-live "boot=live components quiet loglevel=3 console=tty0" \
    --mirror-bootstrap "$MIRROR" \
    --mirror-chroot "$MIRROR" \
    --mirror-chroot-security "$MIRROR_SEC" \
    --mirror-binary "$MIRROR" \
    --mirror-binary-security "$MIRROR_SEC" \
    --iso-application "DJOS" \
    --iso-publisher "DJOS Project" \
    --iso-volume "DJOS $VERSION"

echo "==> 注入 DJOS 文件"
# 旧版 live-build 会把安全源 Suite 拼成 <dist>/updates（bookworm/updates 已不存在，会 404），
# 这里统一改为 Debian 12 实际使用的 bookworm-security。
LBFIX=$(grep -rl 'bookworm/updates' config 2>/dev/null || true)
if [ -n "$LBFIX" ]; then
    echo "$LBFIX" | while read -r f; do sed -i 's#bookworm/updates#bookworm-security#g' "$f"; done
    echo "    已修正安全源 Suite：$LBFIX"
fi

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

echo "==> 开始构建（首次构建需下载软件包，耗时较长）"
lb build

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

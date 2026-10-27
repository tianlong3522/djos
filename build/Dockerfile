# 用容器构建 DJOS ISO（适用于 Linux/macOS/Windows + Docker Desktop）
# 用法：
#   docker build -t djos-builder .
#   docker run --rm --privileged -v "$PWD/out:/project/out" djos-builder
FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    live-build \
    xorriso \
    isolinux \
    syslinux-common \
    syslinux-efi \
    grub-pc-bin \
    grub-efi-amd64-bin \
    mtools \
    dosfstools \
    squashfs-tools \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /project
COPY . /project
RUN chmod +x /project/build/build-iso.sh

CMD ["/project/build/build-iso.sh"]

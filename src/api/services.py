"""DJOS 服务编排：把数据库中的共享/用户配置落地到 Samba、NFS 与系统账户。"""
from __future__ import annotations

import os
import re
import subprocess
import threading
from typing import Any

from system import run

_LOCK = threading.Lock()
SAMBA_INCLUDE = "/etc/samba/djos.conf"
SAMBA_MAIN = "/etc/samba/smb.conf"
NFS_EXPORT = "/etc/exports.d/djos.exports"
DJOS_GROUP = "djos"


def _write(path: str, content: str, mode: int = 0o644) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(content)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def _ensure_group() -> None:
    code, _, _ = run(["getent", "group", DJOS_GROUP])
    if code != 0:
        run(["groupadd", "-r", DJOS_GROUP])


def ensure_share_dirs(shares: list[dict[str, Any]]) -> None:
    for share in shares:
        path = share["path"]
        try:
            os.makedirs(path, exist_ok=True)
            os.chmod(path, 0o2775)
            run(["chgrp", "-R", DJOS_GROUP, path], timeout=30)
        except OSError:
            continue
        if share.get("recycle"):
            recycle = os.path.join(path, "#recycle")
            os.makedirs(recycle, exist_ok=True)
            try:
                os.chmod(recycle, 0o2775)
            except OSError:
                pass


def render_samba(shares: list[dict[str, Any]]) -> str:
    lines = [
        "# 由 DJOS 自动生成，请勿手工编辑",
        "[global]",
        "   workgroup = DJOS",
        "   server string = DJOS NAS",
        "   server min protocol = SMB2",
        "   map to guest = never",
        "   obey pam restrictions = yes",
        "   unix charset = UTF-8",
        "",
    ]
    for share in shares:
        if not share.get("smb"):
            continue
        lines.extend(
            [
                f"[{share['name']}]",
                f"   path = {share['path']}",
                f"   comment = {share.get('comment') or share['name']}",
                "   browseable = yes",
                "   guest ok = no",
                f"   read only = {'yes' if share.get('readonly') else 'no'}",
                f"   valid users = @{DJOS_GROUP}",
                "   create mask = 0664",
                "   directory mask = 2775",
            ]
        )
        if share.get("recycle"):
            lines.extend(
                [
                    "   vfs objects = recycle",
                    "   recycle:repository = #recycle",
                    "   recycle:keeptree = yes",
                    "   recycle:versions = yes",
                ]
            )
        lines.append("")
    content = "\n".join(lines)
    _write(SAMBA_INCLUDE, content)
    _ensure_samba_include()
    reload_samba()
    return content


def _ensure_samba_include() -> None:
    try:
        with open(SAMBA_MAIN, "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read()
    except OSError:
        return
    if SAMBA_INCLUDE in content or "djos.conf" in content:
        return
    if "[global]" in content:
        content = content.replace(
            "[global]", f"[global]\n   include = {SAMBA_INCLUDE}", 1
        )
    else:
        content = f"[global]\n   include = {SAMBA_INCLUDE}\n\n" + content
    try:
        _write(SAMBA_MAIN, content)
    except OSError:
        pass


def render_nfs(shares: list[dict[str, Any]]) -> str:
    lines = ["# 由 DJOS 自动生成，请勿手工编辑"]
    for share in shares:
        if not share.get("nfs"):
            continue
        flags = "ro" if share.get("readonly") else "rw"
        lines.append(
            f"{share['path']} *(async,{flags},sync,no_subtree_check,all_squash,anonuid=1000,anongid=1000)"
        )
    content = "\n".join(lines) + "\n"
    _write(NFS_EXPORT, content)
    run(["exportfs", "-ra"], timeout=20)
    return content


def apply_all(shares: list[dict[str, Any]]) -> None:
    with _LOCK:
        _ensure_group()
        ensure_share_dirs(shares)
        render_samba(shares)
        render_nfs(shares)


def reload_samba() -> None:
    code, _, _ = run(["smbcontrol", "all", "reload-config"], timeout=15)
    if code != 0:
        run(["systemctl", "reload-or-restart", "smbd"], timeout=30)


def reload_nfs() -> None:
    run(["exportfs", "-ra"], timeout=20)


def create_system_user(username: str, password: str, admin: bool = False) -> list[str]:
    warnings: list[str] = []
    if not re.match(r"^[a-z][a-z0-9_-]{1,31}$", username):
        return ["用户名不符合系统规则"]
    code, _, err = run(["getent", "passwd", username])
    if code == 0:
        warnings.append("同名系统账户已存在")
    else:
        home = f"/volume1/home/{username}"
        os.makedirs(home, exist_ok=True)
        cmd = ["useradd", "-m", "-d", home, "-s", "/bin/bash"]
        if admin:
            cmd += ["-G", "sudo,docker"]
        cmd.append(username)
        code, _, err = run(cmd)
        if code != 0:
            return [f"创建系统账户失败：{err or code}"]
        try:
            os.chmod(home, 0o2750)
        except OSError:
            pass
    run(["usermod", "-aG", DJOS_GROUP, username])
    if admin:
        run(["usermod", "-aG", "sudo,docker", username])
    try:
        proc = subprocess.run(
            ["chpasswd"],
            input=f"{username}:{password}\n",
            text=True,
            capture_output=True,
            timeout=15,
        )
        if proc.returncode != 0:
            warnings.append("同步系统密码失败")
    except (OSError, subprocess.SubprocessError):
        warnings.append("同步系统密码失败")
    try:
        proc = subprocess.run(
            ["smbpasswd", "-a", "-s", username],
            input=f"{password}\n{password}\n",
            text=True,
            capture_output=True,
            timeout=20,
        )
        if proc.returncode != 0:
            warnings.append("同步 Samba 密码失败（smbd 可能未启动）")
    except (OSError, subprocess.SubprocessError):
        warnings.append("同步 Samba 密码失败")
    return warnings


def set_system_password(username: str, password: str) -> list[str]:
    warnings: list[str] = []
    try:
        proc = subprocess.run(
            ["chpasswd"],
            input=f"{username}:{password}\n",
            text=True,
            capture_output=True,
            timeout=15,
        )
        if proc.returncode != 0:
            warnings.append("系统密码更新失败")
    except (OSError, subprocess.SubprocessError):
        warnings.append("系统密码更新失败")
    try:
        proc = subprocess.run(
            ["smbpasswd", "-a", "-s", username],
            input=f"{password}\n{password}\n",
            text=True,
            capture_output=True,
            timeout=20,
        )
        if proc.returncode != 0:
            warnings.append("Samba 密码更新失败")
    except (OSError, subprocess.SubprocessError):
        warnings.append("Samba 密码更新失败")
    return warnings


def set_admin(username: str, admin: bool) -> None:
    for group in ("sudo", "docker"):
        if admin:
            run(["usermod", "-aG", group, username], timeout=15)
        else:
            run(["gpasswd", "-d", username, group], timeout=15)


def set_disabled(username: str, disabled: bool) -> None:
    run(["usermod", "-L" if disabled else "-U", username], timeout=15)


def delete_system_user(username: str) -> list[str]:
    if username == "admin":
        return ["内置管理员不可删除"]
    warnings: list[str] = []
    code, _, err = run(["userdel", username], timeout=20)
    if code != 0:
        warnings.append(f"删除系统账户失败：{err}")
    run(["smbpasswd", "-x", username], timeout=15)
    return warnings


def apply_hostname(hostname: str) -> None:
    if not re.match(r"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$", hostname):
        return
    run(["hostnamectl", "set-hostname", hostname], timeout=15)
    try:
        _write("/etc/hostname", hostname + "\n")
        with open("/etc/hosts", "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read()
        if "127.0.1.1" in content:
            content = re.sub(r"127\.0\.1\.1\s+\S+", f"127.0.1.1\t{hostname}", content)
        else:
            content += f"\n127.0.1.1\t{hostname}\n"
        _write("/etc/hosts", content)
    except OSError:
        pass


def apply_timezone(timezone: str) -> None:
    if not re.match(r"^[A-Za-z]+/[A-Za-z0-9_+-]+$", timezone):
        return
    run(["timedatectl", "set-timezone", timezone], timeout=15)


def ssh_enable(enabled: bool) -> None:
    action = "enable" if enabled else "disable"
    run(["systemctl", action, "--now", "ssh"], timeout=30)


def reboot() -> None:
    subprocess.Popen(["systemctl", "reboot"], start_new_session=True)


def poweroff() -> None:
    subprocess.Popen(["systemctl", "poweroff"], start_new_session=True)

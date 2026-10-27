#!/usr/bin/env python3
"""DJOS Web 管理 API。

运行于已安装的 DJOS 系统，使用 Flask + Gunicorn。
所有特权操作均由本进程以 root 执行，因此只允许通过已认证会话访问。
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import threading
import time
from functools import wraps
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, request, send_file, send_from_directory, session

import backup
import db
import services
import system

BASE = Path(__file__).resolve().parent
WEB_DIR = BASE.parent / "web"
VERSION_PATH = BASE.parent / "VERSION"
VERSION = VERSION_PATH.read_text(encoding="utf-8").strip() if VERSION_PATH.exists() else "1.0.0"
FAILED_LOGINS: dict[str, list[float]] = {}
LOGIN_LOCK = threading.Lock()


def _load_secret() -> str:
    path = Path("/etc/djos/secret.key")
    try:
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
        path.parent.mkdir(parents=True, exist_ok=True)
        value = secrets.token_hex(32)
        path.write_text(value, encoding="utf-8")
        os.chmod(path, 0o600)
        return value
    except OSError:
        return secrets.token_hex(32)


app = Flask(__name__, static_folder=None)
app.secret_key = _load_secret()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=12 * 3600,
    MAX_CONTENT_LENGTH=None,
)
db.init_db()


# --------------------------------------------------------------------------- #
# 通用工具
# --------------------------------------------------------------------------- #
def body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def ok(**payload: Any):
    return jsonify({"ok": True, **payload})


def fail(message: str, status: int = 400, code: str = ""):
    payload = {"ok": False, "error": message}
    if code:
        payload["code"] = code
    return jsonify(payload), status


def current_user() -> dict[str, Any] | None:
    uid = session.get("uid")
    if not uid:
        return None
    return db.query("SELECT * FROM users WHERE id=?", (uid,), one=True)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("uid"):
            return fail("登录状态已失效，请重新登录", 401, "unauthenticated")
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return fail("登录状态已失效，请重新登录", 401, "unauthenticated")
        if user["role"] != "admin":
            return fail("需要管理员权限", 403, "forbidden")
        return fn(*args, **kwargs)

    return wrapper


@app.before_request
def guard():
    path = request.path
    if not path.startswith("/api/"):
        return None
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and path != "/api/auth/login":
        if session.get("uid"):
            token = request.headers.get("X-DJOS-CSRF", "")
            if not token or not secrets.compare_digest(token, session.get("csrf", "")):
                return fail("CSRF 校验失败，请刷新页面", 403, "csrf")

    user = current_user()
    if user and user["must_change"]:
        allowed = (
            path.startswith("/api/auth/")
            or path in ("/api/dashboard", "/api/system/status", "/api/system/info", "/api/health")
        )
        if not allowed:
            return fail("请先修改初始管理员密码", 403, "must_change_password")
    return None


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


# --------------------------------------------------------------------------- #
# 认证
# --------------------------------------------------------------------------- #
@app.post("/api/auth/login")
def login():
    data = body()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if not username or not password:
        return fail("请输入用户名和密码")

    ip = request.headers.get("X-Real-IP", request.remote_addr or "unknown")
    now = time.monotonic()
    with LOGIN_LOCK:
        recent = [stamp for stamp in FAILED_LOGINS.get(ip, []) if now - stamp < 300]
        FAILED_LOGINS[ip] = recent
        if len(recent) >= 10:
            return fail("尝试次数过多，请 5 分钟后再试", 429)

    user = db.query("SELECT * FROM users WHERE username=?", (username,), one=True)
    if not user or user["disabled"] or not db.verify_password(password, user["password"]):
        with LOGIN_LOCK:
            FAILED_LOGINS.setdefault(ip, []).append(now)
        db.audit(username or "-", "login_failed", ip)
        return fail("用户名或密码错误", 401)

    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    session["csrf"] = secrets.token_urlsafe(24)
    db.execute("UPDATE users SET last_login=? WHERE id=?", (db.now(), user["id"]))
    db.audit(username, "login", ip)
    return ok(
        user=db.user_public(user),
        csrf=session["csrf"],
        version=VERSION,
    )


@app.post("/api/auth/logout")
@login_required
def logout():
    user = current_user()
    db.audit(user["username"] if user else "-", "logout")
    session.clear()
    return ok()


@app.get("/api/auth/me")
def me():
    user = current_user()
    if not user:
        return fail("未登录", 401, "unauthenticated")
    if not session.get("csrf"):
        session["csrf"] = secrets.token_urlsafe(24)
    return ok(
        user=db.user_public(user),
        csrf=session["csrf"],
        version=VERSION,
        hostname=db.get_setting("hostname", "DJOS"),
    )


@app.post("/api/auth/password")
@login_required
def change_password():
    data = body()
    old = str(data.get("old_password", ""))
    new = str(data.get("new_password", ""))
    user = current_user()
    if not db.verify_password(old, user["password"]):
        return fail("当前密码不正确")
    if len(new) < 8:
        return fail("新密码至少 8 位")
    if new == old:
        return fail("新密码不能与当前密码相同")
    db.execute(
        "UPDATE users SET password=?, must_change=0 WHERE id=?",
        (db.hash_password(new), user["id"]),
    )
    warnings = services.set_system_password(user["username"], new)
    db.audit(user["username"], "change_password")
    return ok(warnings=warnings)


# --------------------------------------------------------------------------- #
# 概览与系统
# --------------------------------------------------------------------------- #
@app.get("/api/dashboard")
@login_required
def dashboard():
    state = system.status()
    volumes = db.query("SELECT name, mountpoint, fs FROM volumes ORDER BY name")
    usage = {item["mountpoint"]: item for item in state["volumes"]}
    for volume in volumes:
        info = usage.get(volume["mountpoint"], {})
        volume.update(
            {
                "total": info.get("total", 0),
                "used": info.get("used", 0),
                "free": info.get("free", 0),
                "percent": info.get("percent", 0),
                "mounted": bool(info),
            }
        )
    state["volumes"] = volumes
    state["version"] = VERSION
    state["model"] = db.get_setting("model", "DJOS NAS")
    return ok(data=state)


@app.get("/api/system/status")
@login_required
def system_status():
    return ok(data=system.status())


@app.get("/api/system/info")
@login_required
def system_info():
    data = system.info()
    data["settings"] = {
        "hostname": db.get_setting("hostname", data["hostname"]),
        "timezone": db.get_setting("timezone", "Asia/Shanghai"),
        "ssh_enabled": db.get_setting("ssh_enabled", "0") == "1",
        "auto_update": db.get_setting("auto_update", "0") == "1",
    }
    return ok(data=data)


@app.get("/api/system/network")
@login_required
def system_network():
    return ok(
        data={
            "interfaces": system.network_interfaces(),
            "gateway": system.default_gateway(),
            "dns": system.dns_servers(),
            "hostname": db.get_setting("hostname", "DJOS"),
        }
    )


@app.get("/api/system/logs")
@admin_required
def system_logs():
    try:
        lines = int(request.args.get("lines", "200"))
    except ValueError:
        lines = 200
    return ok(data={"lines": system.logs(lines)})


@app.get("/api/system/audit")
@admin_required
def system_audit():
    rows = db.query("SELECT * FROM audit ORDER BY id DESC LIMIT 100")
    return ok(data=rows)


@app.post("/api/system/hostname")
@admin_required
def set_hostname():
    name = str(body().get("hostname", "")).strip()
    if not re.match(r"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$", name):
        return fail("主机名只能包含字母、数字和连字符，长度 1-63")
    db.set_setting("hostname", name)
    services.apply_hostname(name)
    db.audit(current_user()["username"], "set_hostname", name)
    return ok(hostname=name)


@app.post("/api/system/timezone")
@admin_required
def set_timezone():
    zone = str(body().get("timezone", "")).strip()
    if not re.match(r"^[A-Za-z]+/[A-Za-z0-9_+-]+$", zone):
        return fail("时区格式不正确")
    db.set_setting("timezone", zone)
    services.apply_timezone(zone)
    db.audit(current_user()["username"], "set_timezone", zone)
    return ok(timezone=zone)


@app.post("/api/system/ssh")
@admin_required
def set_ssh():
    enabled = bool(body().get("enabled"))
    services.ssh_enable(enabled)
    db.set_setting("ssh_enabled", "1" if enabled else "0")
    db.audit(current_user()["username"], "set_ssh", str(enabled))
    return ok(enabled=enabled)


@app.post("/api/system/reboot")
@admin_required
def reboot():
    db.audit(current_user()["username"], "reboot")
    threading.Timer(1.2, services.reboot).start()
    return ok(message="系统将在数秒后重启")


@app.post("/api/system/shutdown")
@admin_required
def shutdown():
    db.audit(current_user()["username"], "shutdown")
    threading.Timer(1.2, services.poweroff).start()
    return ok(message="系统将在数秒后关机")


# --------------------------------------------------------------------------- #
# 存储
# --------------------------------------------------------------------------- #
def _volume_rows() -> list[dict[str, Any]]:
    rows = db.query("SELECT * FROM volumes ORDER BY name")
    usage = {item["mountpoint"]: item for item in system.volumes()}
    for row in rows:
        info = usage.get(row["mountpoint"], {})
        row.update(
            {
                "total": info.get("total", 0),
                "used": info.get("used", 0),
                "free": info.get("free", 0),
                "percent": info.get("percent", 0),
                "mounted": bool(info),
                "disks": [d for d in row["disks"].split(",") if d],
            }
        )
    return rows


@app.get("/api/storage/disks")
@admin_required
def storage_disks():
    return ok(data=system.disk_list())


@app.get("/api/storage/volumes")
@admin_required
def storage_volumes():
    return ok(data=_volume_rows())


def _append_fstab(line: str) -> None:
    try:
        with open("/etc/fstab", "a", encoding="utf-8") as fh:
            fh.write(line.rstrip("\n") + "\n")
    except OSError:
        pass


@app.post("/api/storage/volumes")
@admin_required
def create_volume():
    data = body()
    name = str(data.get("name", "")).strip()
    mode = str(data.get("mode", "single"))
    disks = [str(item) for item in data.get("disks", []) if str(item).startswith("/dev/")]
    if not re.match(r"^volume\d+$", name) or name == "volume1":
        return fail("存储池名称必须为 volume2 及以上的 volumeN 格式")
    if mode not in ("single", "raid1", "raid0"):
        return fail("不支持的阵列类型")
    if mode == "single" and len(disks) != 1:
        return fail("单盘模式需要恰好一块磁盘")
    if mode != "single" and len(disks) < 2:
        return fail("RAID 模式至少需要两块磁盘")
    if str(data.get("confirm", "")) != "ERASE":
        return fail("请确认已备份数据并输入 ERASE")
    if db.query("SELECT id FROM volumes WHERE name=? OR mountpoint=?", (name, f"/{name}"), one=True):
        return fail("同名存储池已存在", 409)
    if os.path.exists(f"/{name}"):
        return fail("挂载点已存在", 409)

    available = {item["path"]: item for item in system.disk_list()}
    for disk in disks:
        info = available.get(disk)
        if not info:
            return fail(f"{disk} 不是可用的整块磁盘")
        if info["mountpoints"] or any(p["mountpoints"] for p in info["partitions"]):
            return fail(f"{disk} 正在被使用，无法创建存储池")

    mountpoint = f"/{name}"
    if mode == "single":
        cmd = ["mkfs.btrfs", "-f", "-L", name, disks[0]]
    else:
        profile = "raid1" if mode == "raid1" else "raid0"
        cmd = ["mkfs.btrfs", "-f", "-d", profile, "-m", profile, "-L", name, *disks]
    code, _, err = system.run(cmd, timeout=1800)
    if code != 0:
        return fail(f"创建文件系统失败：{err}")

    os.makedirs(mountpoint, exist_ok=True)
    code, _, err = system.run(
        ["mount", "-o", "compress=zstd:3", disks[0], mountpoint], timeout=60
    )
    if code != 0:
        return fail(f"挂载失败：{err}")
    code, uuid, _ = system.run(["blkid", "-s", "UUID", "-o", "value", disks[0]])
    if code == 0 and uuid:
        _append_fstab(
            f"UUID={uuid} {mountpoint} btrfs defaults,noatime,compress=zstd:3 0 0"
        )
    db.execute(
        "INSERT INTO volumes(name, mountpoint, disks, fs, created_at) VALUES(?,?,?,?,?)",
        (name, mountpoint, ",".join(disks), "btrfs", db.now()),
    )
    db.audit(current_user()["username"], "create_volume", f"{name} {mode} {' '.join(disks)}")
    return ok(volume=name)


@app.delete("/api/storage/volumes/<name>")
@admin_required
def delete_volume(name: str):
    if not re.match(r"^volume\d+$", name) or name == "volume1":
        return fail("系统存储池 volume1 不可移除")
    row = db.query("SELECT * FROM volumes WHERE name=?", (name,), one=True)
    if not row:
        return fail("存储池不存在", 404)
    mountpoint = row["mountpoint"]
    system.run(["umount", "-l", mountpoint], timeout=60)
    try:
        with open("/etc/fstab", "r", encoding="utf-8") as fh:
            lines = fh.readlines()
        with open("/etc/fstab", "w", encoding="utf-8") as fh:
            fh.writelines(line for line in lines if mountpoint not in line)
    except OSError:
        pass
    db.execute("DELETE FROM volumes WHERE id=?", (row["id"],))
    db.audit(current_user()["username"], "delete_volume", name)
    try:
        os.rmdir(mountpoint)
    except OSError:
        pass
    return ok(message="存储池已卸载并移除，磁盘数据未被擦除")


@app.get("/api/storage/smart")
@admin_required
def smart_info():
    device = request.args.get("device", "")
    return ok(data=system.smart(device))


@app.post("/api/storage/smart/test")
@admin_required
def smart_test():
    device = str(body().get("device", ""))
    if not re.match(r"^/dev/(sd[a-z]+|nvme\d+n\d+)$", device):
        return fail("设备路径不合法")
    code, out, err = system.run(["smartctl", "-t", "short", device], timeout=60)
    if code != 0:
        return fail(err or out or "SMART 自检启动失败")
    return ok(message="SMART 短自检已启动，约 2 分钟后可在详情中查看")


@app.get("/api/storage/snapshots")
@admin_required
def list_snapshots():
    base = "/volume1/@snapshots"
    items: list[dict[str, Any]] = []
    if os.path.isdir(base):
        for job_name in sorted(os.listdir(base)):
            job_dir = os.path.join(base, job_name)
            if not os.path.isdir(job_dir):
                continue
            for name in sorted(os.listdir(job_dir), reverse=True):
                path = os.path.join(job_dir, name)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                items.append(
                    {
                        "job": job_name,
                        "name": name,
                        "path": path,
                        "created": int(stat.st_mtime),
                    }
                )
    return ok(data=items[:200])


@app.post("/api/storage/snapshots")
@admin_required
def create_snapshot():
    data = body()
    source = system.safe_volume_path(str(data.get("source", "")))
    name = re.sub(r"[^A-Za-z0-9_.-]", "-", str(data.get("name", ""))).strip("-")
    if not source or not os.path.isdir(source):
        return fail("源目录不存在")
    if not name:
        return fail("请输入快照名称")
    base = "/volume1/@snapshots/manual"
    os.makedirs(base, exist_ok=True)
    target = os.path.join(base, f"{name}-{time.strftime('%Y%m%d-%H%M%S')}")
    code, _, err = system.run(["btrfs", "subvolume", "snapshot", "-r", source, target], timeout=600)
    if code != 0:
        return fail(f"创建快照失败：{err}")
    db.audit(current_user()["username"], "create_snapshot", target)
    return ok(path=target)


@app.delete("/api/storage/snapshots")
@admin_required
def delete_snapshot():
    path = str(body().get("path", ""))
    base = os.path.realpath("/volume1/@snapshots")
    resolved = os.path.realpath(path)
    if not resolved.startswith(base + os.sep):
        return fail("快照路径不合法")
    code, _, err = system.run(["btrfs", "subvolume", "delete", resolved], timeout=120)
    if code != 0:
        return fail(f"删除快照失败：{err}")
    db.audit(current_user()["username"], "delete_snapshot", resolved)
    return ok()


# --------------------------------------------------------------------------- #
# 共享文件夹
# --------------------------------------------------------------------------- #
def _shares() -> list[dict[str, Any]]:
    rows = db.query("SELECT * FROM shares ORDER BY name")
    for row in rows:
        row["smb"] = bool(row["smb"])
        row["nfs"] = bool(row["nfs"])
        row["recycle"] = bool(row["recycle"])
        row["readonly"] = bool(row["readonly"])
        row["exists"] = os.path.isdir(row["path"])
    return rows


@app.get("/api/shares")
@login_required
def get_shares():
    return ok(data=_shares())


@app.post("/api/shares")
@admin_required
def create_share():
    data = body()
    name = str(data.get("name", "")).strip()
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,30}$", name):
        return fail("共享名称只能包含字母、数字、下划线、点与连字符")
    if db.query("SELECT id FROM shares WHERE name=?", (name,), one=True):
        return fail("共享名称已存在", 409)
    path = f"/volume1/{name}"
    try:
        os.makedirs(path, exist_ok=True)
        os.chmod(path, 0o2775)
    except OSError as exc:
        return fail(f"创建目录失败：{exc}")
    db.execute(
        "INSERT INTO shares(name, path, comment, smb, nfs, recycle, readonly, created_at) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (
            name,
            path,
            str(data.get("comment", ""))[:120],
            int(bool(data.get("smb", True))),
            int(bool(data.get("nfs", False))),
            int(bool(data.get("recycle", True))),
            int(bool(data.get("readonly", False))),
            db.now(),
        ),
    )
    services.apply_all(_shares_raw())
    db.audit(current_user()["username"], "create_share", name)
    return ok()


def _shares_raw() -> list[dict[str, Any]]:
    return db.query("SELECT * FROM shares ORDER BY name")


@app.patch("/api/shares/<int:share_id>")
@admin_required
def update_share(share_id: int):
    row = db.query("SELECT * FROM shares WHERE id=?", (share_id,), one=True)
    if not row:
        return fail("共享不存在", 404)
    data = body()
    fields = {
        "comment": str(data.get("comment", row["comment"]))[:120],
        "smb": int(bool(data.get("smb", row["smb"]))),
        "nfs": int(bool(data.get("nfs", row["nfs"]))),
        "recycle": int(bool(data.get("recycle", row["recycle"]))),
        "readonly": int(bool(data.get("readonly", row["readonly"]))),
    }
    db.execute(
        "UPDATE shares SET comment=?, smb=?, nfs=?, recycle=?, readonly=? WHERE id=?",
        (
            fields["comment"],
            fields["smb"],
            fields["nfs"],
            fields["recycle"],
            fields["readonly"],
            share_id,
        ),
    )
    services.apply_all(_shares_raw())
    db.audit(current_user()["username"], "update_share", row["name"])
    return ok()


@app.delete("/api/shares/<int:share_id>")
@admin_required
def delete_share(share_id: int):
    row = db.query("SELECT * FROM shares WHERE id=?", (share_id,), one=True)
    if not row:
        return fail("共享不存在", 404)
    if row["name"] == "public":
        return fail("默认公共共享不可删除")
    db.execute("DELETE FROM shares WHERE id=?", (share_id,))
    services.apply_all(_shares_raw())
    db.audit(current_user()["username"], "delete_share", row["name"])
    return ok(message="共享已移除，磁盘文件仍保留在原路径")


# --------------------------------------------------------------------------- #
# 文件站
# --------------------------------------------------------------------------- #
def _entry(path: str) -> dict[str, Any]:
    try:
        stat = os.stat(path, follow_symlinks=False)
    except OSError:
        return {}
    is_dir = os.path.isdir(path)
    return {
        "name": os.path.basename(path),
        "path": path,
        "type": "dir" if is_dir else "file",
        "size": 0 if is_dir else stat.st_size,
        "mtime": int(stat.st_mtime),
        "mode": oct(stat.st_mode & 0o777)[2:],
        "extension": "" if is_dir else os.path.splitext(path)[1].lower().lstrip("."),
    }


@app.get("/api/files")
@login_required
def files_list():
    path = system.safe_volume_path(request.args.get("path", "/volume1"))
    if not path:
        return fail("非法路径")
    if not os.path.exists(path):
        return fail("目录不存在", 404)
    if not os.path.isdir(path):
        return fail("不是目录")
    entries: list[dict[str, Any]] = []
    try:
        with os.scandir(path) as iterator:
            for item in iterator:
                descriptor = _entry(item.path)
                if descriptor:
                    entries.append(descriptor)
    except OSError as exc:
        return fail(f"读取目录失败：{exc}")
    entries.sort(key=lambda item: (item["type"] != "dir", item["name"].lower()))
    parent = os.path.dirname(path)
    if not system.safe_volume_path(parent):
        parent = ""
    return ok(data={"path": path, "parent": parent, "entries": entries[:3000]})


@app.post("/api/files/mkdir")
@login_required
def files_mkdir():
    data = body()
    parent = system.safe_volume_path(str(data.get("path", "")))
    name = str(data.get("name", "")).strip()
    if not parent or not os.path.isdir(parent):
        return fail("目标目录不存在")
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        return fail("文件夹名称不合法")
    target = os.path.join(parent, name)
    if not system.safe_volume_path(target):
        return fail("路径不合法")
    try:
        os.makedirs(target, exist_ok=False)
        os.chmod(target, 0o2775)
    except FileExistsError:
        return fail("同名文件或文件夹已存在", 409)
    except OSError as exc:
        return fail(f"创建失败：{exc}")
    db.audit(current_user()["username"], "mkdir", target)
    return ok(path=target)


def _unique_path(directory: str, filename: str) -> str:
    filename = os.path.basename(filename).replace("\x00", "")
    if not filename:
        filename = "upload.bin"
    target = os.path.join(directory, filename)
    stem, suffix = os.path.splitext(filename)
    index = 1
    while os.path.exists(target):
        target = os.path.join(directory, f"{stem} ({index}){suffix}")
        index += 1
    return target


@app.post("/api/files/upload")
@login_required
def files_upload():
    directory = system.safe_volume_path(request.form.get("path", "/volume1"))
    if not directory or not os.path.isdir(directory):
        return fail("上传目录不存在")
    uploads = request.files.getlist("file")
    if not uploads:
        return fail("未收到文件")
    saved = []
    for upload in uploads:
        if not upload or not upload.filename:
            continue
        target = _unique_path(directory, upload.filename)
        if not system.safe_volume_path(target):
            continue
        try:
            upload.save(target)
            os.chmod(target, 0o664)
            saved.append(os.path.basename(target))
        except OSError as exc:
            return fail(f"保存 {upload.filename} 失败：{exc}")
    if not saved:
        return fail("没有文件被保存")
    db.audit(current_user()["username"], "upload", ", ".join(saved[:10]))
    return ok(saved=saved)


@app.get("/api/files/download")
@login_required
def files_download():
    path = system.safe_volume_path(request.args.get("path", ""))
    if not path or not os.path.isfile(path):
        return fail("文件不存在", 404)
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))


@app.delete("/api/files")
@login_required
def files_delete():
    path = system.safe_volume_path(request.args.get("path", ""))
    if not path or re.match(r"^/volume\d+$", path):
        return fail("不能删除存储卷根目录")
    if not os.path.exists(path):
        return fail("文件不存在", 404)
    if "/#recycle/" in path or path.endswith("/#recycle"):
        return fail("回收站中的文件请通过文件站直接清理")
    volume_root = "/" + path.split("/")[1]
    recycle = os.path.join(
        volume_root, "#recycle", time.strftime("%Y%m%d-%H%M%S"), os.path.relpath(path, volume_root)
    )
    try:
        os.makedirs(os.path.dirname(recycle), exist_ok=True)
        shutil.move(path, recycle)
    except OSError as exc:
        return fail(f"移入回收站失败：{exc}")
    db.audit(current_user()["username"], "delete", f"{path} -> {recycle}")
    return ok(message="已移入回收站 #recycle")


@app.post("/api/files/rename")
@login_required
def files_rename():
    data = body()
    path = system.safe_volume_path(str(data.get("path", "")))
    new_name = str(data.get("name", "")).strip()
    if not path or path.count("/") < 2:
        return fail("路径不合法")
    if not new_name or "/" in new_name or "\\" in new_name or new_name in (".", ".."):
        return fail("名称不合法")
    target = os.path.join(os.path.dirname(path), new_name)
    if not system.safe_volume_path(target):
        return fail("路径不合法")
    if os.path.exists(target):
        return fail("同名文件已存在", 409)
    try:
        os.rename(path, target)
    except OSError as exc:
        return fail(f"重命名失败：{exc}")
    db.audit(current_user()["username"], "rename", f"{path} -> {target}")
    return ok(path=target)


# --------------------------------------------------------------------------- #
# 用户
# --------------------------------------------------------------------------- #
@app.get("/api/users")
@admin_required
def list_users():
    rows = db.query("SELECT * FROM users ORDER BY id")
    return ok(data=[db.user_public(row) for row in rows])


@app.post("/api/users")
@admin_required
def create_user():
    data = body()
    username = str(data.get("username", "")).strip().lower()
    password = str(data.get("password", ""))
    role = "admin" if data.get("role") == "admin" else "user"
    email = str(data.get("email", ""))[:120]
    if not re.match(r"^[a-z][a-z0-9_-]{1,31}$", username):
        return fail("用户名需以小写字母开头，仅含小写字母、数字、_、-，长度 2-32")
    if len(password) < 8:
        return fail("密码至少 8 位")
    if db.query("SELECT id FROM users WHERE username=?", (username,), one=True):
        return fail("用户名已存在", 409)
    db.execute(
        "INSERT INTO users(username, password, role, email, created_at) VALUES(?,?,?,?,?)",
        (username, db.hash_password(password), role, email, db.now()),
    )
    warnings = services.create_system_user(username, password, role == "admin")
    db.audit(current_user()["username"], "create_user", username)
    return ok(warnings=warnings)


@app.patch("/api/users/<int:user_id>")
@admin_required
def update_user(user_id: int):
    row = db.query("SELECT * FROM users WHERE id=?", (user_id,), one=True)
    if not row:
        return fail("用户不存在", 404)
    data = body()
    warnings: list[str] = []
    if "password" in data:
        password = str(data.get("password", ""))
        if len(password) < 8:
            return fail("密码至少 8 位")
        db.execute(
            "UPDATE users SET password=?, must_change=0 WHERE id=?",
            (db.hash_password(password), user_id),
        )
        warnings += services.set_system_password(row["username"], password)
    if "email" in data:
        db.execute("UPDATE users SET email=? WHERE id=?", (str(data["email"])[:120], user_id))
    if "role" in data and row["username"] != "admin":
        role = "admin" if data["role"] == "admin" else "user"
        if row["role"] == "admin" and role != "admin":
            admins = db.query("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0", one=True)
            if admins and admins["n"] <= 1:
                return fail("至少需要保留一名管理员")
        db.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
        services.set_admin(row["username"], role == "admin")
    if "disabled" in data and row["username"] != "admin":
        disabled = bool(data["disabled"])
        db.execute("UPDATE users SET disabled=? WHERE id=?", (int(disabled), user_id))
        services.set_disabled(row["username"], disabled)
    db.audit(current_user()["username"], "update_user", row["username"])
    return ok(warnings=warnings)


@app.delete("/api/users/<int:user_id>")
@admin_required
def delete_user(user_id: int):
    row = db.query("SELECT * FROM users WHERE id=?", (user_id,), one=True)
    if not row:
        return fail("用户不存在", 404)
    if row["username"] == "admin":
        return fail("内置管理员不可删除")
    if row["id"] == session.get("uid"):
        return fail("不能删除当前登录用户")
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    warnings = services.delete_system_user(row["username"])
    db.audit(current_user()["username"], "delete_user", row["username"])
    return ok(warnings=warnings)


# --------------------------------------------------------------------------- #
# 套件中心 / Docker
# --------------------------------------------------------------------------- #
def _catalog() -> dict[str, Any]:
    candidates = [
        BASE.parent / "packages" / "catalog.json",
        BASE.parent.parent / "packages" / "catalog.json",
    ]
    for path in candidates:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
    return {"categories": ["全部"], "apps": []}


def _docker_available() -> bool:
    return system.has_command("docker")


def _images_dir() -> Path:
    for base in (BASE.parent / "packages", BASE.parent.parent / "packages"):
        if (base / "images").is_dir():
            return base / "images"
    return BASE.parent / "packages" / "images"


def _ensure_image(meta: dict) -> str | None:
    """确保套件镜像在本地：优先用 ISO 内置离线镜像包，缺失时回退在线拉取。"""
    image = str(meta.get("image", ""))
    if not image:
        return "套件未定义镜像"
    code, _, _ = system.run(["docker", "image", "inspect", image], timeout=30)
    if code == 0:
        return None
    tar = _images_dir() / f"{meta['id']}.tar"
    if tar.is_file():
        code, out, err = system.run(["docker", "load", "-i", str(tar)], timeout=1800)
        if code == 0:
            return None
        return f"离线镜像加载失败：{(err or out)[-300:]}"
    code, out, err = system.run(["docker", "pull", image], timeout=1800)
    if code != 0:
        return f"镜像拉取失败且无离线镜像包：{(err or out)[-300:]}"
    return None


def _containers() -> list[dict[str, Any]]:
    if not _docker_available():
        return []
    code, out, _ = system.run(
        [
            "docker",
            "ps",
            "-a",
            "--format",
            "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}",
        ],
        timeout=20,
    )
    if code != 0:
        return []
    items = []
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) < 5:
            continue
        items.append(
            {
                "id": parts[0],
                "name": parts[1],
                "image": parts[2],
                "status": parts[3],
                "ports": parts[4],
                "running": parts[3].lower().startswith("up"),
                "app": parts[1][5:] if parts[1].startswith("djos-") else "",
            }
        )
    return items


@app.get("/api/packages")
@login_required
def packages():
    catalog = _catalog()
    containers = {item["name"]: item for item in _containers()}
    installed = {row["id"]: row for row in db.query("SELECT * FROM apps")}
    apps = []
    for app_meta in catalog.get("apps", []):
        container_name = f"djos-{app_meta['id']}"
        container = containers.get(container_name)
        app_meta = dict(app_meta)
        app_meta["installed"] = app_meta["id"] in installed or bool(container)
        app_meta["running"] = bool(container and container["running"])
        app_meta["status"] = (
            "running"
            if app_meta["running"]
            else ("stopped" if app_meta["installed"] else "not_installed")
        )
        apps.append(app_meta)
    return ok(
        data={"categories": catalog.get("categories", ["全部"]), "apps": apps},
        docker_available=_docker_available(),
    )


def _find_app(app_id: str) -> dict[str, Any] | None:
    for item in _catalog().get("apps", []):
        if item.get("id") == app_id:
            return item
    return None


def _container_exists(name: str) -> bool:
    code, out, _ = system.run(
        ["docker", "ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.Names}}"], timeout=20
    )
    return code == 0 and name in out.split()


@app.post("/api/packages/<app_id>/install")
@admin_required
def install_package(app_id: str):
    if not _docker_available():
        return fail("Docker 服务不可用，请先在控制面板检查系统状态", 503)
    meta = _find_app(app_id)
    if not meta:
        return fail("套件不存在", 404)
    name = f"djos-{app_id}"
    if _container_exists(name):
        return fail("套件容器已存在，请先卸载", 409)
    err = _ensure_image(meta)
    if err:
        return fail(err, 502)
    args = [
        "docker",
        "run",
        "-d",
        "--name",
        name,
        "--restart",
        "unless-stopped",
        "--label",
        f"djos.app={app_id}",
    ]
    for port in meta.get("ports", []):
        args += ["-p", str(port)]
    for volume in meta.get("volumes", []):
        host = str(volume.get("host", ""))
        container_path = str(volume.get("container", ""))
        if not host or not container_path:
            continue
        if host.startswith("/volume"):
            try:
                os.makedirs(host, exist_ok=True)
                system.run(["chown", "-R", "1000:1000", host], timeout=60)
            except OSError as exc:
                return fail(f"创建套件数据目录失败：{exc}")
        suffix = ":ro" if volume.get("read_only") else ""
        args += ["-v", f"{host}:{container_path}{suffix}"]
    for env in meta.get("env", []):
        args += ["-e", str(env)]
    args.append(meta["image"])
    code, out, err = system.run(args, timeout=900)
    if code != 0:
        return fail(f"容器启动失败：{(err or out)[-800:]}")
    db.execute(
        "INSERT OR REPLACE INTO apps(id, container, status, installed_at) VALUES(?,?,?,?)",
        (app_id, name, "running", db.now()),
    )
    db.audit(current_user()["username"], "install_package", app_id)
    return ok(container=out[:64])


@app.post("/api/packages/<app_id>/uninstall")
@admin_required
def uninstall_package(app_id: str):
    if not _find_app(app_id):
        return fail("套件不存在", 404)
    name = f"djos-{app_id}"
    system.run(["docker", "rm", "-f", name], timeout=120)
    db.execute("DELETE FROM apps WHERE id=?", (app_id,))
    if request.args.get("purge") == "1":
        path = f"/volume1/appdata/{app_id}"
        if system.safe_volume_path(path):
            shutil.rmtree(path, ignore_errors=True)
    db.audit(current_user()["username"], "uninstall_package", app_id)
    return ok()


@app.post("/api/packages/<app_id>/<action>")
@admin_required
def package_action(app_id: str, action: str):
    if action not in ("start", "stop", "restart"):
        return fail("不支持的操作", 404)
    if not _find_app(app_id):
        return fail("套件不存在", 404)
    name = f"djos-{app_id}"
    if not _container_exists(name):
        return fail("容器不存在，请先安装", 404)
    code, out, err = system.run(["docker", action, name], timeout=120)
    if code != 0:
        return fail(err or out or "操作失败")
    status = "running" if action in ("start", "restart") else "stopped"
    db.execute("UPDATE apps SET status=? WHERE id=?", (status, app_id))
    db.audit(current_user()["username"], f"package_{action}", app_id)
    return ok()


@app.get("/api/docker/containers")
@login_required
def docker_containers():
    return ok(data=_containers(), available=_docker_available())


@app.post("/api/docker/containers/<container_id>/<action>")
@admin_required
def docker_action(container_id: str, action: str):
    if action not in ("start", "stop", "restart", "remove"):
        return fail("不支持的操作", 404)
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$", container_id):
        return fail("容器标识不合法")
    if action == "remove":
        code, out, err = system.run(["docker", "rm", "-f", container_id], timeout=120)
    else:
        code, out, err = system.run(["docker", action, container_id], timeout=120)
    if code != 0:
        return fail(err or out or "操作失败")
    db.audit(current_user()["username"], f"docker_{action}", container_id)
    return ok()


@app.get("/api/docker/containers/<container_id>/logs")
@login_required
def docker_logs(container_id: str):
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$", container_id):
        return fail("容器标识不合法")
    code, out, err = system.run(["docker", "logs", "--tail", "200", container_id], timeout=30)
    return ok(data={"logs": out or err})


# --------------------------------------------------------------------------- #
# 备份
# --------------------------------------------------------------------------- #
@app.get("/api/backup/jobs")
@login_required
def backup_jobs():
    jobs = db.query("SELECT * FROM backup_jobs ORDER BY id")
    for job in jobs:
        last = db.query(
            "SELECT * FROM backup_runs WHERE job_id=? ORDER BY id DESC LIMIT 1",
            (job["id"],),
            one=True,
        )
        job["enabled"] = bool(job["enabled"])
        job["last_run"] = last
    return ok(data=jobs)


@app.post("/api/backup/jobs")
@admin_required
def create_backup_job():
    data = body()
    name = str(data.get("name", "")).strip()[:60]
    source = str(data.get("source", "")).strip()
    dest = str(data.get("dest", "")).strip()
    mode = "rsync" if data.get("mode") == "rsync" else "snapshot"
    cron = str(data.get("cron", "0 2 * * *")).strip()
    if not name:
        return fail("请输入任务名称")
    if not system.safe_volume_path(source) or not os.path.isdir(source):
        return fail("源目录不存在")
    if mode == "rsync":
        if not dest or not system.safe_volume_path(dest):
            return fail("目标目录必须在存储卷内")
    else:
        dest = ""
    if not backup.valid_cron(cron):
        return fail("计划表达式无效，应为 5 段 cron（如 0 2 * * *）")
    job_id = db.execute(
        "INSERT INTO backup_jobs(name, source, dest, mode, cron, created_at) VALUES(?,?,?,?,?,?)",
        (name, source, dest, mode, cron, db.now()),
    )
    backup.write_cron()
    db.audit(current_user()["username"], "create_backup_job", name)
    return ok(id=job_id)


@app.patch("/api/backup/jobs/<int:job_id>")
@admin_required
def update_backup_job(job_id: int):
    job = db.query("SELECT * FROM backup_jobs WHERE id=?", (job_id,), one=True)
    if not job:
        return fail("任务不存在", 404)
    data = body()
    name = str(data.get("name", job["name"]))[:60]
    cron = str(data.get("cron", job["cron"])).strip()
    enabled = int(bool(data.get("enabled", job["enabled"])))
    if not backup.valid_cron(cron):
        return fail("计划表达式无效")
    db.execute(
        "UPDATE backup_jobs SET name=?, cron=?, enabled=? WHERE id=?",
        (name, cron, enabled, job_id),
    )
    backup.write_cron()
    return ok()


@app.delete("/api/backup/jobs/<int:job_id>")
@admin_required
def delete_backup_job(job_id: int):
    db.execute("DELETE FROM backup_jobs WHERE id=?", (job_id,))
    backup.write_cron()
    db.audit(current_user()["username"], "delete_backup_job", str(job_id))
    return ok()


@app.post("/api/backup/jobs/<int:job_id>/run")
@admin_required
def run_backup_job(job_id: int):
    job = db.query("SELECT * FROM backup_jobs WHERE id=?", (job_id,), one=True)
    if not job:
        return fail("任务不存在", 404)
    backup.run_job_async(job_id)
    db.audit(current_user()["username"], "run_backup_job", job["name"])
    return ok(message="备份任务已开始执行")


@app.get("/api/backup/runs")
@login_required
def backup_runs():
    rows = db.query(
        "SELECT r.*, j.name AS job_name FROM backup_runs r "
        "LEFT JOIN backup_jobs j ON j.id = r.job_id ORDER BY r.id DESC LIMIT 50"
    )
    return ok(data=rows)


# --------------------------------------------------------------------------- #
# 设置
# --------------------------------------------------------------------------- #
ALLOWED_SETTINGS = ("hostname", "timezone", "ssh_enabled", "auto_update", "model")


@app.get("/api/settings")
@admin_required
def get_settings():
    return ok(data={row["key"]: row["value"] for row in db.query("SELECT * FROM settings")})


@app.patch("/api/settings")
@admin_required
def update_settings():
    data = body()
    warnings: list[str] = []
    for key in ALLOWED_SETTINGS:
        if key not in data:
            continue
        value = str(data[key])
        if key == "hostname":
            if not re.match(r"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$", value):
                return fail("主机名格式不正确")
            services.apply_hostname(value)
        elif key == "timezone":
            if not re.match(r"^[A-Za-z]+/[A-Za-z0-9_+-]+$", value):
                return fail("时区格式不正确")
            services.apply_timezone(value)
        elif key == "ssh_enabled":
            enabled = value in ("1", "true", "True", "on")
            services.ssh_enable(enabled)
            value = "1" if enabled else "0"
        db.set_setting(key, value)
    db.audit(current_user()["username"], "update_settings", ",".join(data.keys()))
    return ok(warnings=warnings)


# --------------------------------------------------------------------------- #
# 健康检查与静态资源
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    return ok(status="healthy", version=VERSION, time=int(time.time()))


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def static_site(path: str):
    if path.startswith("api/"):
        abort(404)
    target = WEB_DIR / path
    if path and target.is_file():
        return send_from_directory(WEB_DIR, path)
    if (WEB_DIR / "index.html").exists():
        return send_from_directory(WEB_DIR, "index.html")
    return "DJOS API 正在运行，但未找到 Web 资源。", 200


@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return fail("接口不存在", 404)
    return static_site("")


@app.errorhandler(Exception)
def unhandled(error):
    if request.path.startswith("/api/"):
        app.logger.exception("API 异常")
        return fail(f"服务器内部错误：{error}", 500)
    return "Internal Server Error", 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8800, debug=False)

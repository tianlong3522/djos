"""DJOS 备份引擎：支持 Btrfs 只读快照与 rsync 镜像，并生成 cron 计划。"""
from __future__ import annotations

import os
import re
import threading
import time
from typing import Any

import db
import system

CRON_FILE = "/etc/cron.d/djos-backup"
CRON_RE = re.compile(
    r"^(\*|[0-9,\-\*/]+)\s+(\*|[0-9,\-\*/]+)\s+(\*|[0-9,\-\*/]+)\s+"
    r"(\*|[0-9,\-\*/]+)\s+(\*|[0-9,\-\*/]+)$"
)


def valid_cron(expr: str) -> bool:
    return bool(CRON_RE.match(expr.strip()))


def _safe_source(path: str) -> str | None:
    resolved = system.safe_volume_path(path)
    return resolved if resolved and os.path.isdir(resolved) else None


def _timestamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def _run_snapshot(job: dict[str, Any]) -> tuple[bool, str]:
    source = _safe_source(job["source"])
    if not source:
        return False, "源目录不存在或不在存储卷内"
    base = f"/volume1/@snapshots/{job['name']}"
    os.makedirs(base, exist_ok=True)
    target = os.path.join(base, f"{_timestamp()}")
    code, _, err = system.run(
        ["btrfs", "subvolume", "snapshot", "-r", source, target], timeout=600
    )
    if code != 0:
        # 非 Btrfs 文件系统退化为完整目录复制
        code, _, err = system.run(
            ["rsync", "-aHAX", source.rstrip("/") + "/", target + "/"], timeout=3600
        )
        if code != 0:
            return False, err or "快照失败"
    return True, f"快照已创建：{target}"


def _run_rsync(job: dict[str, Any]) -> tuple[bool, str]:
    source = _safe_source(job["source"])
    if not source:
        return False, "源目录不存在或不在存储卷内"
    dest = job["dest"].strip()
    if not dest:
        return False, "未设置目标路径"
    if not os.path.isabs(dest):
        return False, "目标路径必须是绝对路径"
    try:
        os.makedirs(dest, exist_ok=True)
    except OSError as exc:
        return False, f"无法创建目标目录：{exc}"
    code, _, err = system.run(
        [
            "rsync",
            "-aHAX",
            "--delete",
            "--exclude",
            "#recycle",
            source.rstrip("/") + "/",
            dest.rstrip("/") + "/",
        ],
        timeout=6 * 3600,
    )
    if code != 0:
        return False, err or "rsync 执行失败"
    return True, f"已同步到 {dest}"


def run_job(job_id: int) -> tuple[bool, str]:
    job = db.query("SELECT * FROM backup_jobs WHERE id=?", (job_id,), one=True)
    if not job:
        return False, "任务不存在"
    run_id = db.execute(
        "INSERT INTO backup_runs(job_id, started_at, status) VALUES(?,?,?)",
        (job_id, db.now(), "running"),
    )
    if job["mode"] == "rsync":
        ok, message = _run_rsync(job)
    else:
        ok, message = _run_snapshot(job)
    db.execute(
        "UPDATE backup_runs SET finished_at=?, status=?, message=? WHERE id=?",
        (db.now(), "success" if ok else "failed", message[:1000], run_id),
    )
    return ok, message


def run_job_async(job_id: int) -> None:
    threading.Thread(target=run_job, args=(job_id,), daemon=True).start()


def write_cron() -> None:
    jobs = db.query("SELECT * FROM backup_jobs WHERE enabled=1")
    lines = [
        "# 由 DJOS 自动生成，请勿手工编辑",
        "SHELL=/bin/bash",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ]
    for job in jobs:
        if not valid_cron(job["cron"]):
            continue
        lines.append(
            f"{job['cron'].strip()} root /usr/bin/python3 /opt/djos/api/job_runner.py {job['id']} "
            f">> /var/log/djos/backup.log 2>&1"
        )
    lines.append("")
    try:
        os.makedirs("/var/log/djos", exist_ok=True)
        with open(CRON_FILE, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
        os.chmod(CRON_FILE, 0o644)
    except OSError:
        pass

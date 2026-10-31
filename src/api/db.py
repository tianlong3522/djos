"""DJOS 数据库层：SQLite 单文件存储，承载用户、共享、存储池、套件与备份任务。"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any, Iterable

DB_PATH = os.environ.get("DJOS_DB", "/var/lib/djos/djos.db")
_LOCK = threading.RLock()

DEFAULT_ADMIN_PASSWORD = "djos123"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    email       TEXT NOT NULL DEFAULT '',
    must_change INTEGER NOT NULL DEFAULT 0,
    disabled    INTEGER NOT NULL DEFAULT 0,
    last_login  TEXT,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    path        TEXT NOT NULL,
    comment     TEXT NOT NULL DEFAULT '',
    smb         INTEGER NOT NULL DEFAULT 1,
    nfs         INTEGER NOT NULL DEFAULT 0,
    recycle     INTEGER NOT NULL DEFAULT 1,
    readonly    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS volumes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    mountpoint  TEXT UNIQUE NOT NULL,
    disks       TEXT NOT NULL DEFAULT '',
    fs          TEXT NOT NULL DEFAULT 'btrfs',
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS apps (
    id          TEXT PRIMARY KEY,
    container   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'installed',
    installed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    source      TEXT NOT NULL,
    dest        TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'snapshot',
    cron        TEXT NOT NULL DEFAULT '0 2 * * *',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      INTEGER NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL DEFAULT 'running',
    message     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      TEXT NOT NULL,
    user    TEXT NOT NULL DEFAULT '',
    action  TEXT NOT NULL,
    detail  TEXT NOT NULL DEFAULT ''
);
"""


def _connect() -> sqlite3.Connection:
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with _LOCK, _connect() as conn:
        conn.executescript(SCHEMA)
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            conn.execute(
                "INSERT OR IGNORE INTO users(username, password, role, must_change, created_at) "
                "VALUES(?,?,?,?,?)",
                ("admin", hash_password(DEFAULT_ADMIN_PASSWORD), "admin", 0, now()),
            )
        defaults = {
            "hostname": "DJOS",
            "timezone": "Asia/Shanghai",
            "ssh_enabled": "0",
            "auto_update": "0",
            "model": "DJOS NAS",
        }
        for key, value in defaults.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES(?,?)", (key, value)
            )
        conn.execute(
            "INSERT OR IGNORE INTO volumes(name, mountpoint, disks, fs, created_at) "
            "VALUES('volume1','/volume1','','btrfs',?)",
            (now(),),
        )
        conn.execute(
            "INSERT OR IGNORE INTO shares(name, path, comment, smb, nfs, recycle, readonly, created_at) "
            "VALUES('public','/volume1/public','公共共享文件夹',1,0,1,0,?)",
            (now(),),
        )
        for name, comment in (
            ("media", "影音库"),
            ("backup", "备份与快照"),
            ("downloads", "下载目录"),
        ):
            conn.execute(
                "INSERT OR IGNORE INTO shares(name, path, comment, smb, nfs, recycle, readonly, created_at) "
                "VALUES(?,?,?,1,0,1,0,?)",
                (name, f"/volume1/{name}", comment, now()),
            )


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return f"pbkdf2$200000${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt, digest = stored.split("$")
        if algo != "pbkdf2":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(rounds)
        )
        return hmac.compare_digest(candidate.hex(), digest)
    except (ValueError, TypeError):
        return False


def query(sql: str, args: Iterable[Any] = (), one: bool = False):
    with _connect() as conn:
        cur = conn.execute(sql, tuple(args))
        rows = cur.fetchall()
        return (dict(rows[0]) if rows else None) if one else [dict(r) for r in rows]


def execute(sql: str, args: Iterable[Any] = ()) -> int:
    with _LOCK, _connect() as conn:
        cur = conn.execute(sql, tuple(args))
        conn.commit()
        return cur.lastrowid or cur.rowcount


def audit(user: str, action: str, detail: str = "") -> None:
    execute(
        "INSERT INTO audit(at, user, action, detail) VALUES(?,?,?,?)",
        (now(), user, action, detail[:500]),
    )


def get_setting(key: str, default: str = "") -> str:
    row = query("SELECT value FROM settings WHERE key=?", (key,), one=True)
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    execute(
        "INSERT INTO settings(key, value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def user_public(row: dict) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "email": row["email"],
        "must_change": bool(row["must_change"]),
        "disabled": bool(row["disabled"]),
        "last_login": row["last_login"],
        "created_at": row["created_at"],
    }

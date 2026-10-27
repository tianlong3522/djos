#!/usr/bin/env python3
"""由 cron 调用的备份任务执行入口。"""
from __future__ import annotations

import sys

import backup
import db


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        print("用法: job_runner.py <job_id>", file=sys.stderr)
        return 2
    db.init_db()
    ok, message = backup.run_job(int(sys.argv[1]))
    print(f"[{'OK' if ok else 'FAIL'}] {message}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

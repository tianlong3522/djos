"""DJOS 系统采集层：直接读取 Linux /proc、/sys 与系统工具，无第三方强依赖。"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import threading
import time
from typing import Any

try:  # Debian 官方源提供 python3-psutil，缺失时自动退化为 /proc 解析
    import psutil  # type: ignore
except Exception:  # pragma: no cover
    psutil = None

_LOCK = threading.Lock()
_CPU_SAMPLE = {"times": None, "percent": 0.0}
_NET_SAMPLE = {"at": None, "rx": 0, "tx": 0, "rx_bps": 0.0, "tx_bps": 0.0}


def run(cmd: list[str], timeout: int = 30) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, errors="replace"
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except FileNotFoundError:
        return 127, "", f"{cmd[0]} 不存在"
    except subprocess.TimeoutExpired:
        return 124, "", "命令执行超时"
    except Exception as exc:  # pragma: no cover
        return 1, "", str(exc)


def _read(path: str, default: str = "") -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().strip()
    except OSError:
        return default


def _cpu_times() -> tuple[int, int]:
    parts = _read("/proc/stat").splitlines()[0].split()
    values = [int(v) for v in parts[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return sum(values), idle


def cpu_percent() -> float:
    with _LOCK:
        try:
            total, idle = _cpu_times()
        except (ValueError, IndexError):
            return 0.0
        previous = _CPU_SAMPLE["times"]
        _CPU_SAMPLE["times"] = (total, idle)
        if previous is None or total <= previous[0]:
            return _CPU_SAMPLE["percent"]
        delta_total = total - previous[0]
        delta_idle = idle - previous[1]
        percent = max(0.0, min(100.0, (delta_total - delta_idle) * 100.0 / delta_total))
        _CPU_SAMPLE["percent"] = round(percent, 1)
        return _CPU_SAMPLE["percent"]


def memory() -> dict[str, Any]:
    info: dict[str, int] = {}
    for line in _read("/proc/meminfo").splitlines():
        key, _, rest = line.partition(":")
        try:
            info[key] = int(rest.strip().split()[0]) * 1024
        except (IndexError, ValueError):
            continue
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", info.get("MemFree", 0))
    used = max(0, total - available)
    return {
        "total": total,
        "used": used,
        "available": available,
        "percent": round(used * 100.0 / total, 1) if total else 0.0,
        "swap_total": info.get("SwapTotal", 0),
        "swap_used": max(0, info.get("SwapTotal", 0) - info.get("SwapFree", 0)),
    }


def network() -> dict[str, Any]:
    rx = tx = 0
    for line in _read("/proc/net/dev").splitlines()[2:]:
        if ":" not in line:
            continue
        name, data = line.split(":", 1)
        if name.strip() == "lo":
            continue
        fields = data.split()
        try:
            rx += int(fields[0])
            tx += int(fields[8])
        except (IndexError, ValueError):
            continue
    now = time.monotonic()
    with _LOCK:
        previous = _NET_SAMPLE["at"]
        rx_bps = tx_bps = 0.0
        if previous and now > previous:
            rx_bps = max(0.0, (rx - _NET_SAMPLE["rx"]) / (now - previous))
            tx_bps = max(0.0, (tx - _NET_SAMPLE["tx"]) / (now - previous))
        _NET_SAMPLE.update(at=now, rx=rx, tx=tx, rx_bps=rx_bps, tx_bps=tx_bps)
    return {
        "rx_total": rx,
        "tx_total": tx,
        "rx_bps": round(rx_bps),
        "tx_bps": round(tx_bps),
    }


def _temperature() -> float | None:
    if psutil is not None:
        try:
            sensors = psutil.sensors_temperatures() or {}
            values = [item.current for group in sensors.values() for item in group]
            values = [v for v in values if 0 < v < 120]
            if values:
                return round(max(values), 1)
        except Exception:
            pass
    candidates: list[float] = []
    for root, _, files in os.walk("/sys/class/thermal"):
        for name in files:
            if not name.startswith("temp"):
                continue
            try:
                raw = float(_read(os.path.join(root, name), "0"))
                value = raw / 1000 if raw > 1000 else raw
                if 0 < value < 120:
                    candidates.append(value)
            except ValueError:
                continue
    return round(max(candidates), 1) if candidates else None


def _uptime() -> int:
    try:
        return int(float(_read("/proc/uptime", "0").split()[0]))
    except (ValueError, IndexError):
        return 0


def cpu_model() -> str:
    for line in _read("/proc/cpuinfo").splitlines():
        if line.lower().startswith("model name"):
            return line.split(":", 1)[1].strip()
    return platform.processor() or "x86_64 CPU"


def _dmi(name: str) -> str:
    return _read(f"/sys/class/dmi/id/{name}", "").strip()


def volumes() -> list[dict[str, Any]]:
    """返回所有 /volumeN 挂载点的容量信息。"""
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line in _read("/proc/mounts").splitlines():
        fields = line.split()
        if len(fields) < 3:
            continue
        mountpoint = fields[1].replace("\\040", " ")
        if not re.match(r"^/volume\d+$", mountpoint):
            continue
        seen.add(mountpoint)
        try:
            st = os.statvfs(mountpoint)
            total = st.f_blocks * st.f_frsize
            free = st.f_bavail * st.f_frsize
            used = max(0, total - st.f_bfree * st.f_frsize)
        except OSError:
            continue
        items.append(
            {
                "name": os.path.basename(mountpoint),
                "mountpoint": mountpoint,
                "fs": fields[2],
                "total": total,
                "used": used,
                "free": free,
                "percent": round(used * 100.0 / total, 1) if total else 0.0,
            }
        )
    return sorted(items, key=lambda item: item["name"])


def disk_list() -> list[dict[str, Any]]:
    code, out, _ = run(
        [
            "lsblk",
            "-J",
            "-b",
            "-o",
            "NAME,KNAME,SIZE,TYPE,TRAN,MODEL,SERIAL,ROTA,FSTYPE,MOUNTPOINTS",
        ]
    )
    if code != 0 or not out:
        code, out, _ = run(
            ["lsblk", "-J", "-b", "-o", "NAME,KNAME,SIZE,TYPE,TRAN,MODEL,SERIAL,ROTA,FSTYPE"]
        )
    try:
        payload = json.loads(out) if out else {}
    except json.JSONDecodeError:
        payload = {}

    result: list[dict[str, Any]] = []
    for disk in payload.get("blockdevices", []):
        if disk.get("type") != "disk" or disk.get("tran") == "loop":
            continue
        children = []
        for part in disk.get("children") or []:
            children.append(
                {
                    "name": part.get("name"),
                    "path": f"/dev/{part.get('name')}",
                    "size": int(part.get("size") or 0),
                    "fstype": part.get("fstype") or "",
                    "mountpoints": [m for m in (part.get("mountpoints") or []) if m],
                }
            )
        result.append(
            {
                "name": disk.get("name"),
                "path": f"/dev/{disk.get('name')}",
                "size": int(disk.get("size") or 0),
                "tran": (disk.get("tran") or "sata").lower(),
                "model": (disk.get("model") or "").strip(),
                "serial": (disk.get("serial") or "").strip(),
                "rotational": bool(disk.get("rota")),
                "fstype": disk.get("fstype") or "",
                "mountpoints": [m for m in (disk.get("mountpoints") or []) if m],
                "partitions": children,
            }
        )
    return result


def smart(device: str) -> dict[str, Any]:
    if not re.match(r"^/dev/(sd[a-z]+|nvme\d+n\d+|vd[a-z]+)$", device):
        return {"ok": False, "error": "非法的设备路径"}
    code, out, err = run(["smartctl", "-j", "-a", device], timeout=40)
    try:
        payload = json.loads(out)
    except json.JSONDecodeError:
        return {"ok": False, "error": err or out or "无法读取 SMART 信息"}
    attributes = []
    for attr in (payload.get("ata_smart_attributes") or {}).get("table", []):
        attributes.append(
            {
                "id": attr.get("id"),
                "name": attr.get("name"),
                "value": attr.get("value"),
                "worst": attr.get("worst"),
                "threshold": attr.get("thresh"),
                "raw": attr.get("raw", {}).get("string", ""),
            }
        )
    passed = payload.get("smart_status", {}).get("passed")
    return {
        "ok": code in (0, 4) and passed is not None,
        "device": device,
        "model": payload.get("model_name") or payload.get("device", {}).get("name", ""),
        "serial": payload.get("serial_number", ""),
        "health": "良好" if passed else ("异常" if passed is False else "未知"),
        "passed": bool(passed),
        "temperature": payload.get("temperature", {}).get("current"),
        "power_on_hours": payload.get("power_on_time", {}).get("hours"),
        "attributes": attributes[:24],
        "message": err if code not in (0, 4) else "",
    }


def network_interfaces() -> list[dict[str, Any]]:
    code, out, _ = run(["ip", "-j", "addr", "show"])
    try:
        payload = json.loads(out) if out else []
    except json.JSONDecodeError:
        payload = []
    items = []
    for iface in payload:
        name = iface.get("ifname", "")
        if name == "lo":
            continue
        addresses = [
            {
                "family": info.get("family"),
                "address": info.get("local"),
                "prefix": info.get("prefixlen"),
            }
            for info in iface.get("addr_info", [])
        ]
        try:
            speed = int(_read(f"/sys/class/net/{name}/speed", "-1"))
        except ValueError:
            speed = -1
        items.append(
            {
                "name": name,
                "state": iface.get("operstate", "unknown"),
                "mac": iface.get("address", ""),
                "mtu": iface.get("mtu"),
                "speed": speed,
                "addresses": addresses,
            }
        )
    return items


def default_gateway() -> str:
    code, out, _ = run(["ip", "-4", "route", "show", "default"])
    match = re.search(r"default via (\S+)", out)
    return match.group(1) if match else ""


def dns_servers() -> list[str]:
    servers = []
    for line in _read("/etc/resolv.conf").splitlines():
        if line.startswith("nameserver"):
            servers.append(line.split()[1])
    return servers


def info() -> dict[str, Any]:
    os_name = "DJOS"
    for line in _read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[1].strip().strip('"')
    total_mem = memory()["total"]
    return {
        "hostname": platform.node() or "DJOS",
        "model": _dmi("product_name") or "DJOS NAS",
        "serial": _dmi("product_serial") or "",
        "bios": _dmi("bios_version") or "",
        "cpu_model": cpu_model(),
        "cpu_cores": os.cpu_count() or 1,
        "memory_total": total_mem,
        "os": os_name,
        "kernel": platform.release(),
        "arch": platform.machine(),
        "version": _read("/opt/djos/VERSION", "1.0.0"),
        "boot_time": int(time.time()) - _uptime(),
    }


def logs(lines: int = 200) -> str:
    lines = max(10, min(lines, 2000))
    code, out, _ = run(["journalctl", "-n", str(lines), "--no-pager", "-o", "short-iso"])
    if code == 0 and out:
        return out
    for path in ("/var/log/syslog", "/var/log/messages"):
        if os.path.exists(path):
            code, out, _ = run(["tail", "-n", str(lines), path])
            if code == 0:
                return out
    return "暂无系统日志"


def safe_volume_path(raw: str) -> str | None:
    """将用户路径限制在 /volumeN 之内，阻止路径穿越。"""
    if not raw:
        return "/volume1"
    if "\x00" in raw:
        return None
    path = os.path.realpath(raw)
    if path == "/volume1" or path.startswith("/volume1/"):
        return path
    if re.match(r"^/volume\d+$", path) or re.match(r"^/volume\d+/", path):
        return path
    return None


def status() -> dict[str, Any]:
    mem = memory()
    vols = volumes()
    net = network()
    temp = _temperature()
    alerts: list[dict[str, Any]] = []
    for vol in vols:
        if vol["percent"] >= 95:
            alerts.append(
                {"level": "critical", "text": f"{vol['name']} 空间仅剩 {vol['percent']:.1f}% 已用"}
            )
        elif vol["percent"] >= 85:
            alerts.append(
                {"level": "warning", "text": f"{vol['name']} 使用率已达 {vol['percent']:.1f}%"}
            )
    if temp and temp >= 80:
        alerts.append({"level": "critical", "text": f"CPU 温度过高：{temp}°C"})
    elif temp and temp >= 70:
        alerts.append({"level": "warning", "text": f"CPU 温度偏高：{temp}°C"})
    if mem["percent"] >= 92:
        alerts.append({"level": "warning", "text": "内存占用超过 92%"})
    return {
        "hostname": platform.node() or "DJOS",
        "uptime": _uptime(),
        "load": [round(v, 2) for v in os.getloadavg()] if hasattr(os, "getloadavg") else [0, 0, 0],
        "cpu": {
            "percent": cpu_percent(),
            "cores": os.cpu_count() or 1,
            "model": cpu_model(),
            "temperature": temp,
        },
        "memory": mem,
        "network": net,
        "volumes": vols,
        "alerts": alerts,
        "time": int(time.time()),
    }


def has_command(name: str) -> bool:
    return shutil.which(name) is not None

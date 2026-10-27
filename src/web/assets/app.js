/* DJOS Web 控制台 —— 群晖 DSM 风格的单页管理界面
 * 纯原生 JS 实现，无外部依赖，支持离线演示模式。
 */
(function () {
"use strict";

/* ---------------------------------------------------------------- 工具 */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function fmtBytes(n) {
    n = Number(n) || 0;
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)) + " " + units[i];
}

function fmtSpeed(n) { return fmtBytes(n) + "/s"; }

function fmtUptime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    if (d) return d + " 天 " + h + " 小时";
    if (h) return h + " 小时 " + m + " 分";
    return m + " 分钟";
}

function fmtDate(v) {
    if (!v) return "-";
    let d;
    if (typeof v === "number") d = new Date(v * 1000);
    else d = new Date(String(v).replace(" ", "T"));
    if (isNaN(d)) return String(v);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
        p(d.getHours()) + ":" + p(d.getMinutes());
}

function pctClass(p) { return p >= 90 ? "red" : p >= 75 ? "amber" : "green"; }

/* ---------------------------------------------------------------- 图标 */
const IC = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.5"/></svg>',
    hdd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 12h.01M17 12h.01"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7h16v-7"/><path d="M2 7l10-4 10 4v5H2z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/></svg>',
    pkg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/></svg>',
    docker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 15h18l-1.2 3.5a3 3 0 01-2.8 2H7a3 3 0 01-2.8-2z"/><path d="M6 15v-3h3v3M10 15v-3h3v3M14 15v-3h3v3M10 11V8h3v3"/></svg>',
    backup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M12 15l-4-4M12 15l4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 010 7M21 20c0-2.8-1.9-5.1-4.5-5.8"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.6 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.6-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12a8 8 0 10-2.3 5.6M20 12V6M20 12h-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 4l13 8-13 8z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
    restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12a8 8 0 10-2.3 5.6M20 12V6M20 12h-6"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M12 4L7 9M12 4l5 5"/><path d="M4 20h16"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12M12 16l-5-5M12 16l5-5"/><path d="M4 20h16"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12l5 5L20 6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l10 17H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>',
    cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
    mem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 8V5M12 8V5M17 8V5M7 19v-3M12 19v-3M17 19v-3"/></svg>',
    net: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    snap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8 7l8 4M8 17l8-4"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v9"/><path d="M6 6.5a8 8 0 1012 0"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M10.9 12.1L21 2M15 8l3 3"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4L11 13"/><path d="M19 13v7H4V5h7"/></svg>'
};

/* ---------------------------------------------------------------- 状态 */
const state = {
    user: null,
    csrf: "",
    demo: false,
    route: "dashboard",
    timers: [],
    hist: { cpu: [], mem: [], rx: [], tx: [] },
    pkgCategory: "全部",
    filesPath: "/volume1",
    logTab: "system"
};

function clearTimers() {
    state.timers.forEach(t => clearInterval(t));
    state.timers = [];
}
function every(ms, fn) { state.timers.push(setInterval(fn, ms)); }

/* ---------------------------------------------------------------- API */
async function api(path, opts) {
    opts = opts || {};
    if (state.demo) return demoApi(path, opts);
    const init = { method: opts.method || "GET", headers: opts.headers || {} };
    if (opts.body instanceof FormData) {
        init.body = opts.body;
    } else if (opts.body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(opts.body);
    }
    if (init.method !== "GET") init.headers["X-DJOS-CSRF"] = state.csrf;
    let res;
    try {
        res = await fetch(path, init);
    } catch (e) {
        throw new Error("无法连接到 DJOS 服务");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (res.status === 401) {
        showLogin();
        throw new Error((data && data.error) || "登录状态已失效");
    }
    if (!data) throw new Error("服务响应异常（HTTP " + res.status + "）");
    if (!data.ok) {
        const err = new Error(data.error || "操作失败");
        err.code = data.code || "";
        throw err;
    }
    return data;
}

/* ---------------------------------------------------------------- Toast */
function toast(msg, kind) {
    kind = kind || "success";
    const root = $("#toastRoot");
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.innerHTML = (kind === "error" ? IC.warn : kind === "warning" ? IC.warn : IC.check) +
        "<div>" + esc(msg) + "</div>";
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(-6px)"; }, 3600);
    setTimeout(() => el.remove(), 4200);
}

/* ---------------------------------------------------------------- Modal */
function openModal(opts) {
    const root = $("#modalRoot");
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML =
        '<div class="modal' + (opts.wide ? " wide" : "") + '">' +
        '<div class="modal-head"><div><h3>' + esc(opts.title) + "</h3>" +
        (opts.sub ? '<div class="sub">' + esc(opts.sub) + "</div>" : "") +
        '</div><button class="modal-close" data-close>' + IC.x + "</button></div>" +
        '<div class="modal-body"></div>' +
        (opts.footer !== false ? '<div class="modal-foot"></div>' : "") +
        "</div>";
    const body = $(".modal-body", wrap);
    if (typeof opts.body === "string") body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    const foot = $(".modal-foot", wrap);
    const close = () => { wrap.remove(); if (opts.onClose) opts.onClose(); };
    $("[data-close]", wrap).onclick = close;
    wrap.addEventListener("mousedown", e => { if (e.target === wrap) close(); });
    if (foot && opts.buttons) {
        opts.buttons.forEach(b => {
            const btn = document.createElement("button");
            btn.className = "btn " + (b.kind || "");
            btn.innerHTML = esc(b.label);
            btn.onclick = async () => {
                if (b.onClick) {
                    btn.disabled = true;
                    btn.innerHTML = '<span class="spinner"></span>';
                    try { const r = await b.onClick(body); if (r !== false) close(); }
                    catch (e) { toast(e.message, "error"); }
                    finally { btn.disabled = false; btn.innerHTML = esc(b.label); }
                } else close();
            };
            foot.appendChild(btn);
        });
    }
    root.appendChild(wrap);
    return { close, body };
}

function confirmBox(title, html, okLabel, danger) {
    return new Promise(resolve => {
        openModal({
            title: title,
            body: '<div class="' + (danger ? "danger-box" : "warn-box") + '">' + html + "</div>",
            buttons: [
                { label: "取消", onClick: () => { resolve(false); } },
                { label: okLabel || "确定", kind: danger ? "danger" : "primary", onClick: () => { resolve(true); } }
            ],
            onClose: () => resolve(false)
        });
    });
}

/* ---------------------------------------------------------------- 菜单 */
function openMenu(anchor, build) {
    closeMenu();
    const root = $("#menuRoot");
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.style.position = "fixed";
    menu.style.top = (rect.bottom + 6) + "px";
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + "px";
    menu.style.zIndex = 120;
    build(menu);
    root.appendChild(menu);
    setTimeout(() => document.addEventListener("mousedown", onDocDown), 0);
    function onDocDown(e) { if (!menu.contains(e.target)) closeMenu(); }
    menu._cleanup = () => document.removeEventListener("mousedown", onDocDown);
}
function closeMenu() {
    const root = $("#menuRoot");
    $$(".menu", root).forEach(m => { if (m._cleanup) m._cleanup(); m.remove(); });
}

/* ---------------------------------------------------------------- 命令面板 */
function openPalette() {
    const root = $("#paletteRoot");
    root.innerHTML =
        '<div class="palette"><div class="palette-box">' +
        '<div class="search-row">' + IC.home.replace('stroke-width="2"', 'stroke-width="2"') +
        '<input placeholder="输入以跳转：存储 / 共享 / 文件 / 套件 / 备份 / 用户 / 设置 / 日志…"></div>' +
        '<div class="palette-list"></div></div></div>';
    const pal = $(".palette", root), input = $("input", root), list = $(".palette-list", root);
    const items = NAV.flatMap(g => g.items).map(i => ({ id: i.id, name: i.name, icon: i.icon }));
    function render(filter) {
        const f = (filter || "").trim().toLowerCase();
        const matched = items.filter(i => !f || i.name.toLowerCase().includes(f) || i.id.includes(f));
        list.innerHTML = matched.length ? matched.map((i, idx) =>
            '<button class="palette-item' + (idx === 0 ? " active" : "") + '" data-id="' + i.id + '">' +
            IC[i.icon] + "<span>" + esc(i.name) + "</span></button>").join("")
            : '<div class="palette-empty">没有匹配的功能</div>';
        $$(".palette-item", list).forEach(b => b.onclick = () => { go(b.dataset.id); close(); });
    }
    function close() { root.innerHTML = ""; }
    input.oninput = () => render(input.value);
    input.onkeydown = e => {
        if (e.key === "Escape") close();
        if (e.key === "Enter") { const first = $(".palette-item", list); if (first) { go(first.dataset.id); close(); } }
    };
    pal.addEventListener("mousedown", e => { if (e.target === pal) close(); });
    render("");
    input.focus();
}

/* ---------------------------------------------------------------- 导航 */
const NAV = [
    { title: "系统", items: [
        { id: "dashboard", name: "概览", icon: "home" },
        { id: "storage", name: "存储空间", icon: "disk" },
        { id: "disks", name: "磁盘信息", icon: "hdd" }
    ]},
    { title: "数据服务", items: [
        { id: "shares", name: "共享文件夹", icon: "share" },
        { id: "files", name: "文件管理", icon: "folder" },
        { id: "backup", name: "备份任务", icon: "backup" }
    ]},
    { title: "应用", items: [
        { id: "packages", name: "套件中心", icon: "pkg" },
        { id: "docker", name: "Docker 容器", icon: "docker" }
    ]},
    { title: "管理", items: [
        { id: "users", name: "用户管理", icon: "users" },
        { id: "settings", name: "系统设置", icon: "gear" },
        { id: "logs", name: "日志中心", icon: "log" }
    ]}
];

const VIEWS = {};

function renderNav() {
    const nav = $("#nav");
    nav.innerHTML = NAV.map(g =>
        '<div class="nav-group"><div class="nav-title">' + esc(g.title) + "</div>" +
        g.items.map(i =>
            '<button class="nav-item' + (i.id === state.route ? " active" : "") + '" data-id="' + i.id + '">' +
            IC[i.icon] + "<span>" + esc(i.name) + "</span></button>").join("") +
        "</div>").join("");
    $$(".nav-item", nav).forEach(b => b.onclick = () => { go(b.dataset.id); $("#sidebar").classList.remove("open"); });
}

function go(route) {
    clearTimers();
    state.route = route;
    renderNav();
    const item = NAV.flatMap(g => g.items).find(i => i.id === route);
    $("#crumbText").textContent = item ? item.name : "";
    const view = $("#view");
    view.innerHTML = '<div class="loading-panel"><span class="spinner"></span></div>';
    const fn = VIEWS[route] || VIEWS.dashboard;
    Promise.resolve(fn(view)).catch(e => {
        view.innerHTML = '<div class="card"><div class="card-body"><div class="alert critical">' + IC.warn +
            "<div>" + esc(e.message) + "</div></div></div></div>";
    });
}

/* ---------------------------------------------------------------- 画布图表 */
function drawLines(canvas, series, colors, max) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#e9f0f7";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke();
    }
    const cap = max || 100;
    series.forEach((data, si) => {
        if (data.length < 2) return;
        ctx.strokeStyle = colors[si];
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        data.forEach((v, i) => {
            const x = w * i / (data.length - 1);
            const y = h - Math.min(1, Math.max(0, v / cap)) * (h - 6) - 3;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        ctx.fillStyle = colors[si] + "18";
        ctx.fill();
    });
}

/* ---------------------------------------------------------------- 登录 */
function showLogin() {
    state.user = null;
    clearTimers();
    closeMenu();
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
}

async function enterApp(user, csrf) {
    state.user = user;
    if (csrf) state.csrf = csrf;
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#userName").textContent = user.username;
    $("#userRole").textContent = user.role === "admin" ? "管理员" : "普通用户";
    $("#avatar").textContent = (user.username || "A").slice(0, 1).toUpperCase();
    renderNav();
    if (user.must_change) forceChangePassword();
    go("dashboard");
}

function forceChangePassword() {
    const demo = !!state.demo;
    openModal({
        title: "设置新密码",
        sub: "首次登录需要修改初始密码",
        body:
            '<div class="field"><label>当前密码（默认 ' + (demo ? "demo" : "DJOS@2026") + '）</label><input class="input" type="password" id="np0" placeholder="留空则使用默认密码"></div>' +
            '<div class="field"><label>新密码（至少 8 位）</label><input class="input" type="password" id="np1"></div>' +
            '<div class="field"><label>确认新密码</label><input class="input" type="password" id="np2"></div>',
        buttons: [{
            label: "保存", kind: "primary", onClick: async body => {
                const p0 = $("#np0", body).value, p1 = $("#np1", body).value, p2 = $("#np2", body).value;
                if (p1.length < 8) throw new Error("新密码至少 8 位");
                if (p1 !== p2) throw new Error("两次输入的密码不一致");
                await api("/api/auth/password", { method: "POST", body: { old_password: p0 || (demo ? "demo" : "DJOS@2026"), new_password: p1 } });
                if (state.user) state.user.must_change = false;
                toast("密码已更新");
            }
        }]
    });
}

/* ================================================================ 视图 */

/* ---------------------------------------------------------------- 概览 */
VIEWS.dashboard = async view => {
    const [dash, auditRes] = await Promise.all([
        api("/api/dashboard"),
        api("/api/system/audit").catch(() => ({ data: [] }))
    ]);
    const d = dash.data;
    const vols = d.volumes || [];
    const totalCap = vols.reduce((s, v) => s + (v.total || 0), 0);
    const usedCap = vols.reduce((s, v) => s + (v.used || 0), 0);
    const capPct = totalCap ? Math.round(usedCap * 1000 / totalCap) / 10 : 0;
    const health = (d.alerts || []).some(a => a.level === "critical") ? 60 : (d.alerts || []).length ? 85 : 100;
    const memPct = d.memory ? d.memory.percent : 0;

    view.innerHTML =
        '<div class="page-head"><div><h1>系统概览</h1><div class="desc">实时掌握 DJOS 的运行状态与资源占用</div></div>' +
        '<div class="page-actions"><button class="btn" id="rf">' + IC.refresh + '刷新</button></div></div>' +

        '<div class="card hero"><div class="card-body" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;width:100%">' +
        '<div class="hero-device"><div class="nas-glyph">' + IC.hdd + "</div><div><h2>" + esc(d.hostname || "DJOS") + "</h2>" +
        '<div class="meta"><span>型号 <b>' + esc(d.model || "DJOS NAS") + "</b></span><span>版本 <b>v" + esc(d.version || "1.0.0") +
        "</b></span><span>已运行 <b>" + fmtUptime(d.uptime) + "</b></span></div></div></div>" +
        '<div class="health-ring" style="--p:' + health + ';--c:' + (health === 100 ? "var(--green)" : health > 70 ? "var(--amber)" : "var(--red)") + '">' +
        '<div class="inner"><div class="v">' + health + '</div><div class="l">健康度</div></div></div></div></div>' +

        ((d.alerts || []).length ? '<div class="stack mt">' + d.alerts.map(a =>
            '<div class="alert ' + esc(a.level) + '">' + IC.warn + "<div>" + esc(a.text) + "</div></div>").join("") + "</div>" : "") +

        '<div class="grid grid-4 mt">' +
        statCard("blue", IC.cpu, "CPU 使用率", (d.cpu ? d.cpu.percent : 0) + "<small>%</small>",
            (d.cpu ? esc((d.cpu.model || "").slice(0, 28)) : "-") + " · " + (d.cpu ? d.cpu.cores : "-") + " 核",
            d.cpu ? d.cpu.percent : 0) +
        statCard("green", IC.mem, "内存占用", memPct + "<small>%</small>",
            d.memory ? fmtBytes(d.memory.used) + " / " + fmtBytes(d.memory.total) : "-", memPct) +
        statCard("violet", IC.net, "网络吞吐", fmtSpeed((d.network ? d.network.rx_bps : 0) || 0),
            "上传 " + fmtSpeed((d.network ? d.network.tx_bps : 0) || 0), null) +
        statCard("amber", IC.disk, "存储空间", capPct + "<small>%</small>",
            fmtBytes(usedCap) + " / " + fmtBytes(totalCap), capPct) +
        "</div>" +

        '<div class="grid grid-2-1 mt">' +
        '<div class="card"><div class="card-head"><div><h2>资源趋势</h2><div class="sub">最近 2 分钟 CPU 与内存使用率</div></div>' +
        '<div class="chart-legend"><span><i style="background:#0b74d9"></i>CPU</span><span><i style="background:#189a66"></i>内存</span></div></div>' +
        '<div class="card-body"><div class="chart-box"><canvas id="resChart"></canvas></div></div></div>' +
        '<div class="card"><div class="card-head"><div><h2>存储池用量</h2><div class="sub">各存储池容量使用情况</div></div></div>' +
        '<div class="card-body" id="volList">' + (vols.length ? vols.map(v =>
            '<div class="volume-row"><div class="volume-top"><span class="n">' + esc(v.name) + '</span>' +
            '<span class="s">' + fmtBytes(v.used) + " / " + fmtBytes(v.total) + '</span>' +
            '<span class="p">' + (v.percent || 0).toFixed(1) + '%</span></div>' +
            '<div class="progress ' + pctClass(v.percent || 0) + '"><span style="width:' + Math.min(100, v.percent || 0) + '%"></span></div></div>'
        ).join("") : '<div class="empty">暂无存储池</div>') + "</div></div></div>" +

        '<div class="grid grid-2 mt">' +
        '<div class="card"><div class="card-head"><div><h2>网络吞吐</h2><div class="sub">最近 2 分钟收发速率</div></div>' +
        '<div class="chart-legend"><span><i style="background:#0b74d9"></i>下载</span><span><i style="background:#7c5cf0"></i>上传</span></div></div>' +
        '<div class="card-body"><div class="chart-box"><canvas id="netChart"></canvas></div></div></div>' +
        '<div class="card"><div class="card-head"><div><h2>最近操作</h2><div class="sub">系统审计记录</div></div></div>' +
        '<div class="card-body"><div class="activity" id="actList">' + activityHtml(auditRes.data) + "</div></div></div>" +
        "</div>";

    $("#rf").onclick = () => go("dashboard");

    const push = () => {
        const h = state.hist;
        h.cpu.push(d.cpu ? d.cpu.percent : 0); h.mem.push(memPct);
        h.rx.push(d.network ? (d.network.rx_bps || 0) : 0); h.tx.push(d.network ? (d.network.tx_bps || 0) : 0);
        [h.cpu, h.mem, h.rx, h.tx].forEach(a => { if (a.length > 40) a.shift(); });
    };
    push();
    const redraw = () => {
        const rc = $("#resChart"), nc = $("#netChart");
        if (!rc || !nc) return;
        const netMax = Math.max(1024 * 128, ...state.hist.rx, ...state.hist.tx);
        drawLines(rc, [state.hist.cpu, state.hist.mem], ["#0b74d9", "#189a66"], 100);
        drawLines(nc, [state.hist.rx, state.hist.tx], ["#0b74d9", "#7c5cf0"], netMax);
    };
    redraw();
    every(3000, async () => {
        try {
            const r = await api("/api/system/status");
            const s = r.data;
            state.hist.cpu.push(s.cpu.percent); state.hist.mem.push(s.memory.percent);
            state.hist.rx.push(s.network.rx_bps || 0); state.hist.tx.push(s.network.tx_bps || 0);
            [state.hist.cpu, state.hist.mem, state.hist.rx, state.hist.tx].forEach(a => { if (a.length > 40) a.shift(); });
            redraw();
        } catch (e) { /* 忽略瞬时错误 */ }
    });
    window.addEventListener("resize", redraw);
};

function statCard(color, icon, label, value, foot, pct) {
    return '<div class="card stat-card"><div class="stat-icon ' + color + '">' + icon + "</div>" +
        '<div class="stat-main"><div class="stat-label">' + label + '</div>' +
        '<div class="stat-value">' + value + "</div>" +
        '<div class="stat-foot">' + foot + "</div>" +
        (pct == null ? "" : '<div class="progress ' + pctClass(pct) + '"><span style="width:' + Math.min(100, pct) + '%"></span></div>') +
        "</div></div>";
}

function activityHtml(rows) {
    if (!rows || !rows.length) return '<div class="empty">暂无记录</div>';
    return rows.slice(0, 8).map(r =>
        '<div class="activity-item"><span class="ico"></span><div><div><b>' + esc(r.user) + "</b> " +
        esc(actionName(r.action)) + (r.detail ? ' <span style="color:var(--muted)">' + esc(String(r.detail).slice(0, 40)) + "</span>" : "") +
        '</div><div class="time">' + fmtDate(r.at) + "</div></div></div>").join("");
}

function actionName(a) {
    const map = {
        login: "登录系统", login_failed: "登录失败", logout: "退出登录", change_password: "修改密码",
        create_volume: "创建存储池", delete_volume: "移除存储池", create_share: "创建共享",
        update_share: "更新共享", delete_share: "删除共享", create_user: "创建用户", update_user: "更新用户",
        delete_user: "删除用户", install_package: "安装套件", uninstall_package: "卸载套件",
        create_backup_job: "创建备份任务", delete_backup_job: "删除备份任务", run_backup_job: "执行备份",
        set_hostname: "修改主机名", set_timezone: "修改时区", set_ssh: "变更 SSH 设置", reboot: "重启系统",
        shutdown: "关机", mkdir: "新建文件夹", upload: "上传文件", delete: "删除文件", rename: "重命名",
        create_snapshot: "创建快照", delete_snapshot: "删除快照", update_settings: "更新系统设置"
    };
    if (map[a]) return map[a];
    if (a && a.startsWith("package_")) return "套件操作";
    if (a && a.startsWith("docker_")) return "容器操作";
    return a || "-";
}

/* ---------------------------------------------------------------- 存储空间 */
VIEWS.storage = async view => {
    const [volRes, snapRes] = await Promise.all([
        api("/api/storage/volumes"),
        api("/api/storage/snapshots").catch(() => ({ data: [] }))
    ]);
    const vols = volRes.data || [];
    view.innerHTML =
        '<div class="page-head"><div><h1>存储空间</h1><div class="desc">管理 Btrfs 存储池、容量与快照保护</div></div>' +
        '<div class="page-actions">' +
        '<button class="btn" id="snapNew">' + IC.snap + '新建快照</button>' +
        '<button class="btn primary" id="volNew">' + IC.plus + '创建存储池</button></div></div>' +
        '<div class="volume-cards">' + (vols.length ? vols.map(v =>
            '<div class="card volume-card"><div class="top"><div><h3>' + esc(v.name) + '</h3>' +
            '<div class="fs">' + esc((v.fs || "btrfs").toUpperCase()) + " · " + esc((v.disks || []).join(" + ") || "-") + "</div></div>" +
            '<span class="badge ' + (v.mounted ? "green" : "red") + '"><span class="dot"></span>' + (v.mounted ? "已挂载" : "未挂载") + "</span></div>" +
            '<div class="usage-big">' + (v.percent || 0).toFixed(1) + '<small style="font-size:13px;color:var(--muted)">%</small></div>' +
            '<div class="progress ' + pctClass(v.percent || 0) + '" style="margin-top:8px"><span style="width:' + Math.min(100, v.percent || 0) + '%"></span></div>' +
            '<div class="numbers"><span>已用 <b>' + fmtBytes(v.used) + '</b></span><span>可用 <b>' + fmtBytes(v.free) + '</b></span><span>总量 <b>' + fmtBytes(v.total) + "</b></span></div>" +
            (v.name !== "volume1" ? '<div style="margin-top:14px;text-align:right"><button class="btn small danger" data-del="' + esc(v.name) + '">' + IC.trash + '移除</button></div>' : "") +
            "</div>").join("") : '<div class="card"><div class="card-body"><div class="empty">尚未创建存储池</div></div></div>') +
        "</div>" +
        '<div class="card mt-lg"><div class="card-head"><div><h2>快照</h2><div class="sub">Btrfs 只读快照，用于数据版本保护</div></div></div>' +
        '<div class="card-body table-wrap">' + (snapRes.data && snapRes.data.length ?
            '<table><thead><tr><th>快照</th><th>来源</th><th>创建时间</th><th></th></tr></thead><tbody>' +
            snapRes.data.map(s =>
                "<tr><td class='cell-main'>" + esc(s.name) + "</td><td>" + esc(s.job) + "</td><td>" + fmtDate(s.created) +
                "</td><td class='actions'><button class='btn small danger' data-snapdel='" + esc(s.path) + "'>" + IC.trash + "删除</button></td></tr>").join("") +
            "</tbody></table>" : '<div class="empty">暂无快照</div>') + "</div></div>";

    $("#volNew").onclick = createVolumeWizard;
    $("#snapNew").onclick = () => snapshotWizard(vols);
    $$("[data-del]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("移除存储池", "将卸载并移除存储池 <b>" + esc(b.dataset.del) + "</b>，磁盘上的数据不会被擦除。", "移除", true)) {
            try { await api("/api/storage/volumes/" + b.dataset.del, { method: "DELETE" }); toast("存储池已移除"); go("storage"); }
            catch (e) { toast(e.message, "error"); }
        }
    });
    $$("[data-snapdel]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("删除快照", "确定删除该快照？删除后无法恢复。", "删除", true)) {
            try { await api("/api/storage/snapshots", { method: "DELETE", body: { path: b.dataset.snapdel } }); toast("快照已删除"); go("storage"); }
            catch (e) { toast(e.message, "error"); }
        }
    });
};

async function createVolumeWizard() {
    let disks;
    try { disks = (await api("/api/storage/disks")).data; }
    catch (e) { return toast(e.message, "error"); }
    const free = (disks || []).filter(d => !(d.mountpoints || []).length && !(d.partitions || []).some(p => (p.mountpoints || []).length));
    if (!free.length) return toast("没有可用的空闲磁盘", "warning");
    openModal({
        title: "创建存储池",
        sub: "所选磁盘将被格式化，请提前备份数据",
        body:
            '<div class="field"><label>存储池名称</label><input class="input" id="vname" value="volume2"></div>' +
            '<div class="field"><label>阵列类型</label><select class="select" id="vmode">' +
            '<option value="single">单盘（Basic）</option><option value="raid1">RAID 1（镜像保护）</option><option value="raid0">RAID 0（性能优先）</option></select></div>' +
            '<div class="field"><label>选择磁盘</label>' + free.map(d =>
                '<label class="check" style="padding:6px 0"><input type="checkbox" value="' + esc(d.path) + '"> ' +
                esc(d.path) + " · " + fmtBytes(d.size) + " · " + esc(d.model || "未知型号") + "</label>").join("") + "</div>" +
            '<div class="field"><label>输入 ERASE 确认擦除所选磁盘</label><input class="input" id="vconfirm" placeholder="ERASE"></div>',
        buttons: [{ label: "创建", kind: "primary", onClick: async body => {
            const name = $("#vname", body).value.trim();
            const mode = $("#vmode", body).value;
            const selected = $$("input[type=checkbox]:checked", body).map(c => c.value);
            const confirmText = $("#vconfirm", body).value.trim();
            if (!selected.length) throw new Error("请至少选择一块磁盘");
            await api("/api/storage/volumes", { method: "POST", body: { name, mode, disks: selected, confirm: confirmText } });
            toast("存储池 " + name + " 已创建");
            go("storage");
        }}]
    });
}

function snapshotWizard(vols) {
    const targets = (vols || []).filter(v => v.mounted);
    openModal({
        title: "新建快照",
        body:
            '<div class="field"><label>快照名称</label><input class="input" id="sname" placeholder="before-upgrade"></div>' +
            '<div class="field"><label>源目录</label><select class="select" id="ssrc">' +
            targets.map(v => '<option value="/' + esc(v.name) + '">/' + esc(v.name) + "</option>").join("") + "</select></div>" +
            '<p class="hint-text">快照为只读副本，几乎不占用额外空间。</p>',
        buttons: [{ label: "创建", kind: "primary", onClick: async body => {
            const name = $("#sname", body).value.trim();
            const source = $("#ssrc", body).value;
            if (!name) throw new Error("请输入快照名称");
            await api("/api/storage/snapshots", { method: "POST", body: { name, source } });
            toast("快照已创建");
            go("storage");
        }}]
    });
}

/* ---------------------------------------------------------------- 磁盘 */
VIEWS.disks = async view => {
    const res = await api("/api/storage/disks");
    const disks = res.data || [];
    view.innerHTML =
        '<div class="page-head"><div><h1>磁盘信息</h1><div class="desc">查看物理磁盘状态与 S.M.A.R.T. 健康信息</div></div>' +
        '<div class="page-actions"><button class="btn" id="rf">' + IC.refresh + '刷新</button></div></div>' +
        '<div class="card"><div class="card-body table-wrap">' + (disks.length ?
        '<table><thead><tr><th>磁盘</th><th>型号</th><th>容量</th><th>接口</th><th>类型</th><th>状态</th><th></th></tr></thead><tbody>' +
        disks.map(d => {
            const inUse = (d.mountpoints || []).length || (d.partitions || []).some(p => (p.mountpoints || []).length);
            return "<tr><td><div class='cell-main'>" + esc(d.path) + "</div><div class='cell-sub'>" +
                ((d.partitions || []).length ? d.partitions.length + " 个分区" : "未分区") + "</div></td>" +
                "<td>" + esc(d.model || "-") + "</td><td>" + fmtBytes(d.size) + "</td>" +
                "<td>" + esc((d.tran || "sata").toUpperCase()) + "</td>" +
                "<td>" + (d.rotational ? "HDD" : "SSD") + "</td>" +
                '<td><span class="badge ' + (inUse ? "blue" : "") + '"><span class="dot"></span>' + (inUse ? "使用中" : "空闲") + "</span></td>" +
                "<td class='actions'><button class='btn small' data-smart='" + esc(d.path) + "'>S.M.A.R.T.</button></td></tr>";
        }).join("") + "</tbody></table>" : '<div class="empty">未检测到磁盘</div>') + "</div></div>";
    $("#rf").onclick = () => go("disks");
    $$("[data-smart]", view).forEach(b => b.onclick = () => showSmart(b.dataset.smart));
};

async function showSmart(device) {
    let info;
    try { info = (await api("/api/storage/smart?device=" + encodeURIComponent(device))).data; }
    catch (e) { return toast(e.message, "error"); }
    const badge = info.passed ? '<span class="badge green"><span class="dot"></span>良好</span>' : '<span class="badge red"><span class="dot"></span>异常</span>';
    openModal({
        title: "S.M.A.R.T. · " + device,
        wide: true,
        body:
            '<div class="grid grid-4" style="margin-bottom:16px">' +
            '<div><div class="stat-label">健康状态</div><div style="margin-top:6px">' + badge + "</div></div>" +
            '<div><div class="stat-label">温度</div><div class="stat-value" style="font-size:19px">' + (info.temperature != null ? info.temperature + "°C" : "-") + "</div></div>" +
            '<div><div class="stat-label">通电时间</div><div class="stat-value" style="font-size:19px">' + (info.power_on_hours != null ? info.power_on_hours + " 小时" : "-") + "</div></div>" +
            '<div><div class="stat-label">型号</div><div style="margin-top:6px;font-size:12.5px">' + esc(info.model || "-") + "</div></div></div>" +
            (info.attributes && info.attributes.length ?
                '<div class="table-wrap"><table><thead><tr><th>ID</th><th>属性</th><th>当前</th><th>最差</th><th>阈值</th><th>原始值</th></tr></thead><tbody>' +
                info.attributes.map(a => "<tr><td>" + a.id + "</td><td>" + esc(a.name) + "</td><td>" + a.value + "</td><td>" + a.worst +
                    "</td><td>" + a.threshold + "</td><td>" + esc(a.raw) + "</td></tr>").join("") + "</tbody></table></div>"
                : '<div class="empty">' + esc(info.message || "该设备不支持 SMART 或未返回属性") + "</div>"),
        buttons: [
            { label: "关闭" },
            { label: "开始短自检", kind: "primary", onClick: async () => {
                await api("/api/storage/smart/test", { method: "POST", body: { device } });
                toast("SMART 短自检已启动");
            }}
        ]
    });
}

/* ---------------------------------------------------------------- 共享文件夹 */
VIEWS.shares = async view => {
    const res = await api("/api/shares");
    const rows = res.data || [];
    view.innerHTML =
        '<div class="page-head"><div><h1>共享文件夹</h1><div class="desc">通过 SMB / NFS 向局域网共享数据</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="add">' + IC.plus + '新建共享</button></div></div>' +
        '<div class="card"><div class="card-body table-wrap">' + (rows.length ?
        '<table><thead><tr><th>名称</th><th>路径</th><th>协议</th><th>属性</th><th></th></tr></thead><tbody>' +
        rows.map(s =>
            "<tr><td><div class='file-name'><span class='file-icon folder'>" + IC.folder + "</span><div><div class='cell-main'>" +
            esc(s.name) + "</div>" + (s.comment ? "<div class='cell-sub'>" + esc(s.comment) + "</div>" : "") + "</div></div></td>" +
            "<td class='mono' style='font-size:12px'>" + esc(s.path) + "</td>" +
            "<td>" + (s.smb ? '<span class="badge blue">SMB</span> ' : "") + (s.nfs ? '<span class="badge violet">NFS</span>' : "") + "</td>" +
            "<td>" + (s.readonly ? '<span class="badge amber">只读</span> ' : "") + (s.recycle ? '<span class="badge">回收站</span>' : "") + "</td>" +
            "<td class='actions'><button class='btn small' data-edit='" + s.id + "'>" + IC.edit + "编辑</button>" +
            (s.name !== "public" ? "<button class='btn small danger' data-del='" + s.id + "'>" + IC.trash + "删除</button>" : "") + "</td></tr>"
        ).join("") + "</tbody></table>" : '<div class="empty">尚未创建共享文件夹</div>') + "</div></div>";

    $("#add").onclick = () => shareEditor(null);
    $$("[data-edit]", view).forEach(b => b.onclick = () => shareEditor(rows.find(r => r.id == b.dataset.edit)));
    $$("[data-del]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("删除共享", "仅移除共享配置，磁盘上的文件会保留在原路径。", "删除", true)) {
            try { await api("/api/shares/" + b.dataset.del, { method: "DELETE" }); toast("共享已删除"); go("shares"); }
            catch (e) { toast(e.message, "error"); }
        }
    });
};

function shareEditor(share) {
    openModal({
        title: share ? "编辑共享 · " + share.name : "新建共享文件夹",
        body:
            (share ? "" : '<div class="field"><label>名称</label><input class="input" id="sname" placeholder="photos"></div>') +
            '<div class="field"><label>备注</label><input class="input" id="scomment" value="' + esc(share ? share.comment : "") + '"></div>' +
            '<div class="form-grid">' +
            '<label class="check"><input type="checkbox" id="ssmb" ' + (!share || share.smb ? "checked" : "") + "> 启用 SMB（Windows 网络邻居）</label>" +
            '<label class="check"><input type="checkbox" id="snfs" ' + (share && share.nfs ? "checked" : "") + "> 启用 NFS</label>" +
            '<label class="check"><input type="checkbox" id="srecycle" ' + (!share || share.recycle ? "checked" : "") + "> 启用回收站</label>" +
            '<label class="check"><input type="checkbox" id="sro" ' + (share && share.readonly ? "checked" : "") + "> 只读访问</label></div>",
        buttons: [{ label: share ? "保存" : "创建", kind: "primary", onClick: async body => {
            const payload = {
                comment: $("#scomment", body).value.trim(),
                smb: $("#ssmb", body).checked, nfs: $("#snfs", body).checked,
                recycle: $("#srecycle", body).checked, readonly: $("#sro", body).checked
            };
            if (share) {
                await api("/api/shares/" + share.id, { method: "PATCH", body: payload });
                toast("共享已更新");
            } else {
                payload.name = $("#sname", body).value.trim();
                if (!payload.name) throw new Error("请输入共享名称");
                await api("/api/shares", { method: "POST", body: payload });
                toast("共享已创建");
            }
            go("shares");
        }}]
    });
}

/* ---------------------------------------------------------------- 文件管理 */
VIEWS.files = async view => {
    await renderFiles(view, state.filesPath || "/volume1");
};

async function renderFiles(view, path) {
    let res;
    try { res = await api("/api/files?path=" + encodeURIComponent(path)); }
    catch (e) {
        view.innerHTML = '<div class="card"><div class="card-body"><div class="alert critical">' + IC.warn + "<div>" + esc(e.message) + "</div></div></div></div>";
        return;
    }
    const data = res.data;
    state.filesPath = data.path;
    const crumbs = data.path.split("/").filter(Boolean);
    view.innerHTML =
        '<div class="page-head"><div><h1>文件管理</h1><div class="desc">浏览与管理存储卷中的文件</div></div></div>' +
        '<div class="card"><div class="file-toolbar">' +
        '<div class="breadcrumb"><button data-crumb="/">根目录</button>' + crumbs.map((c, i) =>
            '<span class="sep">/</span><button data-crumb="/' + crumbs.slice(0, i + 1).join("/") + '"' +
            (i === crumbs.length - 1 ? ' class="current"' : "") + ">" + esc(c) + "</button>").join("") + "</div>" +
        '<button class="btn small" id="mkdir">' + IC.plus + '新建文件夹</button>' +
        '<button class="btn small" id="uploadBtn">' + IC.upload + "上传</button>" +
        '<input type="file" id="uploadInput" multiple class="hidden">' +
        '<button class="btn small" id="rf">' + IC.refresh + "刷新</button></div>" +
        '<div class="card-body table-wrap" style="padding-top:6px">' + (data.entries.length ?
        '<table><thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th>权限</th><th></th></tr></thead><tbody>' +
        data.entries.map(f =>
            "<tr class='file-row " + (f.type === "dir" ? "dir" : "") + "' data-path='" + esc(f.path) + "' data-type='" + f.type + "'>" +
            "<td><div class='file-name'><span class='file-icon " + (f.type === "dir" ? "folder" : "") + "'>" + (f.type === "dir" ? IC.folder : IC.file) +
            "</span><span class='cell-main'>" + esc(f.name) + "</span></div></td>" +
            "<td>" + (f.type === "dir" ? "-" : fmtBytes(f.size)) + "</td><td>" + fmtDate(f.mtime) + "</td><td class='mono' style='font-size:12px'>" + esc(f.mode) + "</td>" +
            "<td class='actions'>" + (f.type === "file" ? "<button class='btn small' data-dl='" + esc(f.path) + "'>" + IC.download + "下载</button>" : "") +
            "<button class='btn small' data-rn='" + esc(f.path) + "'>" + IC.edit + "重命名</button>" +
            "<button class='btn small danger' data-del='" + esc(f.path) + "'>" + IC.trash + "</button></td></tr>").join("") +
        "</tbody></table>" : '<div class="empty">空目录</div>') + "</div></div>";

    $$("[data-crumb]", view).forEach(b => b.onclick = () => renderFiles(view, b.dataset.crumb === "/" ? "/volume1" : b.dataset.crumb));
    $$(".file-row.dir", view).forEach(r => r.addEventListener("dblclick", () => renderFiles(view, r.dataset.path)));
    $("#rf", view).onclick = () => renderFiles(view, state.filesPath);
    $("#mkdir", view).onclick = () => openModal({
        title: "新建文件夹",
        body: '<div class="field"><label>名称</label><input class="input" id="dname"></div>',
        buttons: [{ label: "创建", kind: "primary", onClick: async body => {
            const name = $("#dname", body).value.trim();
            if (!name) throw new Error("请输入名称");
            await api("/api/files/mkdir", { method: "POST", body: { path: state.filesPath, name } });
            toast("文件夹已创建");
            renderFiles(view, state.filesPath);
        }}]
    });
    const input = $("#uploadInput", view);
    $("#uploadBtn", view).onclick = () => input.click();
    input.onchange = async () => {
        if (!input.files.length) return;
        const fd = new FormData();
        fd.append("path", state.filesPath);
        Array.from(input.files).forEach(f => fd.append("file", f));
        try {
            const r = await api("/api/files/upload", { method: "POST", body: fd });
            toast("已上传 " + (r.saved || []).length + " 个文件");
            renderFiles(view, state.filesPath);
        } catch (e) { toast(e.message, "error"); }
    };
    $$("[data-dl]", view).forEach(b => b.onclick = () => {
        window.open("/api/files/download?path=" + encodeURIComponent(b.dataset.dl), "_blank");
    });
    $$("[data-rn]", view).forEach(b => b.onclick = () => {
        const old = b.dataset.rn.split("/").pop();
        openModal({
            title: "重命名",
            body: '<div class="field"><label>新名称</label><input class="input" id="nname" value="' + esc(old) + '"></div>',
            buttons: [{ label: "保存", kind: "primary", onClick: async body => {
                const name = $("#nname", body).value.trim();
                if (!name) throw new Error("请输入名称");
                await api("/api/files/rename", { method: "POST", body: { path: b.dataset.rn, name } });
                toast("已重命名");
                renderFiles(view, state.filesPath);
            }}]
        });
    });
    $$("[data-del]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("删除文件", "文件将被移入回收站 <b>#recycle</b>。", "删除", true)) {
            try { await api("/api/files?path=" + encodeURIComponent(b.dataset.del), { method: "DELETE" }); toast("已移入回收站"); renderFiles(view, state.filesPath); }
            catch (e) { toast(e.message, "error"); }
        }
    });
}

/* ---------------------------------------------------------------- 套件中心 */
VIEWS.packages = async view => {
    const res = await api("/api/packages");
    const { categories, apps } = res.data;
    const cat = state.pkgCategory;
    const shown = cat === "全部" ? apps : apps.filter(a => a.category === cat);
    view.innerHTML =
        '<div class="page-head"><div><h1>套件中心</h1><div class="desc">一键部署常用服务，基于 Docker 运行' +
        (res.docker_available ? "" : "（Docker 当前不可用）") + "</div></div>" +
        '<div class="page-actions"><button class="btn" id="rf">' + IC.refresh + '刷新</button></div></div>' +
        '<div class="pkg-tabs">' + (categories || ["全部"]).map(c =>
            '<button class="pkg-tab' + (c === cat ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>").join("") + "</div>" +
        '<div class="pkg-grid">' + (shown.length ? shown.map(a => {
            const status = a.status === "running" ? '<span class="badge green"><span class="dot"></span>运行中</span>'
                : a.status === "stopped" ? '<span class="badge amber"><span class="dot"></span>已停止</span>'
                : '<span class="badge">未安装</span>';
            return '<div class="card pkg-card"><div class="pkg-icon" style="background:' + esc(a.color || "#0b74d9") + '">' + esc(a.icon || a.name.slice(0, 2)) + "</div>" +
                '<div class="pkg-main"><div class="pkg-title"><h3>' + esc(a.name) + "</h3>" + status + "</div>" +
                '<div class="pkg-vendor">' + esc(a.vendor || "") + " · " + esc(a.category || "") + "</div>" +
                '<div class="pkg-desc">' + esc(a.description || "") + "</div>" +
                '<div class="pkg-actions">' +
                (!a.installed ? '<button class="btn small primary" data-ins="' + a.id + '">安装</button>' : "") +
                (a.installed && !a.running ? '<button class="btn small" data-start="' + a.id + '">' + IC.play + "启动</button>" : "") +
                (a.running ? '<button class="btn small" data-stop="' + a.id + '">' + IC.stop + "停止</button>" : "") +
                (a.installed ? '<button class="btn small" data-re="' + a.id + '">' + IC.restart + "重启</button>" : "") +
                (a.installed ? '<button class="btn small danger" data-uni="' + a.id + '">卸载</button>' : "") +
                (a.running && a.web_port ? '<button class="btn small ghost" data-open="' + a.web_port + '">' + IC.ext + "打开界面</button>" : "") +
                "</div>" +
                '<div class="pkg-meta"><span>' + esc(a.image || "") + "</span>" + (a.web_port ? "<span>端口 " + a.web_port + "</span>" : "") + "</div>" +
                "</div></div>";
        }).join("") : '<div class="card"><div class="card-body"><div class="empty">该分类下暂无套件</div></div></div>') + "</div>";

    $("#rf").onclick = () => go("packages");
    $$(".pkg-tab", view).forEach(b => b.onclick = () => { state.pkgCategory = b.dataset.cat; go("packages"); });
    const act = async (path, msg) => {
        try { await api(path, { method: "POST" }); toast(msg); go("packages"); }
        catch (e) { toast(e.message, "error"); }
    };
    $$("[data-ins]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("安装套件", "将从镜像仓库拉取镜像并创建容器，首次安装需要较长时间。")) {
            toast("正在安装，请稍候…", "warning");
            act("/api/packages/" + b.dataset.ins + "/install", "套件已安装");
        }
    });
    $$("[data-uni]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("卸载套件", "将删除该套件的容器。数据目录默认保留。", "卸载", true)) act("/api/packages/" + b.dataset.uni + "/uninstall", "套件已卸载");
    });
    $$("[data-start]", view).forEach(b => b.onclick = () => act("/api/packages/" + b.dataset.start + "/start", "已启动"));
    $$("[data-stop]", view).forEach(b => b.onclick = () => act("/api/packages/" + b.dataset.stop + "/stop", "已停止"));
    $$("[data-re]", view).forEach(b => b.onclick = () => act("/api/packages/" + b.dataset.re + "/restart", "已重启"));
    $$("[data-open]", view).forEach(b => b.onclick = () => window.open(location.protocol + "//" + location.hostname + ":" + b.dataset.open, "_blank"));
};

/* ---------------------------------------------------------------- Docker */
VIEWS.docker = async view => {
    const res = await api("/api/docker/containers");
    const rows = res.data || [];
    view.innerHTML =
        '<div class="page-head"><div><h1>Docker 容器</h1><div class="desc">管理运行在 DJOS 上的所有容器</div></div>' +
        '<div class="page-actions"><button class="btn" id="rf">' + IC.refresh + "刷新</button></div></div>" +
        (!res.available ? '<div class="alert warning">' + IC.warn + "<div>Docker 服务不可用，请检查系统安装状态。</div></div>" : "") +
        '<div class="card mt"><div class="card-body table-wrap">' + (rows.length ?
        '<table><thead><tr><th>容器</th><th>镜像</th><th>状态</th><th>端口</th><th></th></tr></thead><tbody>' +
        rows.map(c =>
            "<tr><td><div class='cell-main'>" + esc(c.name) + "</div><div class='cell-sub mono'>" + esc(c.id) + "</div></td>" +
            "<td class='mono' style='font-size:12px'>" + esc(c.image) + "</td>" +
            '<td><span class="badge ' + (c.running ? "green" : "") + '"><span class="dot"></span>' + (c.running ? "运行中" : "已停止") + '</span> <span class="cell-sub">' + esc(c.status) + "</span></td>" +
            "<td class='mono' style='font-size:11.5px'>" + esc(c.ports || "-") + "</td>" +
            "<td class='actions'>" +
            (c.running ? "<button class='btn small' data-stop='" + esc(c.name) + "'>" + IC.stop + "停止</button>"
                       : "<button class='btn small' data-start='" + esc(c.name) + "'>" + IC.play + "启动</button>") +
            "<button class='btn small' data-logs='" + esc(c.name) + "'>日志</button>" +
            "<button class='btn small danger' data-rm='" + esc(c.name) + "'>" + IC.trash + "</button></td></tr>").join("") +
        "</tbody></table>" : '<div class="empty">暂无容器，可前往套件中心安装应用</div>') + "</div></div>";

    $("#rf").onclick = () => go("docker");
    const act = async (name, action, msg) => {
        try { await api("/api/docker/containers/" + name + "/" + action, { method: "POST" }); toast(msg); go("docker"); }
        catch (e) { toast(e.message, "error"); }
    };
    $$("[data-start]", view).forEach(b => b.onclick = () => act(b.dataset.start, "start", "容器已启动"));
    $$("[data-stop]", view).forEach(b => b.onclick = () => act(b.dataset.stop, "stop", "容器已停止"));
    $$("[data-rm]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("删除容器", "确定删除容器 <b>" + esc(b.dataset.rm) + "</b>？", "删除", true)) act(b.dataset.rm, "remove", "容器已删除");
    });
    $$("[data-logs]", view).forEach(b => b.onclick = async () => {
        try {
            const r = await api("/api/docker/containers/" + b.dataset.logs + "/logs");
            openModal({ title: "容器日志 · " + b.dataset.logs, wide: true, body: '<div class="log-view">' + esc(r.data.logs || "(无日志)") + "</div>", buttons: [{ label: "关闭" }] });
        } catch (e) { toast(e.message, "error"); }
    });
};

/* ---------------------------------------------------------------- 备份 */
VIEWS.backup = async view => {
    const [jobRes, runRes] = await Promise.all([api("/api/backup/jobs"), api("/api/backup/runs")]);
    const jobs = jobRes.data || [], runs = runRes.data || [];
    view.innerHTML =
        '<div class="page-head"><div><h1>备份任务</h1><div class="desc">支持 Btrfs 快照与 rsync 异地备份，cron 计划执行</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="add">' + IC.plus + "新建任务</button></div></div>" +
        '<div class="card"><div class="card-head"><div><h2>任务列表</h2></div></div><div class="card-body table-wrap">' + (jobs.length ?
        '<table><thead><tr><th>任务</th><th>模式</th><th>计划</th><th>最近执行</th><th>状态</th><th></th></tr></thead><tbody>' +
        jobs.map(j =>
            "<tr><td><div class='cell-main'>" + esc(j.name) + "</div><div class='cell-sub mono'>" + esc(j.source) + (j.dest ? " → " + esc(j.dest) : "") + "</div></td>" +
            "<td>" + (j.mode === "snapshot" ? '<span class="badge violet">快照</span>' : '<span class="badge blue">rsync</span>') + "</td>" +
            "<td class='mono' style='font-size:12px'>" + esc(j.cron) + "</td>" +
            "<td>" + (j.last_run ? fmtDate(j.last_run.started_at) + " " + runBadge(j.last_run.status) : "-") + "</td>" +
            "<td>" + (j.enabled ? '<span class="badge green"><span class="dot"></span>启用</span>' : '<span class="badge">停用</span>') + "</td>" +
            "<td class='actions'><button class='btn small' data-run='" + j.id + "'>" + IC.play + "执行</button>" +
            "<button class='btn small' data-edit='" + j.id + "'>" + IC.edit + "</button>" +
            "<button class='btn small danger' data-del='" + j.id + "'>" + IC.trash + "</button></td></tr>").join("") +
        "</tbody></table>" : '<div class="empty">暂无备份任务</div>') + "</div></div>" +
        '<div class="card mt"><div class="card-head"><div><h2>执行记录</h2></div></div><div class="card-body table-wrap">' + (runs.length ?
        '<table><thead><tr><th>任务</th><th>开始</th><th>结束</th><th>结果</th><th>说明</th></tr></thead><tbody>' +
        runs.map(r => "<tr><td>" + esc(r.job_name || "#" + r.job_id) + "</td><td>" + fmtDate(r.started_at) + "</td><td>" + fmtDate(r.finished_at) +
            "</td><td>" + runBadge(r.status) + "</td><td class='cell-sub'>" + esc((r.message || "").slice(0, 80)) + "</td></tr>").join("") +
        "</tbody></table>" : '<div class="empty">暂无执行记录</div>') + "</div></div>";

    $("#add").onclick = () => backupEditor(null);
    $$("[data-edit]", view).forEach(b => b.onclick = () => backupEditor(jobs.find(j => j.id == b.dataset.edit)));
    $$("[data-run]", view).forEach(b => b.onclick = async () => {
        try { await api("/api/backup/jobs/" + b.dataset.run + "/run", { method: "POST" }); toast("任务已开始执行"); setTimeout(() => go("backup"), 1500); }
        catch (e) { toast(e.message, "error"); }
    });
    $$("[data-del]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("删除任务", "确定删除该备份任务？", "删除", true)) {
            try { await api("/api/backup/jobs/" + b.dataset.del, { method: "DELETE" }); toast("任务已删除"); go("backup"); }
            catch (e) { toast(e.message, "error"); }
        }
    });
};

function runBadge(s) {
    if (s === "success") return '<span class="badge green"><span class="dot"></span>成功</span>';
    if (s === "running") return '<span class="badge blue"><span class="dot"></span>进行中</span>';
    return '<span class="badge red"><span class="dot"></span>' + esc(s || "失败") + "</span>";
}

function backupEditor(job) {
    openModal({
        title: job ? "编辑备份任务" : "新建备份任务",
        body:
            '<div class="field"><label>任务名称</label><input class="input" id="bname" value="' + esc(job ? job.name : "") + '"></div>' +
            (job ? "" :
            '<div class="form-grid"><div class="field"><label>备份模式</label><select class="select" id="bmode">' +
            '<option value="snapshot">本地快照（Btrfs）</option><option value="rsync">rsync 复制到其他目录</option></select></div>' +
            '<div class="field"><label>计划（cron）</label><input class="input" id="bcron" value="0 2 * * *"></div></div>' +
            '<div class="field"><label>源目录</label><input class="input" id="bsrc" value="/volume1/public"></div>' +
            '<div class="field" id="bdestWrap"><label>目标目录（rsync 模式）</label><input class="input" id="bdest" value="/volume1/backups"></div>') +
            (job ? '<div class="field"><label>计划（cron）</label><input class="input" id="bcron" value="' + esc(job.cron) + '"></div>' +
            '<label class="check"><input type="checkbox" id="benabled" ' + (job.enabled ? "checked" : "") + "> 启用该任务</label>" : "") +
            '<p class="hint-text">cron 格式：分 时 日 月 周，例如 <span class="mono">0 2 * * *</span> 表示每天凌晨 2 点。</p>',
        buttons: [{ label: job ? "保存" : "创建", kind: "primary", onClick: async body => {
            if (job) {
                await api("/api/backup/jobs/" + job.id, { method: "PATCH", body: {
                    name: $("#bname", body).value.trim(), cron: $("#bcron", body).value.trim(),
                    enabled: $("#benabled", body).checked
                }});
                toast("任务已更新");
            } else {
                const mode = $("#bmode", body).value;
                await api("/api/backup/jobs", { method: "POST", body: {
                    name: $("#bname", body).value.trim(), mode,
                    source: $("#bsrc", body).value.trim(),
                    dest: mode === "rsync" ? $("#bdest", body).value.trim() : "",
                    cron: $("#bcron", body).value.trim()
                }});
                toast("任务已创建");
            }
            go("backup");
        }}]
    });
    if (!job) {
        const body = $(".modal-body");
        const modeSel = $("#bmode", body), destWrap = $("#bdestWrap", body);
        const sync = () => destWrap.style.display = modeSel.value === "rsync" ? "" : "none";
        modeSel.onchange = sync; sync();
    }
}

/* ---------------------------------------------------------------- 用户 */
VIEWS.users = async view => {
    const res = await api("/api/users");
    const rows = res.data || [];
    view.innerHTML =
        '<div class="page-head"><div><h1>用户管理</h1><div class="desc">管理系统账户与访问权限</div></div>' +
        '<div class="page-actions"><button class="btn primary" id="add">' + IC.plus + "新建用户</button></div></div>" +
        '<div class="card"><div class="card-body table-wrap">' +
        '<table><thead><tr><th>用户</th><th>角色</th><th>邮箱</th><th>最近登录</th><th>状态</th><th></th></tr></thead><tbody>' +
        rows.map(u =>
            "<tr><td><div class='row-flex'><span class='avatar' style='width:30px;height:30px;font-size:12px'>" + esc(u.username.slice(0, 1).toUpperCase()) + "</span>" +
            "<div><div class='cell-main'>" + esc(u.username) + "</div><div class='cell-sub'>创建于 " + fmtDate(u.created_at) + "</div></div></div></td>" +
            "<td>" + (u.role === "admin" ? '<span class="badge violet">管理员</span>' : '<span class="badge">用户</span>') + "</td>" +
            "<td>" + esc(u.email || "-") + "</td><td>" + fmtDate(u.last_login) + "</td>" +
            "<td>" + (u.disabled ? '<span class="badge red">已停用</span>' : '<span class="badge green"><span class="dot"></span>正常</span>') + "</td>" +
            "<td class='actions'><button class='btn small' data-edit='" + u.id + "'>" + IC.edit + "编辑</button>" +
            (u.username !== "admin" ? "<button class='btn small danger' data-del='" + u.id + "'>" + IC.trash + "</button>" : "") + "</td></tr>").join("") +
        "</tbody></table></div></div>";

    $("#add").onclick = () => userEditor(null);
    $$("[data-edit]", view).forEach(b => b.onclick = () => userEditor(rows.find(u => u.id == b.dataset.edit)));
    $$("[data-del]", view).forEach(b => b.onclick = async () => {
        if (await confirmBox("删除用户", "将同时删除系统账户及其家目录访问权限。", "删除", true)) {
            try { await api("/api/users/" + b.dataset.del, { method: "DELETE" }); toast("用户已删除"); go("users"); }
            catch (e) { toast(e.message, "error"); }
        }
    });
};

function userEditor(user) {
    openModal({
        title: user ? "编辑用户 · " + user.username : "新建用户",
        body:
            (user ? "" : '<div class="field"><label>用户名</label><input class="input" id="uname" placeholder="xiaoming"></div>' +
            '<div class="field"><label>初始密码（至少 8 位）</label><input class="input" type="password" id="upwd"></div>') +
            (user ? '<div class="field"><label>重置密码（留空则不修改）</label><input class="input" type="password" id="upwd"></div>' : "") +
            '<div class="field"><label>邮箱</label><input class="input" id="uemail" value="' + esc(user ? user.email : "") + '"></div>' +
            '<div class="form-grid">' +
            (user && user.username === "admin" ? "" :
            '<label class="check"><input type="checkbox" id="urole" ' + (user && user.role === "admin" ? "checked" : "") + "> 授予管理员权限</label>" +
            (user ? '<label class="check"><input type="checkbox" id="udisabled" ' + (user.disabled ? "checked" : "") + "> 停用该账户</label>" : "")) +
            "</div>",
        buttons: [{ label: user ? "保存" : "创建", kind: "primary", onClick: async body => {
            if (user) {
                const payload = { email: $("#uemail", body).value.trim() };
                const pwd = $("#upwd", body).value;
                if (pwd) payload.password = pwd;
                const roleEl = $("#urole", body), disEl = $("#udisabled", body);
                if (roleEl) payload.role = roleEl.checked ? "admin" : "user";
                if (disEl) payload.disabled = disEl.checked;
                await api("/api/users/" + user.id, { method: "PATCH", body: payload });
                toast("用户已更新");
            } else {
                const username = $("#uname", body).value.trim();
                const password = $("#upwd", body).value;
                if (!username) throw new Error("请输入用户名");
                if (password.length < 8) throw new Error("密码至少 8 位");
                await api("/api/users", { method: "POST", body: {
                    username, password, email: $("#uemail", body).value.trim(),
                    role: $("#urole", body) && $("#urole", body).checked ? "admin" : "user"
                }});
                toast("用户已创建");
            }
            go("users");
        }}]
    });
}

/* ---------------------------------------------------------------- 设置 */
VIEWS.settings = async view => {
    const [infoRes, setRes] = await Promise.all([api("/api/system/info"), api("/api/settings")]);
    const info = infoRes.data, cfg = setRes.data || {};
    const zones = ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Singapore", "Asia/Tokyo", "UTC", "Europe/London", "America/New_York", "America/Los_Angeles"];
    view.innerHTML =
        '<div class="page-head"><div><h1>系统设置</h1><div class="desc">主机名、网络、时间与服务选项</div></div>' +
        '<div class="page-actions">' +
        '<button class="btn" id="rebootBtn">' + IC.refresh + '重启</button>' +
        '<button class="btn danger" id="haltBtn">' + IC.power + '关机</button></div></div>' +

        '<div class="grid grid-2">' +
        '<div class="card"><div class="card-head"><div><h2>设备信息</h2></div></div><div class="card-body"><dl class="info-list">' +
        "<dt>主机名</dt><dd>" + esc(cfg.hostname || info.hostname) + "</dd>" +
        "<dt>型号</dt><dd>" + esc(info.model) + "</dd>" +
        "<dt>CPU</dt><dd>" + esc(info.cpu_model) + "（" + info.cpu_cores + " 核）</dd>" +
        "<dt>内存</dt><dd>" + fmtBytes(info.memory_total) + "</dd>" +
        "<dt>系统</dt><dd>" + esc(info.os) + "</dd>" +
        "<dt>内核</dt><dd>" + esc(info.kernel) + "（" + esc(info.arch) + "）</dd>" +
        "<dt>系统版本</dt><dd>DJOS v" + esc(info.version) + "</dd>" +
        "<dt>启动时间</dt><dd>" + fmtDate(info.boot_time) + "</dd></dl></div></div>" +

        '<div class="card"><div class="card-head"><div><h2>常规设置</h2></div></div><div class="card-body">' +
        '<div class="field"><label>主机名</label><input class="input" id="hostname" value="' + esc(cfg.hostname || info.hostname) + '"></div>' +
        '<div class="field"><label>时区</label><select class="select" id="timezone">' +
        zones.map(z => '<option value="' + z + '"' + (z === (cfg.timezone || "Asia/Shanghai") ? " selected" : "") + ">" + z + "</option>").join("") +
        "</select></div>" +
        '<div class="switch-row"><div><div class="t">SSH 远程登录</div><div class="d">允许通过 SSH 管理本机（端口 22）</div></div>' +
        '<label class="switch"><input type="checkbox" id="ssh" ' + ((cfg.ssh_enabled === "1" || cfg.ssh_enabled === true) ? "checked" : "") + "><span></span></label></div>" +
        '<div class="switch-row"><div><div class="t">自动安装安全更新</div><div class="d">每日自动应用系统安全补丁</div></div>' +
        '<label class="switch"><input type="checkbox" id="autoupdate" ' + (cfg.auto_update === "1" ? "checked" : "") + "><span></span></label></div>" +
        '<div class="form-actions"><button class="btn primary" id="saveCfg">保存设置</button></div></div></div></div>' +

        '<div class="card mt"><div class="card-head"><div><h2>修改我的密码</h2></div></div><div class="card-body">' +
        '<div class="form-grid"><div class="field"><label>当前密码</label><input class="input" type="password" id="oldpwd"></div>' +
        '<div class="field"><label>新密码（至少 8 位）</label><input class="input" type="password" id="newpwd"></div></div>' +
        '<div class="form-actions"><button class="btn primary" id="savePwd">更新密码</button></div></div></div>';

    $("#saveCfg").onclick = async () => {
        try {
            await api("/api/settings", { method: "PATCH", body: {
                hostname: $("#hostname").value.trim(),
                timezone: $("#timezone").value,
                ssh_enabled: $("#ssh").checked ? "1" : "0",
                auto_update: $("#autoupdate").checked ? "1" : "0"
            }});
            toast("设置已保存");
        } catch (e) { toast(e.message, "error"); }
    };
    $("#savePwd").onclick = async () => {
        try {
            await api("/api/auth/password", { method: "POST", body: { old_password: $("#oldpwd").value, new_password: $("#newpwd").value } });
            toast("密码已更新");
        } catch (e) { toast(e.message, "error"); }
    };
    $("#rebootBtn").onclick = async () => {
        if (await confirmBox("重启系统", "系统将在数秒后重启，期间无法访问。", "重启")) {
            try { await api("/api/system/reboot", { method: "POST" }); toast("系统正在重启…", "warning"); }
            catch (e) { toast(e.message, "error"); }
        }
    };
    $("#haltBtn").onclick = async () => {
        if (await confirmBox("关闭系统", "系统将关机，需要手动按电源键重新开机。", "关机", true)) {
            try { await api("/api/system/shutdown", { method: "POST" }); toast("系统正在关机…", "warning"); }
            catch (e) { toast(e.message, "error"); }
        }
    };
};

/* ---------------------------------------------------------------- 日志 */
VIEWS.logs = async view => {
    await renderLogs(view);
};

async function renderLogs(view) {
    const tab = state.logTab;
    let bodyHtml;
    if (tab === "system") {
        const res = await api("/api/system/logs?lines=300");
        bodyHtml = '<div class="log-view">' + esc(res.data.lines || "(无日志)") + "</div>";
    } else {
        const res = await api("/api/system/audit");
        const rows = res.data || [];
        bodyHtml = '<div class="table-wrap"><table><thead><tr><th>时间</th><th>用户</th><th>操作</th><th>详情</th></tr></thead><tbody>' +
            (rows.length ? rows.map(r => "<tr><td>" + fmtDate(r.at) + "</td><td>" + esc(r.user) + "</td><td>" + esc(actionName(r.action)) +
                "</td><td class='cell-sub'>" + esc((r.detail || "").slice(0, 90)) + "</td></tr>").join("")
                : '<tr><td colspan="4"><div class="empty">暂无审计记录</div></td></tr>') + "</tbody></table></div>";
    }
    view.innerHTML =
        '<div class="page-head"><div><h1>日志中心</h1><div class="desc">系统运行日志与操作审计</div></div>' +
        '<div class="page-actions"><button class="btn" id="rf">' + IC.refresh + "刷新</button></div></div>" +
        '<div class="card"><div class="tabs">' +
        '<button class="tab' + (tab === "system" ? " active" : "") + '" data-tab="system">系统日志</button>' +
        '<button class="tab' + (tab === "audit" ? " active" : "") + '" data-tab="audit">操作审计</button></div>' +
        '<div class="card-body">' + bodyHtml + "</div></div>";
    $("#rf").onclick = () => renderLogs(view);
    $$(".tab", view).forEach(b => b.onclick = () => { state.logTab = b.dataset.tab; renderLogs(view); });
}

/* ================================================================ 演示模式 */
const DEMO = (() => {
    let t = 0;
    const start = Date.now() - 5 * 86400 * 1000;
    function tick() { t++; return t; }
    const vols = [
        { id: 1, name: "volume1", mountpoint: "/volume1", fs: "btrfs", disks: ["/dev/sda"], total: 1.8e12, used: 6.2e11, free: 1.18e12, percent: 34.4, mounted: true },
        { id: 2, name: "volume2", mountpoint: "/volume2", fs: "btrfs", disks: ["/dev/sdb", "/dev/sdc"], total: 7.2e12, used: 4.9e12, free: 2.3e12, percent: 68.1, mounted: true }
    ];
    const apps = [
        { id: "jellyfin", name: "Jellyfin", vendor: "Jellyfin", category: "媒体", tagline: "开源影音中心", description: "电影、剧集、音乐与照片的私人流媒体服务，支持硬件转码与多端播放。", icon: "JF", color: "#7b2ff7", image: "jellyfin/jellyfin:latest", web_port: 8096, installed: true, running: true, status: "running" },
        { id: "qbittorrent", name: "qBittorrent", vendor: "linuxserver.io", category: "下载", tagline: "BT / PT 下载器", description: "功能完整的 BitTorrent 客户端，内置 Web 界面，支持 RSS 与限速。", icon: "QB", color: "#2f6fed", image: "linuxserver/qbittorrent:latest", web_port: 8081, installed: true, running: false, status: "stopped" },
        { id: "syncthing", name: "Syncthing", vendor: "Syncthing", category: "同步", tagline: "点对点文件同步", description: "去中心化的文件夹同步工具，跨设备实时同步，无需公网 IP。", icon: "ST", color: "#0e9f6e", image: "linuxserver/syncthing:latest", installed: false, running: false, status: "not_installed" },
        { id: "nextcloud", name: "Nextcloud", vendor: "Nextcloud", category: "同步", tagline: "私有云盘与办公", description: "私有云盘、日历、联系人与在线文档协作平台。", icon: "NC", color: "#0082c9", image: "nextcloud:latest", web_port: 8443, installed: false, running: false, status: "not_installed" },
        { id: "home-assistant", name: "Home Assistant", vendor: "home-assistant", category: "家庭", tagline: "智能家居中枢", description: "连接并自动化家中上千种智能设备。", icon: "HA", color: "#18bcf2", image: "homeassistant/home-assistant:stable", installed: false, running: false, status: "not_installed" },
        { id: "gitea", name: "Gitea", vendor: "Gitea", category: "开发", tagline: "轻量 Git 服务", description: "自托管的 Git 代码托管与协作平台。", icon: "GT", color: "#609926", image: "gitea/gitea:latest", web_port: 3000, installed: false, running: false, status: "not_installed" }
    ];
    const users = [
        { id: 1, username: "admin", role: "admin", email: "", must_change: false, disabled: false, last_login: "2026-10-26 09:12:00", created_at: "2026-10-21 10:00:00" },
        { id: 2, username: "family", role: "user", email: "family@home.lan", must_change: false, disabled: false, last_login: "2026-10-25 21:40:00", created_at: "2026-10-21 10:05:00" }
    ];
    const auditRows = [
        { id: 9, at: "2026-10-26 09:12:00", user: "admin", action: "login", detail: "192.168.1.20" },
        { id: 8, at: "2026-10-26 02:00:01", user: "system", action: "run_backup_job", detail: "每日快照" },
        { id: 7, at: "2026-10-25 22:14:33", user: "admin", action: "install_package", detail: "jellyfin" },
        { id: 6, at: "2026-10-25 21:40:02", user: "family", action: "login", detail: "192.168.1.32" },
        { id: 5, at: "2026-10-25 18:02:11", user: "admin", action: "create_share", detail: "photos" },
        { id: 4, at: "2026-10-24 11:30:00", user: "admin", action: "create_user", detail: "family" }
    ];
    function status() {
        const n = tick();
        return {
            hostname: "DJOS", uptime: Math.floor((Date.now() - start) / 1000),
            load: [0.42, 0.38, 0.35],
            cpu: { percent: Math.round(18 + Math.sin(n / 4) * 10 + Math.random() * 8), cores: 4, model: "Intel(R) Celeron(R) J4125", temperature: 46 },
            memory: { total: 8.0e9, used: 2.6e9 + Math.sin(n / 5) * 3e8, available: 5.4e9, percent: Math.round(32 + Math.sin(n / 5) * 4), swap_total: 2e9, swap_used: 0 },
            network: { rx_bps: 8e6 + Math.random() * 4e6, tx_bps: 1.2e6 + Math.random() * 8e5 },
            volumes: vols, alerts: [], time: Math.floor(Date.now() / 1000)
        };
    }
    return { status, vols, apps, users, auditRows };
})();

async function demoApi(path, opts) {
    await new Promise(r => setTimeout(r, 120));
    const m = (opts && opts.method) || "GET";
    const ok = p => ({ ok: true, ...p });
    if (path === "/api/auth/me") return ok({ user: state.user, csrf: "demo", version: "1.0.0", hostname: "DJOS" });
    if (path === "/api/dashboard") { const s = DEMO.status(); s.version = "1.0.0"; s.model = "DJOS NAS (J4125)"; return ok({ data: s }); }
    if (path === "/api/system/status") return ok({ data: DEMO.status() });
    if (path === "/api/system/info") return ok({ data: {
        hostname: "DJOS", model: "DJOS NAS", serial: "DEMO", bios: "", cpu_model: "Intel(R) Celeron(R) J4125", cpu_cores: 4,
        memory_total: 8.0e9, os: "DJOS 1.0 (Debian 12)", kernel: "6.1.0-djos", arch: "x86_64", version: "1.0.0",
        boot_time: Math.floor((Date.now() - 5 * 86400 * 1000) / 1000),
        settings: { hostname: "DJOS", timezone: "Asia/Shanghai", ssh_enabled: false, auto_update: true }
    }});
    if (path === "/api/system/logs") return ok({ data: { lines:
        "2026-10-26T09:12:01 djos systemd[1]: Started DJOS Web API.\n" +
        "2026-10-26T09:12:03 djos smbd[812]: smbd version 4.19 started.\n" +
        "2026-10-26T09:12:03 djos kernel: BTRFS info: device label volume1 mounted on /volume1\n" +
        "2026-10-26T02:00:01 djos djos-backup[640]: snapshot job 'daily' finished: success\n" +
        "2026-10-25T22:14:40 djos dockerd[733]: Container djos-jellyfin started." } });
    if (path === "/api/system/audit") return ok({ data: DEMO.auditRows });
    if (path === "/api/storage/volumes") return ok({ data: DEMO.vols });
    if (path === "/api/storage/disks") return ok({ data: [
        { name: "sda", path: "/dev/sda", size: 2.0e12, tran: "sata", model: "ST2000DM008", serial: "WDX1", rotational: true, fstype: "btrfs", mountpoints: ["/volume1"], partitions: [{ name: "sda1", path: "/dev/sda1", size: 2.0e12, fstype: "btrfs", mountpoints: ["/volume1"] }] },
        { name: "sdb", path: "/dev/sdb", size: 4.0e12, tran: "sata", model: "WDC WD40EFRX", serial: "WDX2", rotational: true, fstype: "btrfs", mountpoints: ["/volume2"], partitions: [] },
        { name: "sdc", path: "/dev/sdc", size: 4.0e12, tran: "sata", model: "WDC WD40EFRX", serial: "WDX3", rotational: true, fstype: "btrfs", mountpoints: ["/volume2"], partitions: [] },
        { name: "nvme0n1", path: "/dev/nvme0n1", size: 2.56e11, tran: "nvme", model: "SN580 256G", serial: "NV01", rotational: false, fstype: "ext4", mountpoints: ["/"], partitions: [] }
    ]});
    if (path.startsWith("/api/storage/smart")) return ok({ data: { ok: true, device: "/dev/sda", model: "ST2000DM008-2FR102", serial: "WDX1", health: "良好", passed: true, temperature: 38, power_on_hours: 4320, attributes: [
        { id: 1, name: "Raw_Read_Error_Rate", value: 118, worst: 99, threshold: 6, raw: "186675872" },
        { id: 5, name: "Reallocated_Sector_Ct", value: 100, worst: 100, threshold: 10, raw: "0" },
        { id: 9, name: "Power_On_Hours", value: 95, worst: 95, threshold: 0, raw: "4320" },
        { id: 194, name: "Temperature_Celsius", value: 62, worst: 55, threshold: 0, raw: "38" }
    ]}});
    if (path === "/api/storage/snapshots") return ok({ data: [
        { job: "daily", name: "daily-20261026-0200", path: "/volume1/@snapshots/daily/daily-20261026-0200", created: Math.floor(Date.now() / 1000) - 7 * 3600 },
        { job: "daily", name: "daily-20261025-0200", path: "/volume1/@snapshots/daily/daily-20261025-0200", created: Math.floor(Date.now() / 1000) - 31 * 3600 }
    ]});
    if (path === "/api/shares") return ok({ data: [
        { id: 1, name: "public", path: "/volume1/public", comment: "公共共享", smb: true, nfs: false, recycle: true, readonly: false, created_at: "2026-10-21 10:00:00", exists: true },
        { id: 2, name: "photos", path: "/volume1/photos", comment: "家庭相册", smb: true, nfs: false, recycle: true, readonly: false, created_at: "2026-10-25 18:02:11", exists: true },
        { id: 3, name: "backups", path: "/volume1/backups", comment: "备份目标", smb: false, nfs: true, recycle: false, readonly: false, created_at: "2026-10-22 08:00:00", exists: true }
    ]});
    if (path.startsWith("/api/files")) {
        const target = new URLSearchParams(path.split("?")[1] || "").get("path") || "/volume1";
        if (m === "DELETE") return ok({ message: "已移入回收站" });
        const tree = {
            "/volume1": [
                { name: "public", type: "dir" }, { name: "photos", type: "dir" }, { name: "backups", type: "dir" },
                { name: "appdata", type: "dir" }, { name: "#recycle", type: "dir" }, { name: "readme.txt", type: "file", size: 2048 }
            ],
            "/volume1/photos": [
                { name: "2025", type: "dir" }, { name: "2026", type: "dir" },
                { name: "IMG_0001.jpg", type: "file", size: 4.2e6 }, { name: "IMG_0002.jpg", type: "file", size: 3.8e6 }
            ],
            "/volume1/public": [
                { name: "documents", type: "dir" }, { name: "DJOS-使用手册.pdf", type: "file", size: 1.2e6 }
            ]
        };
        const entries = (tree[target] || []).map((f, i) => ({
            name: f.name, path: target + "/" + f.name, type: f.type, size: f.size || 0,
            mtime: Math.floor(Date.now() / 1000) - (i + 2) * 86400, mode: f.type === "dir" ? "775" : "664",
            extension: f.type === "file" ? f.name.split(".").pop() : ""
        }));
        const parent = target.split("/").slice(0, -1).join("/") || "";
        return ok({ data: { path: target, parent: parent.startsWith("/volume") ? parent : "", entries } });
    }
    if (path === "/api/users") return ok({ data: DEMO.users });
    if (path === "/api/packages") return ok({ data: { categories: ["全部", "媒体", "下载", "同步", "开发", "家庭"], apps: DEMO.apps }, docker_available: true });
    if (path === "/api/docker/containers") return ok({ available: true, data: [
        { id: "a1b2c3d4e5f6", name: "djos-jellyfin", image: "jellyfin/jellyfin:latest", status: "Up 3 days", ports: "0.0.0.0:8096->8096/tcp", running: true, app: "jellyfin" },
        { id: "b2c3d4e5f6a1", name: "djos-qbittorrent", image: "linuxserver/qbittorrent:latest", status: "Exited (0) 2 hours ago", ports: "0.0.0.0:8081->8080/tcp", running: false, app: "qbittorrent" }
    ]});
    if (path.endsWith("/logs") && path.includes("/containers/")) return ok({ data: { logs: "[demo] container started\n[demo] listening on 0.0.0.0:8096\n[demo] 3 clients connected" } });
    if (path === "/api/backup/jobs") return ok({ data: [
        { id: 1, name: "每日快照", source: "/volume1/public", dest: "", mode: "snapshot", cron: "0 2 * * *", enabled: true, created_at: "2026-10-21 10:10:00",
          last_run: { id: 12, job_id: 1, started_at: "2026-10-26 02:00:01", finished_at: "2026-10-26 02:00:04", status: "success", message: "快照完成" } },
        { id: 2, name: "相册异地副本", source: "/volume1/photos", dest: "/volume2/photos", mode: "rsync", cron: "0 3 * * 0", enabled: true, created_at: "2026-10-22 09:00:00",
          last_run: { id: 9, job_id: 2, started_at: "2026-10-25 03:00:01", finished_at: "2026-10-25 03:42:10", status: "success", message: "同步 128 个文件" } }
    ]});
    if (path === "/api/backup/runs") return ok({ data: [
        { id: 12, job_id: 1, job_name: "每日快照", started_at: "2026-10-26 02:00:01", finished_at: "2026-10-26 02:00:04", status: "success", message: "快照完成" },
        { id: 9, job_id: 2, job_name: "相册异地副本", started_at: "2026-10-25 03:00:01", finished_at: "2026-10-25 03:42:10", status: "success", message: "同步 128 个文件" },
        { id: 8, job_id: 1, job_name: "每日快照", started_at: "2026-10-25 02:00:01", finished_at: "2026-10-25 02:00:03", status: "success", message: "快照完成" }
    ]});
    if (path === "/api/settings") return ok({ data: { hostname: "DJOS", timezone: "Asia/Shanghai", ssh_enabled: "0", auto_update: "1", model: "DJOS NAS" } });
    if (m !== "GET") return ok({ message: "演示模式：操作已模拟成功" });
    return ok({ data: [] });
}

/* ================================================================ 启动 */
function bindShell() {
    $("#loginForm").addEventListener("submit", async e => {
        e.preventDefault();
        const btn = $("#loginBtn"), err = $("#loginError");
        err.classList.add("hidden");
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
            const r = await api("/api/auth/login", { method: "POST", body: {
                username: $("#username").value.trim(), password: $("#password").value
            }});
            if (r.csrf) state.csrf = r.csrf;
            await enterApp(r.user, r.csrf);
        } catch (ex) {
            err.textContent = ex.message;
            err.classList.remove("hidden");
        } finally {
            btn.disabled = false;
            btn.textContent = "登 录";
        }
    });

    $("#demoBtn").addEventListener("click", () => {
        state.demo = true;
        $("#demoBanner").classList.remove("hidden");
        enterApp({ username: "admin", role: "admin", email: "", must_change: false, disabled: false, demo: true }, "demo");
    });

    $("#exitDemo").addEventListener("click", e => {
        e.preventDefault();
        state.demo = false;
        $("#demoBanner").classList.add("hidden");
        showLogin();
    });

    $("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#globalSearch").addEventListener("click", openPalette);
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (state.user) openPalette(); }
    });

    $("#userBtn").addEventListener("click", () => openMenu($("#userBtn"), menu => {
        menu.innerHTML =
            '<div class="menu-head"><div class="n">' + esc(state.user ? state.user.username : "") + "</div>" +
            '<div class="e">' + (state.user && state.user.role === "admin" ? "系统管理员" : "普通用户") + "</div></div>" +
            '<button data-a="pwd">' + IC.key + "修改密码</button>" +
            '<button data-a="logout" class="danger">' + IC.out + "退出登录</button>";
        $('[data-a="pwd"]', menu).onclick = () => { closeMenu(); go("settings"); };
        $('[data-a="logout"]', menu).onclick = async () => {
            closeMenu();
            if (!state.demo) { try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {} }
            state.demo = false;
            $("#demoBanner").classList.add("hidden");
            showLogin();
        };
    }));

    $("#notifyBtn").addEventListener("click", async () => {
        let alerts = [];
        try { alerts = (await api("/api/system/status")).data.alerts || []; } catch (e) {}
        openMenu($("#notifyBtn"), menu => {
            menu.style.minWidth = "280px";
            menu.innerHTML = '<div class="menu-head"><div class="n">系统通知</div><div class="e">' +
                (alerts.length ? alerts.length + " 条待处理" : "一切正常") + "</div></div>" +
                (alerts.length ? alerts.map(a =>
                    '<button data-go="dashboard">' + (a.level === "critical" ? IC.warn : IC.info) + esc(a.text) + "</button>").join("")
                    : '<button data-go="dashboard">' + IC.check + "系统运行正常</button>");
            $$("[data-go]", menu).forEach(b => b.onclick = () => { closeMenu(); go("dashboard"); });
        });
        $("#notifyDot").classList.add("hidden");
    });
}

async function boot() {
    bindShell();
    try {
        const r = await api("/api/auth/me");
        if (r.csrf) state.csrf = r.csrf;
        await enterApp(r.user, r.csrf);
    } catch (e) {
        showLogin();
    }
    // 轮询告警红点
    setInterval(async () => {
        if (!state.user) return;
        try {
            const s = (await api("/api/system/status")).data;
            $("#notifyDot").classList.toggle("hidden", !(s.alerts || []).length);
        } catch (e) {}
    }, 15000);
}

document.addEventListener("DOMContentLoaded", boot);
})();

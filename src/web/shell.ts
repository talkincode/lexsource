import type { User } from "../domain/auth";

export const FONT_LINKS = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet" />
`;

export const SHELL_CSS = `
:root {
  --void: #0c0b09;
  --chrome: #14120e;
  --chrome-2: #1d1a14;
  --paper: #f2ead8;
  --panel: #fff8eb;
  --ink: #16130e;
  --ink-soft: #3c372d;
  --mute: #6f6759;
  --line: #d4c6a3;
  --line-dark: #2c281e;
  --brass: #c4a35a;
  --brass-deep: #8a6a2f;
  --ok: #2f6a45;
  --ok-lamp: #5dcc7a;
  --alert: #b42318;
  --warn: #c47b1a;
  --run: #e8b84a;
  --shadow: 0 18px 40px rgba(12, 11, 9, .18);
  --sans: "IBM Plex Sans", "Source Han Sans SC", "PingFang SC", "Noto Sans SC", sans-serif;
  --serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;
  --mono: "IBM Plex Mono", "SF Mono", "Source Han Mono SC", ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: var(--sans);
  background:
    radial-gradient(1200px 420px at 8% -10%, rgba(196,163,90,.14), transparent 55%),
    var(--paper);
  color: var(--ink);
}
button, input, select { font: inherit; }
a { color: var(--brass-deep); }
.top {
  background: var(--void);
  color: #f4ead6;
  padding: 18px 28px 16px;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: end;
  border-bottom: 1px solid var(--line-dark);
}
.brand small {
  display: block;
  letter-spacing: .34em;
  font-size: 10px;
  color: var(--brass);
  font-family: var(--mono);
}
.brand h1 {
  margin: 6px 0 0;
  font-family: var(--serif);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: .04em;
}
.meta { text-align: right; color: #c9b892; font-size: 13px; }
.meta #health { color: #8d8576; margin-top: 4px; font-family: var(--mono); font-size: 12px; }
.nav { margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px; }
.nav a, .nav button, button.ghost {
  width: auto; margin: 0; padding: 7px 12px;
  border: 1px solid #3a3428; background: transparent; color: #f4ead6;
  text-decoration: none; cursor: pointer; border-radius: 2px;
}
.nav a:hover, .nav button:hover, button.ghost:hover { border-color: var(--brass); color: #fff; }
h2 { font-family: var(--serif); font-size: 22px; margin: 0 0 12px; }
h3 {
  font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
  color: var(--brass-deep); font-weight: 600; margin: 0 0 10px;
}
label { display: block; font-size: 11px; letter-spacing: .14em; color: var(--brass-deep); margin: 14px 0 6px; }
input, select, button {
  width: 100%; color: var(--ink); background: var(--panel);
  border: 1px solid var(--line); border-radius: 2px; padding: 9px 11px;
}
button { margin-top: 12px; background: var(--ink); color: var(--paper); cursor: pointer; }
button:hover { background: #2a241b; }
button.danger { background: var(--alert); color: #fff; border-color: var(--alert); }
.tag {
  display: inline-block; border: 1px solid var(--line); padding: 1px 7px;
  margin-right: 6px; font-size: 11px; letter-spacing: .06em; font-family: var(--mono);
}
.tag.ok { color: var(--ok); border-color: #9bb89f; }
.tag.bad { color: var(--alert); border-color: #d4a39b; }
.empty { color: var(--mute); line-height: 1.55; }
.err { color: var(--alert); min-height: 1.2em; font-size: 14px; }
.okmsg { color: var(--ok); font-size: 14px; }
.lamp {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
  margin-right: 8px; background: #6b6458; box-shadow: 0 0 0 3px rgba(107,100,88,.15);
}
.lamp.ok { background: var(--ok-lamp); box-shadow: 0 0 0 3px rgba(93,204,122,.18); }
.lamp.run { background: var(--run); box-shadow: 0 0 10px rgba(232,184,74,.55); animation: pulse 1.2s ease-in-out infinite; }
.lamp.due { background: var(--warn); box-shadow: 0 0 0 3px rgba(196,123,26,.18); }
.lamp.bad { background: var(--alert); box-shadow: 0 0 0 3px rgba(180,35,24,.16); }
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.25); opacity: .7; }
}
`;

export function headerHtml(user: User, page: "desk" | "settings"): string {
  const role = user.role === "admin" ? "管理员" : "律师";
  const other =
    page === "desk"
      ? `<a href="/settings">设置</a>`
      : `<a href="/">情报台</a>`;
  return `<header class="top">
    <div class="brand">
      <small>LAW FIRM DUTY DESK</small>
      <h1>律源 LexSource</h1>
    </div>
    <div class="meta">
      <div id="who">${escapeHtml(user.username)} · ${role}</div>
      <div id="health">${page === "desk" ? "值班台加载中…" : "所内设置"}</div>
      <div class="nav">
        ${other}
        <button class="ghost" id="logout" type="button">退出</button>
      </div>
    </div>
  </header>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[ch] ?? ch;
  });
}

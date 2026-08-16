import type { User } from "../domain/auth";
import { FONT_LINKS, SHELL_CSS, headerHtml } from "./shell";

export function settingsHtml(user: User): string {
  const admin = user.role === "admin";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>设置 · 律源 LexSource</title>
  ${FONT_LINKS}
  <style>${SHELL_CSS}
    main { max-width: 920px; padding: 28px 32px 72px; }
    .lede { color: var(--mute); max-width: 62ch; line-height: 1.65; margin: 0 0 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
    section.card {
      background: var(--panel); border: 1px solid var(--line); padding: 22px 22px 26px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid var(--line); }
    .row { display: flex; gap: 8px; align-items: end; }
    .row > * { flex: 1; }
    .row button { width: auto; }
    section.card button.ghost {
      background: var(--panel); color: var(--ink); border-color: var(--line);
    }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  ${headerHtml(user, "settings")}
  <main>
    <p class="lede">采集由 ReAct Agent 按策略调用工具完成：发现页面、判定法律相关、再交给抽取与验证。这里只改日程和账号，不写死渠道解析。</p>
    <div class="grid">
      <section class="card">
        <h2>修改密码</h2>
        <label>当前密码</label>
        <input id="cur" type="password" autocomplete="current-password" />
        <label>新密码（至少 8 位）</label>
        <input id="next" type="password" autocomplete="new-password" />
        <div class="err" id="pw-err"></div>
        <button id="pw-save" type="button">保存密码</button>
      </section>
      ${admin ? `
      <section class="card">
        <h2>采集日程</h2>
        <label>Agent</label>
        <select id="sched-agent">
          <option value="tender">招标采集</option>
          <option value="case">案件采集</option>
        </select>
        <label>间隔（天）</label>
        <input id="sched-days" type="number" min="1" max="30" value="1" />
        <label>运行时刻（上海时间）</label>
        <input id="sched-time" type="time" value="08:00" />
        <label><input id="sched-enabled" type="checkbox" checked style="width:auto" /> 按日程运行</label>
        <button id="sched-save" type="button">保存日程</button>
        <div class="okmsg" id="sched-msg"></div>
      </section>` : ""}
    </div>
    ${admin ? `
    <section class="card" style="margin-top:22px">
      <h2>用户</h2>
      <table>
        <thead><tr><th>用户名</th><th>角色</th><th></th></tr></thead>
        <tbody id="users"></tbody>
      </table>
      <h3>新建用户</h3>
      <div class="row">
        <div><label>用户名</label><input id="new-name" /></div>
        <div><label>密码</label><input id="new-pass" type="password" /></div>
        <div><label>角色</label>
          <select id="new-role"><option value="lawyer">律师</option><option value="admin">管理员</option></select>
        </div>
      </div>
      <div class="err" id="user-err"></div>
      <button id="new-save" type="button">创建用户</button>
    </section>` : ""}
  </main>
  <script>
    const isAdmin = ${admin ? "true" : "false"};
    const $ = (id) => document.getElementById(id);
    async function api(path, options) {
      const res = await fetch(path, options);
      if (res.status === 401) { location.href = "/"; throw new Error("unauthorized"); }
      return res;
    }
    $("logout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }); location.href = "/"; };
    $("pw-save").onclick = async () => {
      $("pw-err").textContent = "";
      const res = await api("/api/auth/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: $("cur").value, newPassword: $("next").value })
      });
      $("pw-err").textContent = res.ok ? "已更新。" : "修改失败（需当前密码正确，新密码至少 8 位）。";
    };
    if (isAdmin) {
      async function load() {
        const agents = await (await api("/api/agents")).json();
        const current = agents.agents.find((a) => a.id === $("sched-agent").value) || agents.agents[0];
        const s = current.schedule || {};
        $("sched-days").value = s.intervalDays || 1;
        $("sched-time").value = s.runAt || "08:00";
        $("sched-enabled").checked = s.enabled !== false;
        const users = await (await api("/api/users")).json();
        $("users").innerHTML = users.users.map((u) =>
          "<tr><td>" + u.username + "</td><td>" + (u.role === "admin" ? "管理员" : "律师") +
          "</td><td><button class='ghost reset' data-id='" + u.id + "' type='button'>重置密码</button> " +
          "<button class='danger del' data-id='" + u.id + "' type='button'>删除</button></td></tr>"
        ).join("");
        for (const btn of document.querySelectorAll(".reset")) {
          btn.onclick = async () => {
            const password = prompt("新密码（至少 8 位）");
            if (!password) return;
            await api("/api/users/" + btn.dataset.id + "/password", {
              method: "PUT", headers: { "content-type": "application/json" },
              body: JSON.stringify({ password })
            });
            await load();
          };
        }
        for (const btn of document.querySelectorAll(".del")) {
          btn.onclick = async () => {
            const res = await api("/api/users/" + btn.dataset.id, { method: "DELETE" });
            $("user-err").textContent = res.ok ? "" : "不能删除自己或最后一名管理员。";
            await load();
          };
        }
      }
      $("sched-save").onclick = async () => {
        await api("/api/agents/" + $("sched-agent").value + "/schedule", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: $("sched-enabled").checked,
            intervalDays: Number($("sched-days").value),
            runAt: $("sched-time").value
          })
        });
        $("sched-msg").textContent = "已保存。";
        await load();
      };
      $("sched-agent").onchange = load;
      $("new-save").onclick = async () => {
        $("user-err").textContent = "";
        const res = await api("/api/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: $("new-name").value,
            password: $("new-pass").value,
            role: $("new-role").value
          })
        });
        if (!res.ok) $("user-err").textContent = "创建失败。";
        await load();
      };
      load();
    }
  </script>
</body>
</html>`;
}

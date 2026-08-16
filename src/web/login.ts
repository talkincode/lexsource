import { FONT_LINKS, SHELL_CSS } from "./shell";

export function loginHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录 · 律源 LexSource</title>
  ${FONT_LINKS}
  <style>${SHELL_CSS}
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        linear-gradient(180deg, #0c0b09 0 42%, transparent 42%),
        radial-gradient(900px 280px at 80% 0%, rgba(196,163,90,.16), transparent 50%),
        var(--paper);
    }
    form {
      width: min(440px, calc(100vw - 32px));
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      padding: 36px 32px 32px;
    }
    form small { color: var(--brass-deep); }
    form h1 { font-family: var(--serif); font-size: 36px; margin: 8px 0 10px; }
    form p { color: var(--mute); font-size: 14px; line-height: 1.65; margin: 0 0 8px; }
    form button { margin-top: 22px; }
  </style>
</head>
<body>
  <form id="login">
    <small>LAW FIRM DUTY DESK</small>
    <h1>律源</h1>
    <p>所内情报值班台。登录后查看采集 Agent 已经筛好的法律服务标讯和案件 brief。</p>
    <label>用户名</label>
    <input id="username" name="username" autocomplete="username" required />
    <label>密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <div class="err" id="err"></div>
    <button type="submit">进入情报台</button>
  </form>
  <script>
    document.getElementById("login").addEventListener("submit", async (event) => {
      event.preventDefault();
      const err = document.getElementById("err");
      err.textContent = "";
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: document.getElementById("username").value,
          password: document.getElementById("password").value
        })
      });
      if (!res.ok) {
        err.textContent = "用户名或密码不正确。";
        return;
      }
      location.href = "/";
    });
  </script>
</body>
</html>`;
}

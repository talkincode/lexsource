export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>律源 LexSource</title>
  <style>
    :root {
      --ink: #1b1712;
      --paper: #f3ead8;
      --panel: #fffaf0;
      --rule: #cbb892;
      --gold: #8a6a2f;
      --alert: #8b2e1f;
      --ok: #2d5a3d;
      --mute: #6d6456;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--paper); color: var(--ink); }
    body {
      font-family: "Iowan Old Style", "Palatino Linotype", "Songti SC", "Source Han Serif SC", serif;
      min-height: 100vh;
    }
    header {
      padding: 28px 36px 18px;
      border-bottom: 1px solid var(--rule);
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
    }
    .brand small { display: block; letter-spacing: .28em; color: var(--gold); font-size: 11px; }
    .brand h1 { margin: 4px 0 0; font-size: 34px; font-weight: 600; }
    .meta { color: var(--mute); font-size: 14px; text-align: right; }
    main { display: grid; grid-template-columns: 280px 1fr 360px; min-height: calc(100vh - 96px); }
    aside, section, article { padding: 22px 24px; }
    aside { border-right: 1px solid var(--rule); }
    article { border-left: 1px solid var(--rule); background: var(--panel); }
    label { display: block; font-size: 12px; letter-spacing: .12em; color: var(--gold); margin: 14px 0 6px; }
    input, select, textarea, button {
      width: 100%;
      font: inherit;
      color: var(--ink);
      background: var(--panel);
      border: 1px solid var(--rule);
      border-radius: 2px;
      padding: 8px 10px;
    }
    button {
      margin-top: 16px;
      background: var(--ink);
      color: var(--paper);
      cursor: pointer;
    }
    .item {
      padding: 14px 0;
      border-bottom: 1px solid #e6dcc4;
      cursor: pointer;
    }
    .item b { display: block; font-size: 17px; }
    .item span { color: var(--mute); font-size: 13px; }
    .tag {
      display: inline-block;
      border: 1px solid var(--rule);
      padding: 1px 7px;
      margin-right: 6px;
      font-size: 12px;
    }
    .tag.ok { color: var(--ok); border-color: #9bb89f; }
    .tag.bad { color: var(--alert); border-color: #d4a39b; }
    pre { white-space: pre-wrap; font-family: "Sarasa Mono SC", ui-monospace, monospace; font-size: 13px; }
    a { color: var(--gold); }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <small>LAW FIRM INTELLIGENCE</small>
      <h1>律源 LexSource</h1>
    </div>
    <div class="meta" id="health">情报台启动中…</div>
  </header>
  <main>
    <aside>
      <label>类型</label>
      <select id="type">
        <option value="">全部</option>
        <option value="tender">招标情报</option>
        <option value="major_case">重大案件</option>
      </select>
      <label>关键词</label>
      <input id="q" placeholder="法律顾问 / 指导性案例" />
      <label><input id="biddable" type="checkbox" style="width:auto" /> 仅可投标</label>
      <button id="reload">刷新情报</button>
      <p style="color:var(--mute);font-size:13px;line-height:1.55">
        公开招标走政采网与公共资源交易平台；重大案件只收最高法公开案例与交叉确认材料，不爬裁判文书网。
      </p>
    </aside>
    <section id="list"></section>
    <article id="detail">选择一条情报查看原文、验证结果和导出。</article>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    async function loadHealth() {
      const data = await fetch("/api/health").then((r) => r.json());
      $("health").textContent = data.ok ? "在库 " + data.items + " 条 · 系统就绪" : "系统异常";
    }
    async function loadList() {
      const params = new URLSearchParams();
      if ($("type").value) params.set("type", $("type").value);
      if ($("q").value) params.set("q", $("q").value);
      if ($("biddable").checked) params.set("biddable", "1");
      const data = await fetch("/api/intel?" + params).then((r) => r.json());
      $("list").innerHTML = data.items.map((item) => {
        const badge = item.type === "tender"
          ? (item.biddable ? '<span class="tag ok">可投标</span>' : '<span class="tag bad">不可投</span>')
          : '<span class="tag">案件</span>';
        return '<div class="item" data-id="' + item.id + '">' + badge +
          '<b>' + escapeHtml(item.title) + '</b><span>' + escapeHtml(item.region) + " · " +
          escapeHtml(item.verification.status) + '</span></div>';
      }).join("") || "<p>暂无情报。用 fixtures 入库后刷新。</p>";
      for (const node of document.querySelectorAll(".item")) {
        node.addEventListener("click", () => show(node.dataset.id));
      }
    }
    async function show(id) {
      const data = await fetch("/api/intel/" + id).then((r) => r.json());
      const item = data.item;
      const extra = item.type === "tender"
        ? "采购人：" + item.purchaser + "\\n预算：" + (item.budgetText || "未披露") + "\\n截止：" + (item.deadlineAt || "无")
        : item.briefMarkdown;
      $("detail").innerHTML =
        "<h2>" + escapeHtml(item.title) + "</h2>" +
        "<p><a href='/api/intel/" + item.id + "/export.md'>Markdown</a> · " +
        "<a href='/api/intel/" + item.id + "/export.docx'>Word</a> · " +
        "<a href='/api/intel/" + item.id + "/export.pdf'>PDF</a></p>" +
        "<pre>" + escapeHtml(extra) + "</pre>";
    }
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>\"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
    }
    $("reload").onclick = () => { loadHealth(); loadList(); };
    $("type").onchange = loadList;
    $("biddable").onchange = loadList;
    $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") loadList(); });
    loadHealth();
    loadList();
  </script>
</body>
</html>`;
}

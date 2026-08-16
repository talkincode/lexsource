import type { User } from "../domain/auth";
import { FONT_LINKS, SHELL_CSS, headerHtml } from "./shell";

export function dashboardHtml(user: User): string {
  const admin = user.role === "admin";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>律源 LexSource</title>
  ${FONT_LINKS}
  <style>${SHELL_CSS}
    .ops {
      display: grid;
      grid-template-columns: 1fr 1fr 1.1fr;
      gap: 1px;
      background: var(--line-dark);
      border-bottom: 1px solid var(--line-dark);
    }
    .card {
      background: var(--chrome);
      color: #efe6d2;
      padding: 16px 20px 18px;
      min-width: 0;
    }
    .card .k { font-family: var(--mono); font-size: 10px; letter-spacing: .18em; color: var(--brass); margin: 0 0 8px; }
    .card h2 { font-size: 20px; color: #fff8eb; margin: 0 0 6px; display: flex; align-items: center; }
    .card .state { font-family: var(--mono); font-size: 12px; color: #c9b892; line-height: 1.55; }
    .card .hint { color: #8d8576; font-size: 12px; line-height: 1.5; margin-top: 8px; }
    .card button { width: auto; margin: 12px 8px 0 0; padding: 7px 12px; background: var(--brass); color: var(--void); border-color: var(--brass); }
    .card button.ghost { background: transparent; color: #efe6d2; border-color: #3a3428; }
    .stages { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .stages span {
      font-family: var(--mono); font-size: 10px; letter-spacing: .08em;
      border: 1px solid #3a3428; color: #c9b892; padding: 3px 7px;
    }
    .workspace {
      display: grid;
      grid-template-columns: 300px 1fr 1.15fr;
      min-height: calc(100vh - 210px);
    }
    .trace, .list, .preview { padding: 20px 22px 36px; overflow-y: auto; min-width: 0; }
    .trace { background: #efe6cf; border-right: 1px solid var(--line); }
    .preview { border-left: 1px solid var(--line); background: var(--panel); }
    .tabs { display: flex; gap: 0; margin: 0 0 12px; border-bottom: 1px solid var(--line); }
    .tabs button {
      width: auto; margin: 0; border: 0; border-bottom: 2px solid transparent;
      background: transparent; color: var(--mute); padding: 8px 14px;
    }
    .tabs button.on { color: var(--ink); border-bottom-color: var(--ink); }
    .item { padding: 14px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
    .item.on { background: #f7f0de; margin: 0 -12px; padding-left: 12px; padding-right: 12px; }
    .item b { display: block; font-size: 16px; line-height: 1.35; font-family: var(--serif); }
    .item span { color: var(--mute); font-size: 13px; }
    .run {
      padding: 10px 0; border-bottom: 1px solid #e3d6b6; cursor: pointer;
      font-size: 12px; color: var(--mute); font-family: var(--mono);
    }
    .run.on, .run:hover { color: var(--ink); }
    .run b { display: block; color: var(--ink); font-size: 13px; font-family: var(--sans); margin-bottom: 2px; }
    .step { padding: 8px 0 8px 12px; border-left: 2px solid var(--line); margin: 0 0 8px; font-size: 12px; }
    .step.thought { border-color: var(--brass); }
    .step.action { border-color: var(--ink); }
    .step.observation { border-color: var(--ok); }
    .step.error { border-color: var(--alert); }
    .step .kind { font-family: var(--mono); font-size: 10px; letter-spacing: .14em; color: var(--brass-deep); }
    .step p { margin: 4px 0 0; line-height: 1.5; color: var(--ink-soft); word-break: break-word; }
    .kicker { color: var(--brass-deep); font-size: 12px; letter-spacing: .12em; margin: 0 0 8px; font-family: var(--mono); }
    .preview h2 { font-size: 26px; line-height: 1.3; margin: 0 0 12px; }
    .exports { margin: 0 0 18px; font-size: 14px; }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; margin: 0 0 22px; }
    .facts div { border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    .facts dt { font-size: 11px; letter-spacing: .12em; color: var(--brass-deep); margin: 0 0 4px; }
    .facts dd { margin: 0; font-size: 15px; line-height: 1.45; }
    .block { margin: 0 0 20px; }
    .block h3 { margin-top: 0; }
    .block p, .block li { line-height: 1.65; font-size: 15px; }
    .block ul { margin: 0; padding-left: 1.2em; }
    .checks { list-style: none; padding: 0; margin: 0; }
    .checks li { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
    .checks .ok { color: var(--ok); }
    .checks .bad { color: var(--alert); }
    details.raw { margin-top: 18px; color: var(--mute); font-size: 13px; }
    details.raw pre { white-space: pre-wrap; font-family: inherit; font-size: 13px; line-height: 1.5; }
    @media (max-width: 1100px) {
      .ops, .workspace { grid-template-columns: 1fr; }
      .trace, .preview { border: 0; }
    }
  </style>
</head>
<body>
  ${headerHtml(user, "desk")}
  <section class="ops" id="ops" aria-label="采集值班台">
    <article class="card" id="card-tender"></article>
    <article class="card" id="card-case"></article>
    <article class="card" id="card-pipeline"></article>
  </section>
  <main class="workspace">
    <aside class="trace">
      <h3>ReAct 运行轨迹</h3>
      <div id="runs"></div>
      <h3>本轮步骤</h3>
      <div id="steps"><p class="empty">选一次运行，查看思考、工具调用和观察结果。</p></div>
    </aside>
    <section class="list">
      <div class="tabs">
        <button class="on" id="tab-tender" type="button">现在还能投</button>
        <button id="tab-case" type="button">所里能用的案件</button>
      </div>
      <div id="items"></div>
    </section>
    <article class="preview" id="detail">选择一条情报，阅读成品摘要、关键字段和导出。采集评审写在每条记录里。</article>
  </main>
  <script>
    const isAdmin = ${admin ? "true" : "false"};
    const SERVICE = { general_counsel: "常年法律顾问", special_project: "专项法律服务", litigation: "诉讼仲裁", other: "其他法律服务" };
    const CASE_CLASS = { guiding: "指导性案例", gazette: "公报案例", reference: "参考性案例", public_impact: "社会重大影响案件" };
    const ANGLES = { marketing: "市场拓展", precedent: "办案参考", risk: "风险合规" };
    const $ = (id) => document.getElementById(id);
    let desk = { tenders: [], cases: [], agents: [], runs: [], ops: null };
    let tab = "tender";
    let selectedRunId = null;
    let pollTimer = null;
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>\"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
    }
    function fmtTime(iso) {
      if (!iso) return "未披露";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return String(iso);
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short"
      }).format(date);
    }
    function schedText(sched) {
      if (!sched || sched.enabled === false) return "已暂停";
      const days = Number(sched.intervalDays || 1);
      const at = sched.runAt || "08:00";
      return (days === 1 ? "每天 " : ("每 " + days + " 天 · ")) + at + "（上海）";
    }
    function lampClass(agent) {
      if (agent.blocked) return "bad";
      if (agent.running) return "run";
      if (agent.lastRun && agent.lastRun.status === "error") return "bad";
      if (agent.due) return "due";
      if (agent.schedule && agent.schedule.enabled !== false) return "ok";
      return "";
    }
    function agentState(agent) {
      if (agent.blocked) return "模型未接，采集不会入库";
      if (agent.running) return "运行中";
      if (agent.schedule && agent.schedule.enabled === false) return "已暂停";
      if (agent.due) return "已到点，等待调度";
      return "待命 · " + schedText(agent.schedule);
    }
    function summarize(value) {
      if (value == null) return "";
      if (typeof value === "string") return value;
      if (value.text) return value.text;
      if (value.error) return String(value.error);
      if (value.url) return value.url;
      if (value.summary) return value.summary;
      if (value.title) return value.title;
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    async function api(path, options) {
      const res = await fetch(path, options);
      if (res.status === 401) { location.href = "/"; throw new Error("unauthorized"); }
      return res;
    }
    function itemCard(item) {
      const badge = item.type === "tender"
        ? (item.biddable ? '<span class="tag ok">可投标</span>' : '<span class="tag bad">不可投</span>')
        : '<span class="tag">案件</span>';
      return '<div class="item" data-id="' + item.id + '">' + badge +
        '<b>' + escapeHtml(item.title) + '</b><span>' + escapeHtml(item.region) + " · " +
        escapeHtml(item.verification && item.verification.status) + '</span></div>';
    }
    function fact(label, value) {
      return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + value + '</dd></div>';
    }
    function listBlock(title, items) {
      if (!items || !items.length) return "";
      return '<div class="block"><h3>' + escapeHtml(title) + '</h3><ul>' +
        items.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul></div>';
    }
    function reviewOf(item) {
      const check = (item.verification && item.verification.checks || []).find((c) => c.name === "agent_review");
      return check ? check.detail : "";
    }
    function renderTender(item) {
      const review = reviewOf(item);
      return '<p class="kicker">' + (item.biddable ? "可投标" : "不可投") + " · " +
        escapeHtml(item.region) + " · " + escapeHtml(SERVICE[item.serviceType] || item.serviceType) + "</p>" +
        "<h2>" + escapeHtml(item.title) + "</h2>" +
        "<p class='exports'><a href='/api/intel/" + item.id + "/export.md'>Markdown</a> · " +
        "<a href='/api/intel/" + item.id + "/export.docx'>Word</a> · " +
        "<a href='/api/intel/" + item.id + "/export.pdf'>PDF</a></p>" +
        '<dl class="facts">' +
          fact("采购人", escapeHtml(item.purchaser)) +
          fact("项目", escapeHtml(item.projectName)) +
          fact("预算", escapeHtml(item.budgetText || (item.budget != null ? item.budget + " 元" : "未披露"))) +
          fact("投标截止", escapeHtml(fmtTime(item.deadlineAt))) +
          fact("开标时间", escapeHtml(fmtTime(item.bidOpenAt))) +
          fact("联系人", escapeHtml(item.contact || "未披露")) +
        "</dl>" +
        (item.qualification ? '<div class="block"><h3>资格要求</h3><p>' + escapeHtml(item.qualification) + "</p></div>" : "") +
        (review ? '<div class="block"><h3>采集评审</h3><p>' + escapeHtml(review) + "</p></div>" : "") +
        '<div class="block"><h3>来源</h3><p><a href="' + escapeHtml(item.sourceUrl) + '" target="_blank" rel="noreferrer">' +
          escapeHtml(item.sourceUrl) + "</a></p></div>" +
        renderChecks(item) +
        '<details class="raw"><summary>原文摘录</summary><pre>' + escapeHtml((item.rawText || "").slice(0, 2000)) + "</pre></details>";
    }
    function renderCase(item) {
      const review = reviewOf(item);
      return '<p class="kicker">' + escapeHtml(CASE_CLASS[item.caseClass] || item.caseClass) + " · " +
        escapeHtml(item.region) + "</p>" +
        "<h2>" + escapeHtml(item.title) + "</h2>" +
        "<p class='exports'><a href='/api/intel/" + item.id + "/export.md'>Markdown</a> · " +
        "<a href='/api/intel/" + item.id + "/export.docx'>Word</a> · " +
        "<a href='/api/intel/" + item.id + "/export.pdf'>PDF</a></p>" +
        '<dl class="facts">' +
          fact("审理法院", escapeHtml(item.court || "未披露")) +
          fact("程序阶段", escapeHtml(item.stage || "未披露")) +
        "</dl>" +
        '<div class="block"><h3>摘要</h3><p>' + escapeHtml(item.summary) + "</p></div>" +
        (item.holding ? '<div class="block"><h3>裁判要旨</h3><p>' + escapeHtml(item.holding) + "</p></div>" : "") +
        listBlock("争议焦点", item.issues) +
        listBlock("涉及法条", item.statutes) +
        listBlock("律所可用角度", (item.lawFirmAngles || []).map((a) => ANGLES[a] || a)) +
        (review ? '<div class="block"><h3>采集评审</h3><p>' + escapeHtml(review) + "</p></div>" : "") +
        '<div class="block"><h3>来源</h3><p><a href="' + escapeHtml(item.sourceUrl) + '" target="_blank" rel="noreferrer">' +
          escapeHtml(item.sourceUrl) + "</a></p></div>";
    }
    function renderChecks(item) {
      const checks = (item.verification && item.verification.checks) || [];
      if (!checks.length) return "";
      return '<div class="block"><h3>验证</h3><ul class="checks">' +
        checks.map((check) => '<li class="' + (check.ok ? "ok" : "bad") + '">' +
          (check.ok ? "通过" : "待核") + " · " + escapeHtml(check.name) + " — " +
          escapeHtml(check.detail) + "</li>").join("") + "</ul></div>";
    }
    function renderAgentCard(agent) {
      const last = agent.lastRun;
      const step = agent.latestStep;
      const stepLine = step
        ? ((step.kind === "action" ? "行动 " : step.kind === "observation" ? "观察 " : step.kind === "thought" ? "思考 " : "错误 ") +
          (step.tool || summarize(step.output) || ""))
        : "尚无步骤";
      const lastLine = last
        ? ("上次 " + last.status + " · 成功" + last.succeeded + " 跳过" + (last.skipped || 0) + " 失败" + last.failed)
        : "尚未运行";
      const nextLine = agent.blocked
        ? "先配置 Azure OpenAI"
        : (agent.nextDueAt && !agent.running ? ("下次 " + fmtTime(agent.nextDueAt)) : "");
      const runBtn = isAdmin
        ? '<button type="button" data-run="' + agent.id + '">立即采集</button>'
        : "";
      return '<p class="k">AGENT / ' + escapeHtml(agent.id) + '</p>' +
        '<h2><span class="lamp ' + lampClass(agent) + '"></span>' + escapeHtml(agent.name) + "</h2>" +
        '<div class="state">' + escapeHtml(agentState(agent)) + "<br/>" +
        escapeHtml(lastLine) + (nextLine ? "<br/>" + escapeHtml(nextLine) : "") + "</div>" +
        '<div class="hint">' + escapeHtml(stepLine) + " · 渠道 " + escapeHtml((agent.channelIds || []).join(" / ")) + "</div>" +
        runBtn;
    }
    function renderPipeline(ops) {
      const llm = ops && ops.llm ? ops.llm : {};
      const pipeline = ops && ops.pipeline ? ops.pipeline : { stages: [], channels: [], tools: [] };
      const model = llm.configured ? ("模型 " + (llm.model || "已接")) : "模型未接";
      const stages = (pipeline.stages || []).map((s) => "<span>" + escapeHtml(s.name) + "</span>").join("");
      const channels = (pipeline.channels || []).map((c) => c.name).join("、");
      return '<p class="k">REACT 工具循环</p>' +
        "<h2>采集链路</h2>" +
        '<div class="state">' + escapeHtml(model) + " · 协议 ReAct，不是聊天机器人</div>" +
        '<div class="hint">发现 → 判定法律相关 → 抽取 → 验证 → 入库。渠道：' +
        escapeHtml(channels || "未登记") + "。</div>" +
        '<div class="stages">' + stages + "</div>";
    }
    function paintList() {
      const rows = tab === "tender" ? desk.tenders : desk.cases;
      $("items").innerHTML = rows.map(itemCard).join("") ||
        (tab === "tender"
          ? '<p class="empty">暂无仍可投的法律服务标。Agent 会按日程继续采集并评审。</p>'
          : '<p class="empty">暂无已整编案件 brief。</p>');
      for (const node of document.querySelectorAll(".item")) {
        node.addEventListener("click", () => show(node.dataset.id, node));
      }
    }
    function paintOps() {
      const agents = desk.agents || [];
      const tender = agents.find((a) => a.id === "tender") || agents[0];
      const cases = agents.find((a) => a.id === "case") || agents[1];
      if (tender) $("card-tender").innerHTML = renderAgentCard(tender);
      if (cases) $("card-case").innerHTML = renderAgentCard(cases);
      $("card-pipeline").innerHTML = renderPipeline(desk.ops);
      for (const btn of document.querySelectorAll("[data-run]")) {
        btn.onclick = async () => {
          btn.disabled = true;
          const res = await api("/api/agents/" + btn.dataset.run + "/run", { method: "POST" });
          if (res.status === 409) {
            $("health").textContent = "上一轮还在跑";
          }
          await loadDesk();
        };
      }
    }
    function paintRuns() {
      $("runs").innerHTML = (desk.runs || []).slice(0, 10).map((run) => {
        const on = run.id === selectedRunId ? " on" : "";
        return '<div class="run' + on + '" data-run-id="' + run.id + '"><b>' +
          escapeHtml(run.sourceId) + " · " + escapeHtml(run.status) + "</b>" +
          escapeHtml(run.trigger) + " · 成功" + run.succeeded +
          " 跳过" + (run.skipped || 0) + " 失败" + run.failed +
          (run.error ? " · " + escapeHtml(run.error) : "") + "</div>";
      }).join("") || "<p class='empty'>暂无采集记录。</p>";
      for (const node of document.querySelectorAll("[data-run-id]")) {
        node.addEventListener("click", () => showRun(node.dataset.runId));
      }
    }
    function paintSteps(steps) {
      if (!steps || !steps.length) {
        $("steps").innerHTML = '<p class="empty">这一轮还没有步骤。未接模型时只会留下错误。</p>';
        return;
      }
      $("steps").innerHTML = steps.map((step) => {
        const title = step.kind === "thought" ? "思考"
          : step.kind === "action" ? ("行动 · " + (step.tool || ""))
          : step.kind === "observation" ? ("观察 · " + (step.tool || ""))
          : "错误";
        const body = step.kind === "action" ? summarize(step.input) : summarize(step.output);
        return '<div class="step ' + step.kind + '"><div class="kind">' + escapeHtml(title) +
          "</div><p>" + escapeHtml(String(body || "").slice(0, 280)) + "</p></div>";
      }).join("");
    }
    async function showRun(id) {
      selectedRunId = id;
      paintRuns();
      const data = await (await api("/api/ingest-runs/" + id)).json();
      paintSteps(data.steps || []);
    }
    async function loadDesk() {
      const res = await api("/api/desk");
      desk = await res.json();
      $("health").textContent = "可投标 " + desk.tenders.length + " · 案件 " + desk.cases.length;
      paintOps();
      paintRuns();
      paintList();
      const live = (desk.agents || []).find((a) => a.running && a.lastRun);
      if (!selectedRunId && desk.runs && desk.runs[0]) selectedRunId = desk.runs[0].id;
      if (live && live.lastRun) selectedRunId = live.lastRun.id;
      if (selectedRunId) await showRun(selectedRunId);
      const running = (desk.agents || []).some((a) => a.running);
      clearTimeout(pollTimer);
      pollTimer = setTimeout(loadDesk, running ? 2500 : 20000);
    }
    async function show(id, node) {
      for (const item of document.querySelectorAll(".item")) item.classList.remove("on");
      if (node) node.classList.add("on");
      const data = await (await api("/api/intel/" + id)).json();
      const item = data.item;
      $("detail").innerHTML = item.type === "tender" ? renderTender(item) : renderCase(item);
    }
    $("tab-tender").onclick = () => {
      tab = "tender";
      $("tab-tender").classList.add("on");
      $("tab-case").classList.remove("on");
      paintList();
    };
    $("tab-case").onclick = () => {
      tab = "case";
      $("tab-case").classList.add("on");
      $("tab-tender").classList.remove("on");
      paintList();
    };
    $("logout").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      location.href = "/";
    };
    loadDesk();
  </script>
</body>
</html>`;
}

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
    .card .state { font-size: 13px; color: #c9b892; line-height: 1.55; }
    .card .hint { color: #8d8576; font-size: 12px; line-height: 1.5; margin-top: 8px; }
    .card button { width: auto; margin: 12px 8px 0 0; padding: 7px 12px; background: var(--brass); color: var(--void); border-color: var(--brass); }
    .card button:disabled, .card button:disabled:hover {
      background: #3a3428; color: #8d8576; border-color: #3a3428; opacity: 1;
    }
    .card a.live { color: var(--brass); }
    .stages { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .stages span {
      font-size: 11px; letter-spacing: .06em;
      border: 1px solid #3a3428; color: #c9b892; padding: 3px 7px;
    }
    .workspace {
      display: grid;
      grid-template-columns: 300px 1fr 1.15fr;
      min-height: calc(100vh - 210px);
    }
    .channels, .list, .preview { padding: 20px 22px 36px; overflow-y: auto; min-width: 0; }
    .channels { background: #efe6cf; border-right: 1px solid var(--line); }
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
    .channel {
      padding: 12px 0; border-bottom: 1px solid #e3d6b6;
    }
    .channel b { display: block; font-size: 15px; margin: 0 0 4px; }
    .channel .meta { color: var(--mute); font-size: 13px; line-height: 1.5; text-align: left; }
    .channel a { font-size: 13px; }
    .kicker { color: var(--brass-deep); font-size: 12px; letter-spacing: .08em; margin: 0 0 8px; }
    .preview h2 { font-size: 26px; line-height: 1.35; margin: 0 0 12px; }
    .exports { margin: 0 0 18px; font-size: 14px; }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; margin: 0 0 22px; }
    .facts div { border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    .facts dt { font-size: 11px; letter-spacing: .12em; color: var(--brass-deep); margin: 0 0 4px; }
    .facts dd { margin: 0; font-size: 15px; line-height: 1.45; }
    .block { margin: 0 0 16px; }
    .block h3 { margin-top: 0; }
    .block p, .block li { line-height: 1.7; font-size: 15px; }
    .block ul { margin: 0; padding-left: 1.2em; }
    details.fold {
      border: 1px solid var(--line); background: #fffaf0; margin: 0 0 12px; padding: 0 14px;
    }
    details.fold summary {
      cursor: pointer; list-style: none; padding: 12px 0; font-size: 14px; color: var(--ink);
    }
    details.fold summary::-webkit-details-marker { display: none; }
    details.fold summary::after { content: "展开"; float: right; color: var(--brass-deep); font-size: 12px; }
    details.fold[open] summary::after { content: "收起"; }
    details.fold .fold-body { padding: 0 0 14px; color: var(--ink-soft); line-height: 1.7; font-size: 15px; }
    .checks { list-style: none; padding: 0; margin: 0; }
    .checks li { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
    .checks .ok { color: var(--ok); }
    .checks .bad { color: var(--alert); }
    @media (max-width: 1100px) {
      .ops, .workspace { grid-template-columns: 1fr; }
      .channels, .preview { border: 0; }
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
    <aside class="channels">
      <h3>采集渠道</h3>
      <div id="channel-list"></div>
    </aside>
    <section class="list">
      <div class="tabs">
        <button class="on" id="tab-tender" type="button">招投标</button>
        <button id="tab-case" type="button">案件情报</button>
      </div>
      <div id="items"></div>
    </section>
    <article class="preview" id="detail">选择一条情报，查看要点和导出。</article>
  </main>
  <script>
    const isAdmin = ${admin ? "true" : "false"};
    const SERVICE = { general_counsel: "常年法律顾问", special_project: "专项法律服务", litigation: "诉讼仲裁", other: "其他法律服务" };
    const CASE_CLASS = { guiding: "指导性案例", gazette: "公报案例", reference: "参考性案例", public_impact: "社会重大影响案件" };
    const ANGLES = { marketing: "市场拓展", precedent: "办案参考", risk: "风险合规" };
    const CHANNEL_NAME = {
      ccgp: "中国政府采购网",
      ggzy: "全国公共资源交易平台",
      "spc-guiding": "最高人民法院指导性案例"
    };
    const ERR = {
      http_error: "来源网站暂时打不开",
      blocked_host: "该来源不允许自动采集",
      azure_openai_unconfigured: "采集服务未接通",
      parse: "页面读不出来",
      agent_no_result: "没有采到可用情报"
    };
    const $ = (id) => document.getElementById(id);
    let desk = { tenders: [], cases: [], agents: [], runs: [], ops: null };
    let tab = "tender";
    let pollTimer = null;
    const pendingRuns = new Set();
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
      if (!sched || sched.enabled === false) return "已暂停自动采集";
      const days = Number(sched.intervalDays || 1);
      const at = sched.runAt || "08:00";
      return (days === 1 ? "每天 " : ("每 " + days + " 天 · ")) + at + "（上海）";
    }
    function lampClass(agent) {
      if (agent.blocked) return "bad";
      if (agent.running || pendingRuns.has(agent.id)) return "run";
      if (agent.lastRun && agent.lastRun.status === "error") return "bad";
      if (agent.due) return "due";
      if (agent.schedule && agent.schedule.enabled !== false) return "ok";
      return "";
    }
    function agentState(agent) {
      if (agent.blocked) return "采集服务未接通，现在无法采集";
      if (agent.running || pendingRuns.has(agent.id)) return "正在采集";
      if (agent.schedule && agent.schedule.enabled === false) return "已暂停自动采集";
      if (agent.due) return "已到点，等待开始";
      return "待命 · " + schedText(agent.schedule);
    }
    function lastLine(agent) {
      const last = agent.lastRun;
      if (!last) return "还没有采集过";
      if (last.status === "ok") return "上次入库 " + last.succeeded + " 条";
      if (last.status === "partial") return "上次入库 " + last.succeeded + " 条，有部分没采到";
      return "上次没有采完" + (last.error && ERR[last.error] ? " · " + ERR[last.error] : "");
    }
    function canRun(agent) {
      return isAdmin && !agent.blocked && !agent.running && !pendingRuns.has(agent.id);
    }
    function friendlyError(code) {
      if (!code) return "";
      return ERR[code] || "采集没有完成";
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
        '<b>' + escapeHtml(item.title) + '</b><span>' + escapeHtml(item.region) +
        (item.type === "tender" && item.deadlineAt ? " · 截止 " + escapeHtml(fmtTime(item.deadlineAt)) : "") +
        '</span></div>';
    }
    function fact(label, value) {
      return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + value + '</dd></div>';
    }
    function paragraphs(text) {
      return String(text || "")
        .split(/\\n{2,}|。/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => "<p>" + escapeHtml(/[。！？]$/.test(part) ? part : part + "。").replace(/。$/,"。") + "</p>")
        .join("");
    }
    function fold(title, html, open) {
      if (!html) return "";
      return '<details class="fold"' + (open ? " open" : "") + "><summary>" +
        escapeHtml(title) + '</summary><div class="fold-body">' + html + "</div></details>";
    }
    function foldText(title, text, open) {
      if (!text) return "";
      return fold(title, paragraphs(text), open);
    }
    function shortEnough(text) {
      return String(text || "").trim().length > 0 && String(text).trim().length <= 48;
    }
    function reviewOf(item) {
      const check = (item.verification && item.verification.checks || []).find((c) => c.name === "agent_review");
      return check ? check.detail : "";
    }
    function renderTender(item) {
      const review = reviewOf(item);
      const shortFacts = [];
      if (shortEnough(item.purchaser)) shortFacts.push(fact("采购人", escapeHtml(item.purchaser)));
      if (shortEnough(item.projectName) && item.projectName !== item.title) {
        shortFacts.push(fact("项目", escapeHtml(item.projectName)));
      }
      shortFacts.push(fact("预算", escapeHtml(item.budgetText || (item.budget != null ? item.budget + " 元" : "未披露"))));
      shortFacts.push(fact("投标截止", escapeHtml(fmtTime(item.deadlineAt))));
      shortFacts.push(fact("开标时间", escapeHtml(fmtTime(item.bidOpenAt))));
      shortFacts.push(fact("联系人", escapeHtml(item.contact || "未披露")));
      const longBits = [];
      if (!shortEnough(item.purchaser) && item.purchaser) longBits.push(foldText("采购人", item.purchaser, false));
      if (!shortEnough(item.projectName) && item.projectName && item.projectName !== item.title) {
        longBits.push(foldText("项目说明", item.projectName, false));
      }
      if (item.qualification) longBits.push(foldText("资格要求", item.qualification, false));
      if (review) longBits.push(foldText("采集说明", review, false));
      longBits.push(renderChecks(item));
      if (item.rawText) longBits.push(foldText("原文摘录", item.rawText.slice(0, 2500), false));
      return '<p class="kicker">' + (item.biddable ? "可投标" : "不可投") + " · " +
        escapeHtml(item.region) + " · " + escapeHtml(SERVICE[item.serviceType] || item.serviceType) + "</p>" +
        "<h2>" + escapeHtml(item.title) + "</h2>" +
        "<p class='exports'><a href='/api/intel/" + item.id + "/export.md'>Markdown</a> · " +
        "<a href='/api/intel/" + item.id + "/export.docx'>Word</a> · " +
        "<a href='/api/intel/" + item.id + "/export.pdf'>PDF</a></p>" +
        '<dl class="facts">' + shortFacts.join("") + "</dl>" +
        longBits.join("") +
        '<div class="block"><h3>来源</h3><p><a href="' + escapeHtml(item.sourceUrl) + '" target="_blank" rel="noreferrer">打开原文网站</a></p></div>';
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
        (item.summary ? foldText("摘要", item.summary, true) : "") +
        (item.holding ? foldText("裁判要旨", item.holding, false) : "") +
        (item.issues && item.issues.length ? fold("争议焦点", "<ul>" + item.issues.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") + "</ul>", false) : "") +
        (item.statutes && item.statutes.length ? fold("涉及法条", "<ul>" + item.statutes.map((i) => "<li>" + escapeHtml(i) + "</li>").join("") + "</ul>", false) : "") +
        (item.lawFirmAngles && item.lawFirmAngles.length ? fold("律所可用角度", "<ul>" + item.lawFirmAngles.map((a) => "<li>" + escapeHtml(ANGLES[a] || a) + "</li>").join("") + "</ul>", false) : "") +
        (review ? foldText("采集说明", review, false) : "") +
        '<div class="block"><h3>来源</h3><p><a href="' + escapeHtml(item.sourceUrl) + '" target="_blank" rel="noreferrer">打开原文网站</a></p></div>';
    }
    function renderChecks(item) {
      const checks = (item.verification && item.verification.checks) || [];
      if (!checks.length) return "";
      return fold("验证", '<ul class="checks">' +
        checks.map((check) => '<li class="' + (check.ok ? "ok" : "bad") + '">' +
          (check.ok ? "通过" : "待核") + " · " + escapeHtml(check.detail) + "</li>").join("") + "</ul>", false);
    }
    function runLink(run, label) {
      if (!run || !run.id) return "";
      return '<a class="live" href="/runs/' + run.id + '">' + escapeHtml(label) + "</a>";
    }
    function renderAgentCard(agent) {
      const running = agent.running || pendingRuns.has(agent.id);
      const live = agent.lastRun && (running || agent.lastRun.status === "running") ? agent.lastRun : null;
      const disabled = !canRun(agent);
      const label = running ? "正在采集…" : agent.blocked ? "无法采集" : "立即采集";
      const runBtn = isAdmin
        ? '<button type="button" data-run="' + agent.id + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>"
        : "";
      const peek = running && live
        ? runLink(live, "查看本次采集")
        : (agent.lastRun ? runLink(agent.lastRun, "查看上次采集") : "");
      const names = (desk.ops && desk.ops.pipeline ? desk.ops.pipeline.channels : [])
        .filter((c) => c.agentId === agent.id)
        .map((c) => c.name)
        .join("、");
      return '<p class="k">' + (agent.kind === "tender" ? "招标" : "案件") + "</p>" +
        '<h2><span class="lamp ' + lampClass(agent) + '"></span>' + escapeHtml(agent.name) + "</h2>" +
        '<div class="state">' + escapeHtml(agentState(agent)) + "<br/>" +
        escapeHtml(lastLine(agent)) +
        (agent.nextDueAt && !running ? "<br/>下次 " + escapeHtml(fmtTime(agent.nextDueAt)) : "") + "</div>" +
        '<div class="hint">渠道：' + escapeHtml(names || "未登记") +
        (peek ? " · " + peek : "") + "</div>" +
        runBtn;
    }
    function renderPipeline(ops) {
      const llm = ops && ops.llm ? ops.llm : {};
      const pipeline = ops && ops.pipeline ? ops.pipeline : { stages: [], channels: [] };
      const model = llm.configured ? "采集服务已接通" : "采集服务未接通";
      const stages = (pipeline.stages || []).map((s) => "<span>" + escapeHtml(s.name) + "</span>").join("");
      return '<p class="k">怎么采</p>' +
        "<h2>采集说明</h2>" +
        '<div class="state">' + escapeHtml(model) + "。系统按日程自动找法律服务招标和权威案例，筛掉无关信息后再给你看。</div>" +
        '<div class="hint">发现 → 判定是否相关 → 抽取要点 → 核对截止日 → 入库。</div>' +
        '<div class="stages">' + stages + "</div>";
    }
    function channelRun(channel) {
      const agent = (desk.agents || []).find((a) => a.id === channel.agentId);
      const runs = (desk.runs || []).filter((r) => r.sourceId === channel.id || r.sourceId === channel.agentId);
      return { agent, run: runs[0] || agent && agent.lastRun || null };
    }
    function channelStatus(channel) {
      const { agent, run } = channelRun(channel);
      if (agent && (agent.running || pendingRuns.has(agent.id))) {
        return { lamp: "run", text: "正在采集", link: run && run.id ? run : agent.lastRun };
      }
      if (!run) return { lamp: "", text: "还没有采集过", link: null };
      if (run.status === "running") return { lamp: "run", text: "正在采集", link: run };
      if (run.status === "ok") {
        return { lamp: "ok", text: run.succeeded ? ("上次入库 " + run.succeeded + " 条") : "上次没有新情报", link: run };
      }
      if (run.status === "partial") {
        return { lamp: "due", text: "上次入库 " + run.succeeded + " 条，有部分没采到", link: run };
      }
      return { lamp: "bad", text: friendlyError(run.error) || "上次没有采完", link: run };
    }
    function paintChannels() {
      const channels = (desk.ops && desk.ops.pipeline && desk.ops.pipeline.channels) || [];
      $("channel-list").innerHTML = channels.map((channel) => {
        const status = channelStatus(channel);
        const name = channel.name || CHANNEL_NAME[channel.id] || channel.id;
        const link = status.link && (status.lamp === "run" || status.link.status === "running")
          ? runLink(status.link, "查看本次采集")
          : "";
        return '<div class="channel"><b><span class="lamp ' + status.lamp + '"></span>' +
          escapeHtml(name) + "</b><div class='meta'>" + escapeHtml(status.text) +
          (link ? "<br/>" + link : "") + "</div></div>";
      }).join("") || '<p class="empty">还没有登记采集渠道。</p>';
    }
    function paintList() {
      const rows = tab === "tender" ? desk.tenders : desk.cases;
      $("items").innerHTML = rows.map(itemCard).join("") ||
        (tab === "tender"
          ? '<p class="empty">暂无招投标情报。系统会按日程继续采集。</p>'
          : '<p class="empty">暂无案件情报。</p>');
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
          if (btn.disabled) return;
          pendingRuns.add(btn.dataset.run);
          paintOps();
          paintChannels();
          const res = await api("/api/agents/" + btn.dataset.run + "/run", { method: "POST" });
          if (res.status === 409) $("health").textContent = "上一轮还在采集";
          await loadDesk();
        };
      }
    }
    async function loadDesk() {
      const res = await api("/api/desk");
      desk = await res.json();
      for (const agent of desk.agents || []) {
        if (!agent.running) pendingRuns.delete(agent.id);
      }
      $("health").textContent = "招投标 " + desk.tenders.length + " · 案件 " + desk.cases.length;
      paintOps();
      paintChannels();
      paintList();
      const running = (desk.agents || []).some((a) => a.running) || pendingRuns.size > 0;
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

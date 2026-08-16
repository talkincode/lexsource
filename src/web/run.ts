import type { User } from "../domain/auth";
import { FONT_LINKS, SHELL_CSS, escapeHtml, headerHtml } from "./shell";

export function runHtml(user: User, runId: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>采集过程 · 律源 LexSource</title>
  ${FONT_LINKS}
  <style>${SHELL_CSS}
    main { max-width: 760px; padding: 28px 32px 72px; }
    .lede { color: var(--mute); line-height: 1.65; margin: 0 0 22px; }
    .summary {
      background: var(--panel); border: 1px solid var(--line); padding: 20px 22px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; margin: 0 0 28px;
    }
    .summary dt { font-size: 11px; letter-spacing: .12em; color: var(--brass-deep); margin: 0 0 4px; }
    .summary dd { margin: 0; font-size: 16px; line-height: 1.45; }
    .step { padding: 10px 0 10px 14px; border-left: 2px solid var(--line); margin: 0 0 10px; }
    .step.ok { border-color: var(--ok); }
    .step.bad { border-color: var(--alert); }
    .step .kind { font-size: 12px; letter-spacing: .08em; color: var(--brass-deep); }
    .step p { margin: 4px 0 0; line-height: 1.55; color: var(--ink-soft); word-break: break-word; }
    @media (max-width: 700px) { .summary { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  ${headerHtml(user, "run")}
  <main>
    <p class="lede">这一页只说明这一轮采集的结果。律师日常看情报台即可；这里给需要核对采集过程的人用。</p>
    <div id="summary"><p class="empty">加载中…</p></div>
    <h2>采集过程</h2>
    <div id="steps"></div>
  </main>
  <script>
    const runId = ${JSON.stringify(runId)};
    const $ = (id) => document.getElementById(id);
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>\"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
    }
    function fmtTime(iso) {
      if (!iso) return "—";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return String(iso);
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short"
      }).format(date);
    }
    const CHANNEL = {
      tender: "招标采集",
      case: "案件采集",
      ccgp: "中国政府采购网",
      ggzy: "全国公共资源交易平台",
      "spc-guiding": "最高人民法院指导性案例"
    };
    const STATUS = { running: "正在采集", ok: "已完成", partial: "部分完成", error: "未完成" };
    const ERR = {
      http_error: "来源网站暂时打不开",
      blocked_host: "该来源不允许自动采集",
      azure_openai_unconfigured: "采集服务未接通",
      parse: "页面读不出来",
      agent_no_result: "这一轮没有采到可用情报",
      run_in_progress: "上一轮还在进行"
    };
    function friendlyError(code) {
      if (!code) return "—";
      return ERR[code] || "采集没有完成，可稍后重试";
    }
    function stepTitle(step) {
      const tool = step.tool || "";
      if (step.kind === "error") return "遇到问题";
      if (tool === "list_channels") return "查看采集渠道";
      if (tool === "fetch_url") return step.kind === "action" ? "打开页面" : "已读页面";
      if (tool === "extract_links") return "挑选公告链接";
      if (tool === "save_intel") return "入库一条情报";
      if (tool === "skip") return "跳过无关信息";
      if (tool === "finish") return "本轮结束";
      if (step.kind === "thought") return "判断";
      return "处理中";
    }
    function stepBody(step) {
      const value = step.kind === "action" ? step.input : step.output;
      if (value == null) return "";
      if (typeof value === "string") return value;
      if (value.error) return friendlyError(value.error);
      if (value.title) return value.title;
      if (value.url) return value.url;
      if (value.reason) return value.reason;
      if (value.summary) return value.summary;
      if (value.text) return value.text;
      return "";
    }
    $("logout").onclick = async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.href = "/";
    };
    async function load() {
      const res = await fetch("/api/ingest-runs/" + runId);
      if (res.status === 401) { location.href = "/"; return; }
      if (res.status === 404) {
        $("summary").innerHTML = '<p class="empty">找不到这次采集记录。</p>';
        return;
      }
      const data = await res.json();
      const run = data.run || {};
      const running = run.status === "running";
      $("health").textContent = running ? "正在采集" : (STATUS[run.status] || "采集过程");
      $("summary").innerHTML = '<dl class="summary">' +
        "<div><dt>来源</dt><dd>" + escapeHtml(CHANNEL[run.sourceId] || run.sourceId) + "</dd></div>" +
        "<div><dt>状态</dt><dd>" + escapeHtml(STATUS[run.status] || run.status) + "</dd></div>" +
        "<div><dt>新入库</dt><dd>" + Number(run.succeeded || 0) + " 条</dd></div>" +
        "<div><dt>跳过</dt><dd>" + Number(run.skipped || 0) + " 条</dd></div>" +
        "<div><dt>未采到</dt><dd>" + Number(run.failed || 0) + " 条</dd></div>" +
        "<div><dt>开始时间</dt><dd>" + escapeHtml(fmtTime(run.startedAt)) + "</dd></div>" +
        (run.error ? "<div><dt>说明</dt><dd>" + escapeHtml(friendlyError(run.error)) + "</dd></div>" : "") +
        "</dl>";
      const steps = data.steps || [];
      $("steps").innerHTML = steps.length
        ? steps.map((step) => {
            const bad = step.kind === "error" || (step.output && step.output.error);
            return '<div class="step ' + (bad ? "bad" : "ok") + '"><div class="kind">' +
              escapeHtml(stepTitle(step)) + "</div><p>" +
              escapeHtml(String(stepBody(step) || "").slice(0, 280)) + "</p></div>";
          }).join("")
        : '<p class="empty">这一轮还没有可展示的过程。</p>';
      if (running) setTimeout(load, 2500);
    }
    load();
  </script>
</body>
</html>`;
}

export function runMissingHtml(user: User): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>采集过程 · 律源 LexSource</title>
  ${FONT_LINKS}
  <style>${SHELL_CSS}
    main { max-width: 760px; padding: 28px 32px 72px; }
  </style>
</head>
<body>
  ${headerHtml(user, "run")}
  <main>
    <p class="empty">找不到这次采集记录。</p>
    <p><a href="/">返回情报台</a></p>
  </main>
  <script>
    document.getElementById("logout").onclick = async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.href = "/";
    };
  </script>
</body>
</html>`;
}

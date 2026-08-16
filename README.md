# 律源 LexSource

给律所的案源情报库：收集全国法律服务招投标，整理可公开使用的重大案件，验证后供检索和导出。

```text
公开标讯 / 最高法案例 / 律师上传
        → 抽取 → 验证 → 情报库
        → Web 情报台 / Markdown / Word / PDF
```

正确优于完整。截止日期写错，比没有这条标更糟。

## 现在能做什么

- 入库招标情报（政采网、公共资源交易平台适配器）
- 整编最高法指导性案例为律所 brief
- 验证来源、截止日、预算，并判定是否可投标
- 按类型、关键词、可投标过滤
- 导出 Markdown、Word、PDF
- 打开本地情报台
- 从 URL 或本地 HTML 采集入库（ccgp / ggzy / 指导性案例）；定时轮询默认关闭
- 按地域 / 服务类型 / 预算订阅入库情报；不可投标的招标不推送；默认可写 `var/outbox.jsonl`

项目画像、非目标和验收矩阵见 [docs/roadmap.md](docs/roadmap.md)。Agent 硬约束见 [AGENTS.md](AGENTS.md)。

## 质量与验收

一级业务功能必须有可运行的 E2E，并登记在 [验收矩阵](docs/roadmap.md#验收矩阵业务能力覆盖矩阵)。覆盖底线：Happy Path、高风险失败路径、权限双角色（引入登录后生效）、写操作失败不落脏数据。新增一级功能却不更新矩阵，变更不完整。

## 本地运行

需要 [Bun](https://bun.sh) 1.3+。

```bash
bun install
bun test
bun src/cli.ts ingest-fixtures
bun --hot src/server.ts
```

浏览器打开 `http://127.0.0.1:8787`。数据库默认写在 `var/lexsource.db`。

## CI / 发版

- push 到 `main` 或开 PR 会跑 `bun test`，以及一次不打外网的 `ingest-fixtures` smoke。
- 打 `vX.Y.Z` tag 会先跑同样测试，再创建 GitHub Release，并附带不含 `node_modules` 的可部署归档。

```bash
bun src/cli.ts ingest --source ccgp --url tests/fixtures/tenders/ccgp-legal-counsel.html
curl -s http://127.0.0.1:8787/api/health
curl -s 'http://127.0.0.1:8787/api/intel?type=tender&biddable=1'
curl -s -X POST http://127.0.0.1:8787/api/sources/ccgp/run
curl -s http://127.0.0.1:8787/api/ingest-runs
curl -s -X POST http://127.0.0.1:8787/api/subscriptions \
  -H 'content-type: application/json' \
  -d '{"name":"北京常年顾问","type":"tender","region":"北京","serviceType":"general_counsel"}'
```

订阅默认写入 `var/outbox.jsonl`。若设置 `LEXSOURCE_WEBHOOK_URL`，同一事件会再 POST 到该地址（预留通道）。

定时轮询默认关闭。打开时设置 `LEXSOURCE_POLL_ENABLED=1`，间隔默认 1 小时（`LEXSOURCE_POLL_INTERVAL_MS`，源列表 `LEXSOURCE_POLL_SOURCES=ccgp,ggzy`）。测试用注入 HTTP / 录制响应，不打外网。

手工入库：

```bash
curl -s -X POST http://127.0.0.1:8787/api/intel/ingest \
  -H 'content-type: application/json' \
  -d '{"sourceId":"ccgp","sourceUrl":"https://www.ccgp.gov.cn/example.htm","text":"项目名称：测试\\n采购人：测试单位\\n预算金额：10万元\\n投标截止时间：2026年12月31日"}'
```

## 技术边界

Bun + TypeScript + Hono + SQLite。不爬裁判文书网。PDF 目前可下载，中文以转义写入标准字体；正式排版以 Markdown / Word 为准。


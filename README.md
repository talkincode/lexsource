# 律源 LexSource

律所内部的情报值班台。采集 Agent 按所内日程自己去找法律服务招投标和权威案例，筛掉无关信息后再入库。律师登录看到的是已经采好、已经评过的成品，不是检索框。

```text
政采网 / 公资平台 / 最高法公开案例
        │
        ▼
  ReAct 采集 Agent
  思考 → 调工具 → 观察 → 再决定
  list_channels / fetch_url / extract_links
  save_intel 或 skip → finish
        │
        ▼
  抽取 → schema/截止日验证 → SQLite
        │
        ▼
  登录后的值班台（状态灯 + 运行轨迹 + 可投标/案件）
  Markdown / Word / PDF
```

它不是公开网站，不是法律搜索引擎，也不是聊天机器人。正确优于完整：截止日期写错，比没有这条标更糟。

项目画像、非目标和验收矩阵见 [docs/roadmap.md](docs/roadmap.md)。Agent 硬约束见 [AGENTS.md](AGENTS.md)。

## 打开会看到什么

登录后是一块值班台，不是后台表格。

- **状态灯**：招标采集、案件采集各自显示待命 / 已到点 / 运行中 / 已暂停 / 模型未接。
- **采集链路**：写明这是 ReAct 工具循环，以及发现 → 判定 → 抽取 → 验证 → 入库。
- **运行轨迹**：每一次运行的思考、工具调用、观察结果，点开就能回放 Agent 刚才做了什么。
- **成品区**：默认是「现在还能投」的法律服务标，和「所里能用的案件」brief。

律师只看结果和轨迹。管理员可以改日程、立即跑一轮、管账号。未登录只能看到登录页。

界面是服务端渲染的 HTML，不是 React SPA。这里的 **ReAct** 指采集 Agent 的 Reason + Act 协议，不是前端框架。

## 情报怎么来的

两个 Agent，三个渠道：

| Agent | 渠道 | 做什么 |
| --- | --- | --- |
| 招标采集 `tender` | 中国政府采购网 `ccgp`、全国公共资源交易平台 `ggzy` | 只入库法律服务采购 |
| 案件采集 `case` | 最高人民法院指导性案例 `spc-guiding` | 整编所内可用 brief |

Agent 不按网站写死解析器。它按策略调用通用工具：先打开种子页，再挑详情，读正文后决定 `save_intel` 或 `skip`。办公用品、工程、设备采购在这一步就被丢掉。

`save_intel` 之后才进入抽取和验证。过期标、验证失败、裁判文书网地址都不会变成可投标。来源 URL 和原文一直留着。

没有配置 Azure OpenAI 时，Agent 仍会留下一轮运行记录，状态是 `azure_openai_unconfigured`，值班台上的灯是红的，库里不会出现假情报。

## 本地运行

需要 [Bun](https://bun.sh) 1.3+。

```bash
bun install
bun test
bun src/cli.ts ingest-fixtures
LEXSOURCE_ADMIN_PASSWORD=changeme8 LEXSOURCE_LAWYER_PASSWORD=changeme8 bun --hot src/server.ts
```

浏览器打开 `http://127.0.0.1:8787`，用 `admin` / `changeme8` 登录。数据库默认写在 `var/lexsource.db`。口令至少 8 位。也可以：

```bash
bun src/cli.ts create-user --username admin --password changeme8 --role admin
bun src/cli.ts create-user --username lawyer --password changeme8 --role lawyer
```

采集要能真正跑起来，还需要 Azure OpenAI（任选一组）：

- `LEXSOURCE_AZURE_OPENAI_API_URL` / `LEXSOURCE_AZURE_OPENAI_API_KEY`
- 或 `AZURE_OPENAI_API_URL` / `AZURE_OPENAI_API_KEY`
- 可选 `LEXSOURCE_AZURE_OPENAI_MODEL`

macOS 也会读钥匙串里的 `AZURE_OPENAI_API_URL` / `AZURE_OPENAI_API_KEY`。密钥不要写进仓库。

Agent 默认按「每天 08:00（上海）」跑招标和案件。关掉调度：`LEXSOURCE_SCHEDULER_ENABLED=0`。管理员可在设置里改间隔和时刻。测试用注入 HTTP / 录制响应，不打外网。

手工灌一条本地 fixture：

```bash
bun src/cli.ts ingest --source ccgp --url tests/fixtures/tenders/ccgp-legal-counsel.html
```

## 质量与验收

一级业务功能必须有可运行的 E2E，并登记在 [验收矩阵](docs/roadmap.md#验收矩阵业务能力覆盖矩阵)。覆盖底线：Happy Path、高风险失败路径、权限双角色、写操作失败不落脏数据。新增一级功能却不更新矩阵，变更不完整。

## CI / 发版

- push 到 `main` 或开 PR 会跑 `bun test`，以及一次不打外网的 `ingest-fixtures` smoke。
- 打 `vX.Y.Z` tag 会先跑同样测试，再创建 GitHub Release，并附带不含 `node_modules` 的可部署归档。

## 技术边界

Bun + TypeScript + Hono + SQLite。前端是服务端 HTML，不引入 Vite。采集 Agent 走 Azure OpenAI 的 ReAct 工具循环。不爬裁判文书网。不做公开网站，不做订阅推送产品。PDF 目前可下载，中文以转义写入标准字体；正式排版以 Markdown / Word 为准。

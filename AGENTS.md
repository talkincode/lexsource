# LexSource Agent Spec

项目画像、非目标和完整验收矩阵在 [docs/roadmap.md](docs/roadmap.md)。改代码前先读它。

LexSource 是律所内部的自动情报系统：由内部采集 Agent 按可配置日程采集法律服务招投标与案件情报。律师登录后直接查看已采好、已筛过的结果。它不是公开网站，不是法律搜索引擎，不是订阅推送产品，也不是爬虫实验场。

## 核心边界（MUST）

- MUST 使用 Bun + TypeScript。用 `bun` 跑脚本和测试，不要引入 Node 工具链或 Vite。
- MUST 未登录不得访问情报台，也不得通过 API 读取或写入情报。这是所内系统，不是公开网站。
- MUST 以定时采集 Agent 为运行核心。招标与案件按所内可配置周期自动采集；人打开看到的是已入库成品。
- MUST 把法律相关性判定做在采集侧。非法律服务标讯、无关信息不得进入律师日常视图。
- MUST NOT 把检索、过滤、关键词拼装做成产品主交互。辅助查找可以有，首页必须是已采集结果。
- MUST NOT 把订阅推送（邮件 / 企微 / webhook / outbox 匹配投递）做成产品能力。
- MUST NOT 把采集 Agent 做成聊天机器人或「你问我搜」的对话检索。
- MUST NOT 自动采集 `wenshu.court.gov.cn`。律师上传与商业授权 API 可走同一入库管道。
- MUST NOT 在抽取结果未通过 schema 与验证前把它标为 `verified`。
- MUST NOT 把过期或验证失败的招标显示为可投标。
- MUST 保留来源 URL 与原文。删除追溯信息等于破坏产品。
- MUST 以 Markdown 为导出真源，Word / PDF 由同一份 Markdown 生成。
- MUST NOT 为了“架构完整”并行引入 Go 服务。只有采集并发或延迟被测到成为瓶颈时，才允许拆出 fetcher。
- Secrets 只走环境变量和本地忽略文件。禁止把密钥、客户名单、真实投标策略写进仓库。

## 工程纪律

- 新源必须是适配器，注册进 `src/sources/registry.ts`，并带 HTML fixture。
- 截止日期、预算、采购人属于高风险字段：改抽取逻辑时必须更新 golden fixture 测试。
- 本地库文件在 `var/`，已 gitignore。
- 用 `bun test` 验证。不要为了绿测试放宽可投标规则。
- 改 CI 或依赖后必须本地 `bun test`。

## 常用命令

```bash
bun install
bun test
bun src/cli.ts ingest-fixtures
bun src/cli.ts ingest --source ccgp --url tests/fixtures/tenders/ccgp-legal-counsel.html
bun --hot src/server.ts
```

默认地址：`http://127.0.0.1:8787`。未登录不得访问情报台与情报 API。本地首次启动需设置 `LEXSOURCE_ADMIN_PASSWORD`（可选 `LEXSOURCE_LAWYER_PASSWORD`），或 `bun src/cli.ts create-user`。

前端是服务端 HTML，不是 React SPA。采集 Agent 实现 ReAct（思考 → 工具 → 观察），步骤写入 `ingest_run_steps`，值班台必须能回放。没有配置 Azure OpenAI 时运行记录须显示 `azure_openai_unconfigured`，不得伪装成空闲。

## 验收矩阵（硬性规定）

完整矩阵只维护在 [docs/roadmap.md](docs/roadmap.md#验收矩阵业务能力覆盖矩阵)。以下五条是 MUST：

1. 每个一级功能至少有一条 Happy Path E2E。
2. 每个高风险功能至少覆盖一条失败路径。
3. 每个涉及权限的功能至少验证两种角色。
4. 每个会修改系统状态的操作至少验证一次失败后的恢复或回滚。
5. 新增一级业务功能时，必须同步新增对应 E2E 并更新 `docs/roadmap.md` 的验收矩阵，否则变更不完整。

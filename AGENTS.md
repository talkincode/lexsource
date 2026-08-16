# LexSource Agent Spec

项目画像、非目标和完整验收矩阵在 [docs/roadmap.md](docs/roadmap.md)。改代码前先读它。

LexSource 是律所案源情报库，不是法律搜索引擎，也不是爬虫实验场。

## 核心边界（MUST）

- MUST 使用 Bun + TypeScript。用 `bun` 跑脚本和测试，不要引入 Node 工具链或 Vite。
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

## 常用命令

```bash
bun install
bun test
bun src/cli.ts ingest-fixtures
bun --hot src/server.ts
```

默认地址：`http://127.0.0.1:8787`。

## 验收矩阵（硬性规定）

完整矩阵只维护在 [docs/roadmap.md](docs/roadmap.md#验收矩阵业务能力覆盖矩阵)。以下五条是 MUST：

1. 每个一级功能至少有一条 Happy Path E2E。
2. 每个高风险功能至少覆盖一条失败路径。
3. 每个涉及权限的功能至少验证两种角色。
4. 每个会修改系统状态的操作至少验证一次失败后的恢复或回滚。
5. 新增一级业务功能时，必须同步新增对应 E2E 并更新 `docs/roadmap.md` 的验收矩阵，否则变更不完整。

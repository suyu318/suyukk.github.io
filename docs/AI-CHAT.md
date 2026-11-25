# 站内 AI 助手（左下角悬浮球）

在博客左下角提供一个悬浮对话球，回答只依据站内已发布文章，回答下方附带引用来源。

## 工作方式

```
构建期                                  运行时
─────────────────────────────           ─────────────────────────────
Markdown 文章                           浏览器悬浮球
   │  scripts/build-kb.mjs                  │ POST /api/chat
   ▼                                       ▼
src/generated/kb.json  ──────────────▶  BM25 检索（中文字二元组）
（4 篇 / 52 段）                            │ 取 Top 5 片段
                                           ▼
                                      拼系统提示词 → 调用 LLM（流式）
                                           │ NDJSON 回传
                                           ▼
                                      逐字渲染 + 引用来源
```

- 检索在服务端完成，语料只有几十 KB，单次查询开销可忽略。
- 模型密钥只存在于服务端环境变量，不会进入浏览器。
- 站点其余部分仍是纯静态页面，只有 `/api/chat` 是函数。

## 目录

| 路径 | 作用 |
| --- | --- |
| `scripts/build-kb.mjs` | 扫描文章、切片、生成索引 |
| `src/generated/kb.json` | 生成的索引（已 gitignore） |
| `src/utils/kb-search.ts` | BM25 检索实现 |
| `src/pages/api/chat.ts` | 流式对话接口、提示词、限流 |
| `src/components/widget/ChatWidget.svelte` | 悬浮球与对话框 |
| `src/config.ts` → `chatWidgetConfig` | 文案、推荐问题、模型名等 |

## 配置项

```ts
export const chatWidgetConfig: ChatWidgetConfig = {
	enable: true,
	title: "问问小素",
	subtitle: "基于站内文章回答",
	welcome: "我是这个博客的站内助手……",
	suggestions: ["这个博客都写了些什么？", "……"],
	apiPath: "/api/chat/",
	model: "deepseek-chat",
	maxContextChunks: 5,
	showSources: true,
};
```

索引范围由脚本决定：`src/content/posts` 下 `draft: true` 与 `encrypted: true` 的文章都会被跳过，加密文章不会进入知识库。

## 环境变量

在项目根目录 `.env`（本地）或 Vercel 项目设置（线上）中配置：

```bash
LLM_API_KEY=sk-xxxxxxxx
LLM_BASE_URL=https://api.deepseek.com   # 可换任意 OpenAI 兼容接口
LLM_MODEL=deepseek-chat
```

兼容的接口举例：

- DeepSeek 官方：`https://api.deepseek.com` + `deepseek-chat`
- 中转网关：`https://你的网关域名/v1` + 网关提供的模型名（如 `deepseek-v4.1-flash`）
- OpenAI：`https://api.openai.com/v1` + `gpt-4o-mini`
- Ollama：`http://127.0.0.1:11434/v1` + `qwen2.5:7b`（本地无需密钥，`LLM_API_KEY=ollama` 占位即可）

`LLM_BASE_URL` 结尾是否带 `/v1` 都可以：代码会先按原样请求 `/chat/completions`，遇到 404 自动再试 `/v1/chat/completions`。

密钥只从运行时环境变量读取；本地开发会回退到 `.env`，生产构建不会把密钥打进产物。

## 本地调试

```bash
pnpm kb        # 只在文章有变动时手动重建索引
pnpm dev       # 启动时也会自动重建
```

`pnpm dev` 下 `/api/chat` 由 Astro 直接处理，改完即生效。

## 部署说明

引入 `@astrojs/vercel` 后，构建产物改为 Vercel Build Output API 格式，因此 `vercel.json` 里去掉了 `buildCommand` / `outputDirectory` / `installCommand`，交由 Vercel 自动识别。其余页面仍是预渲染的静态文件。

产物路径随之变化，构建脚本已做适配：

1. `astro build` 输出 `dist/client`（静态）与 `dist/server`（函数入口），并生成 `.vercel/output`；
2. `pagefind --site dist/client` 写入搜索索引；
3. `compress-fonts` 把子集字体写入 `dist/client/assets/font`；
4. `sync-vercel-static.mjs` 把上述新增文件补进 `.vercel/output/static`（适配器复制发生在这两步之前）。

若移除适配器、回到纯静态部署，需要把 `build` 脚本里的 `dist/client` 改回 `dist`，并删除 `sync-vercel-static.mjs` 这一步。

需要在 Vercel 控制台为 Production / Preview 环境都添加 `LLM_API_KEY`，否则接口会返回 503，前端提示"服务端未配置模型密钥"。

## 成本与防护

- 单次请求最多注入 5 个片段（约 5k 字符），`max_tokens` 900。
- 同一 IP 每分钟最多 20 次，超出返回 429。
- 单条提问最长 1200 字，保留最近 8 轮上下文。

## 排错

| 现象 | 原因 |
| --- | --- |
| 页面提示"未配置模型密钥" | 环境变量没加或没重新部署 |
| 401 / "模型密钥无效" | key 错误，或 `LLM_BASE_URL` 与 key 不属于同一家 |
| 回答说"博客里还没写到" | 检索未命中，检查文章是否已发布且 `draft` 不是 true |
| 索引没更新 | 新文章需要重新构建，`pnpm build` 会自动重建 |

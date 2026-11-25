import type { APIRoute } from "astro";
import kbData from "../../generated/kb.json";
import { chatWidgetConfig, siteConfig } from "../../config";
import { search, type KbChunk } from "../../utils/kb-search";

export const prerender = false;

const KB = kbData.chunks as KbChunk[];

type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 8;
const MAX_CHARS = 1200;
const MAX_CONTEXT_CHARS = 5200;
const RATE_LIMIT = 20;
const RATE_WINDOW = 60_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
	const now = Date.now();
	if (buckets.size > 500) {
		for (const [key, value] of buckets) {
			if (now > value.resetAt) buckets.delete(key);
		}
	}
	const bucket = buckets.get(ip);
	if (!bucket || now > bucket.resetAt) {
		buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
		return false;
	}
	bucket.count += 1;
	return bucket.count > RATE_LIMIT;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function buildContext(query: string) {
	// 元问题（“这个博客写了什么”）不走向量式片段检索，直接给文章目录
	const metaWords = ["写了什么", "写了些什么", "有哪些", "讲了什么", "介绍"];
	const isMeta =
		(query.includes("博客") || query.includes("本站") || query.includes("这个站")) &&
		metaWords.some((word) => query.includes(word));

	const hits = isMeta ? [] : search(KB, query, chatWidgetConfig.maxContextChunks);
	const titles = [...new Set(KB.map((chunk) => chunk.title))]
		.map((title) => {
			const chunk = KB.find((item) => item.title === title);
			return `- ${title}（${chunk?.url ?? ""}）`;
		})
		.join("\n");

	let budget = MAX_CONTEXT_CHARS;
	const blocks: string[] = [];
	for (const [index, hit] of hits.entries()) {
		const block = `【资料 ${index + 1}】《${hit.title}》/ ${hit.heading}\n链接：${hit.url}\n${hit.text}`;
		if (block.length > budget) break;
		budget -= block.length;
		blocks.push(block);
	}

	return {
		hits,
		context: blocks.join("\n\n"),
		titles,
	};
}

function buildSystemPrompt(context: string, titles: string) {
	return `你是「${siteConfig.title}」个人博客的站内助手「小素」。你只依据下面提供的站内资料回答用户问题。

回答规则：
1. 只用简体中文，语气自然、克制，像站主本人。
2. 资料里有依据的，直接给结论和必要步骤；命令要完整可复制。
3. 资料里没有的，明确说“这个博客里还没写到”，可以建议去归档页看看，绝不编造事实或链接。
4. 允许使用 Markdown：短列表、加粗、行内代码和代码块都可以用，代码块要标注语言（如 bash）。不要用一级标题，不要写表格和分隔线。
5. 不要输出“资料 1”“根据资料”之类的措辞，也不要重复文章标题列表——界面会单独展示引用来源。
6. 回答控制在 300 字以内，除非用户明确要求展开。

站内全部文章目录（仅用于判断“有没有写过”）：
${titles || "（暂无）"}

与本次问题最相关的正文片段：
${context || "（没有检索到相关片段）"}`;
}

export const POST: APIRoute = async ({ request }) => {
	const apiKey =
		process.env.LLM_API_KEY ??
		process.env.DEEPSEEK_API_KEY ??
		// 仅本地开发回退到 .env；生产环境只认运行时环境变量，避免密钥被打进产物
		(import.meta.env.DEV ? import.meta.env.LLM_API_KEY : undefined);
	if (!apiKey) {
		return json(
			{
				error: "missing_key",
				message:
					"服务端未配置模型密钥，请在环境变量中设置 LLM_API_KEY 后重新部署。",
			},
			503,
		);
	}

	const ip =
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		request.headers.get("x-real-ip") ??
		"unknown";
	if (rateLimited(ip)) {
		return json(
			{ error: "rate_limited", message: "问得有点快，休息一下再试。" },
			429,
		);
	}

	let payload: { messages?: ChatMessage[] };
	try {
		payload = await request.json();
	} catch {
		return json({ error: "bad_request", message: "请求格式不正确。" }, 400);
	}

	const incoming = Array.isArray(payload.messages) ? payload.messages : [];
	const history = incoming
		.filter(
			(item): item is ChatMessage =>
				(item?.role === "user" || item?.role === "assistant") &&
				typeof item?.content === "string" &&
				item.content.trim().length > 0,
		)
		.slice(-MAX_MESSAGES)
		.map((item) => ({
			role: item.role,
			content: item.content.slice(0, MAX_CHARS),
		}));

	const lastUser = [...history].reverse().find((item) => item.role === "user");
	if (!lastUser) {
		return json({ error: "bad_request", message: "缺少提问内容。" }, 400);
	}

	const { hits, context, titles } = buildContext(lastUser.content);

	const baseUrl = (
		process.env.LLM_BASE_URL ??
		(import.meta.env.DEV ? import.meta.env.LLM_BASE_URL : undefined) ??
		"https://api.deepseek.com"
	).replace(/\/+$/, "");
	const model =
		process.env.LLM_MODEL ??
		(import.meta.env.DEV ? import.meta.env.LLM_MODEL : undefined) ??
		chatWidgetConfig.model;

	const requestBody = JSON.stringify({
		model,
		stream: true,
		temperature: 0.3,
		max_tokens: 900,
		messages: [
			{ role: "system", content: buildSystemPrompt(context, titles) },
			...history,
		],
	});

	// 有的网关需要 /v1 前缀，有的不需要；按顺序试，404 时换下一个
	const endpoints = baseUrl.endsWith("/v1")
		? [`${baseUrl}/chat/completions`]
		: [`${baseUrl}/chat/completions`, `${baseUrl}/v1/chat/completions`];

	let upstream: Response | null = null;
	let lastError: unknown = null;
	for (const endpoint of endpoints) {
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: requestBody,
				signal: AbortSignal.timeout(60_000),
			});
			upstream = response;
			if (response.status !== 404) break;
		} catch (error) {
			lastError = error;
		}
	}

	if (!upstream) {
		console.error("[chat] upstream fetch failed", lastError);
		return json(
			{ error: "upstream_unreachable", message: "模型服务暂时连不上，稍后再试。" },
			502,
		);
	}

	if (!upstream.ok || !upstream.body) {
		const detail = await upstream.text().catch(() => "");
		console.error("[chat] upstream error", upstream.status, detail.slice(0, 500));
		return json(
			{
				error: "upstream_error",
				message:
					upstream.status === 401
						? "模型密钥无效，请检查 LLM_API_KEY。"
						: upstream.status === 404
							? "接口路径不对，检查 LLM_BASE_URL 是否需要以 /v1 结尾。"
							: "模型服务返回异常，稍后再试。",
			},
			502,
		);
	}

	const encoder = new TextEncoder();
	// 引用来源要更严格：只展示高置信片段，避免把弱相关文章也列出来
	const sourceFloor = hits.length
		? Math.max(2.2, hits[0].score * 0.45)
		: Number.POSITIVE_INFINITY;
	const sources: { title: string; heading: string; url: string }[] = [];
	const seenUrls = new Set<string>();
	for (const hit of hits) {
		if (hit.score < sourceFloor) continue;
		if (seenUrls.has(hit.url)) continue;
		seenUrls.add(hit.url);
		sources.push({ title: hit.title, heading: hit.heading, url: hit.url });
		if (sources.length >= 3) break;
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (data: unknown) =>
				controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));

			send({ type: "sources", sources });

			const reader = upstream.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed.startsWith("data:")) continue;
						const data = trimmed.slice(5).trim();
						if (!data || data === "[DONE]") continue;
						try {
							const parsed = JSON.parse(data);
							const text = parsed?.choices?.[0]?.delta?.content;
							if (typeof text === "string" && text.length > 0) {
								send({ type: "delta", text });
							}
						} catch {
							/* 忽略心跳或半包 */
						}
					}
				}
				send({ type: "done" });
			} catch (error) {
				console.error("[chat] stream failed", error);
				send({ type: "error", message: "回答中断了，请重试。" });
			} finally {
				controller.close();
				reader.releaseLock();
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-store, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
};

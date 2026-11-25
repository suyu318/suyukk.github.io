<script lang="ts">
import { marked } from "marked";
import { tick } from "svelte";
import { chatWidgetConfig } from "../../config";

type Source = { title: string; heading: string; url: string };
type Message = {
	role: "user" | "assistant";
	content: string;
	sources?: Source[];
	error?: boolean;
};

const ALLOWED_TAGS = new Set([
	"P", "BR", "STRONG", "B", "EM", "I", "DEL", "S", "CODE", "PRE",
	"UL", "OL", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "HR",
	"TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A",
]);

function sanitizeHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");

	const walk = (node: Element) => {
		for (const child of Array.from(node.children)) {
			if (!ALLOWED_TAGS.has(child.tagName)) {
				if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].includes(child.tagName)) {
					child.remove();
				} else {
					walk(child);
					child.replaceWith(...Array.from(child.childNodes));
				}
				continue;
			}

			for (const attr of Array.from(child.attributes)) {
				const keepHref =
					child.tagName === "A" &&
					attr.name === "href" &&
					/^(https?:\/\/|mailto:|\/)/.test(attr.value);
				if (!keepHref) child.removeAttribute(attr.name);
			}

			if (child.tagName === "A") {
				child.setAttribute("target", "_blank");
				child.setAttribute("rel", "noopener noreferrer");
			}

			walk(child);
		}
	};

	walk(doc.body);
	return doc.body.innerHTML;
}

function renderMarkdown(text: string): string {
	if (typeof window === "undefined") return "";
	const html = marked.parse(text, {
		async: false,
		breaks: true,
		gfm: true,
	}) as string;
	return sanitizeHtml(html);
}

let isOpen = false;
let input = "";
let messages: Message[] = [];
let isStreaming = false;
let scroller: HTMLDivElement | null = null;
let textarea: HTMLTextAreaElement | null = null;
let scrollPending = false;
let hasMessages = false;
let canSend = false;
let controller: AbortController | null = null;

$: hasMessages = messages.length > 0;
$: canSend = input.trim().length > 0 && !isStreaming;

async function scrollToBottom() {
	await tick();
	if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function queueScroll() {
	if (scrollPending) return;
	scrollPending = true;
	requestAnimationFrame(async () => {
		scrollPending = false;
		await scrollToBottom();
	});
}

function toggle() {
	isOpen = !isOpen;
	if (isOpen) {
		scrollToBottom();
		setTimeout(() => textarea?.focus(), 260);
	}
}

function reset() {
	controller?.abort();
	controller = null;
	messages = [];
	isStreaming = false;
}

function autoGrow() {
	if (!textarea) return;
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		void send();
	}
}

async function send(preset?: string) {
	const content = (preset ?? input).trim();
	if (!content || isStreaming) return;

	input = "";
	if (textarea) textarea.style.height = "auto";

	const history = [...messages, { role: "user" as const, content }]
		.slice(-8)
		.map((item) => ({ role: item.role, content: item.content }));

	messages = [
		...messages,
		{ role: "user", content },
		{ role: "assistant", content: "" },
	];
	const index = messages.length - 1;
	isStreaming = true;
	controller = new AbortController();
	queueScroll();

	try {
		const response = await fetch(chatWidgetConfig.apiPath, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: history }),
			signal: controller.signal,
		});

		if (!response.ok) {
			const data = await response.json().catch(() => null);
			throw new Error(
				data?.message ??
					(response.status === 429
						? "问得有点快，休息一下再试。"
						: `请求失败（${response.status}）`),
			);
		}
		if (!response.body) throw new Error("浏览器不支持流式响应。");

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.trim()) continue;
				if (!messages[index]) break;
				let event: {
					type: string;
					text?: string;
					message?: string;
					sources?: Source[];
				};
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}

				if (event.type === "sources" && event.sources) {
					messages[index] = { ...messages[index], sources: event.sources };
				} else if (event.type === "delta" && event.text) {
					messages[index] = {
						...messages[index],
						content: messages[index].content + event.text,
					};
				} else if (event.type === "error") {
					messages[index] = {
						...messages[index],
						content: event.message ?? "回答中断了，请重试。",
						error: true,
					};
				}
				messages = [...messages];
				queueScroll();
			}
		}

		if (messages[index] && !messages[index].content) {
			messages[index] = {
				...messages[index],
				content: "这次没有生成内容，换个问法再试试。",
				error: true,
			};
			messages = [...messages];
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			// 用户清空对话，静默结束
		} else if (messages[index]) {
			messages[index] = {
				...messages[index],
				content:
					error instanceof Error ? error.message : "出了点问题，请稍后再试。",
				error: true,
			};
			messages = [...messages];
		}
	} finally {
		controller = null;
		isStreaming = false;
		queueScroll();
	}
}
</script>

<button
	type="button"
	class="chat-fab fixed bottom-4 left-4 z-50 flex items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-lg transition-all duration-300 hover:scale-105 active:scale-95"
	aria-label={isOpen ? "收起站内助手" : "打开站内助手"}
	aria-expanded={isOpen}
	on:click={toggle}
>
	{#if isOpen}
		<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
			<path
				d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
			/>
		</svg>
	{:else}
		<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
			<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
		</svg>
	{/if}
</button>

{#if isOpen}
	<div
		class="chat-panel fixed bottom-20 left-4 z-50 flex h-[30rem] max-h-[calc(100vh-7rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--radius-large)] border border-black/5 bg-[var(--card-bg)] shadow-xl dark:border-white/10"
		role="dialog"
		aria-label={chatWidgetConfig.title}
	>
		<header class="flex items-center gap-2 border-b border-[var(--line-divider)] px-3 py-2.5">
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--btn-regular-bg)] text-sm font-bold text-[var(--primary)]"
			>
				素
			</div>
			<div class="min-w-0 flex-1">
				<div class="truncate text-sm font-bold text-black/85 dark:text-white/90">
					{chatWidgetConfig.title}
				</div>
				<div class="truncate text-xs text-black/45 dark:text-white/45">
					{chatWidgetConfig.subtitle}
				</div>
			</div>
			{#if hasMessages}
				<button
					type="button"
					class="flex h-7 w-7 items-center justify-center rounded-md text-black/45 transition hover:bg-[var(--btn-regular-bg)] hover:text-black/70 dark:text-white/45 dark:hover:text-white/80"
					aria-label="清空对话"
					on:click={reset}
				>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
						<path
							d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
						/>
					</svg>
				</button>
			{/if}
			<button
				type="button"
				class="flex h-7 w-7 items-center justify-center rounded-md text-black/45 transition hover:bg-[var(--btn-regular-bg)] hover:text-black/70 dark:text-white/45 dark:hover:text-white/80"
				aria-label="关闭"
				on:click={() => (isOpen = false)}
			>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
					<path
						d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
					/>
				</svg>
			</button>
		</header>

		<div class="chat-scroll flex-1 overflow-y-auto px-3 py-3" bind:this={scroller}>
			{#if !hasMessages}
				<div class="flex h-full flex-col justify-center gap-3">
					<div class="flex items-start gap-2.5">
						<div
							class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--btn-regular-bg)] text-[var(--primary)]"
						>
							<svg
								viewBox="0 0 24 24"
								width="15"
								height="15"
								fill="currentColor"
								aria-hidden="true"
							>
								<path
									d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
								/>
							</svg>
						</div>
						<p class="text-sm leading-relaxed text-black/70 dark:text-white/70">
							{chatWidgetConfig.welcome}
						</p>
					</div>
					<div class="flex flex-col gap-2 pl-9">
						{#each chatWidgetConfig.suggestions as suggestion}
							<button
								type="button"
								class="rounded-lg border border-[var(--line-color)] px-3 py-2 text-left text-xs text-black/65 transition hover:border-[var(--primary)] hover:text-[var(--primary)] dark:text-white/65"
								on:click={() => send(suggestion)}
							>
								{suggestion}
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each messages as message}
						<div class="flex flex-col {message.role === 'user' ? 'items-end' : 'items-start'}">
							<div
								class="max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed {message.role ===
								'user'
									? 'rounded-br-md bg-[var(--primary)] text-white'
									: message.error
										? 'rounded-bl-md bg-red-500/10 text-red-600 dark:text-red-400'
										: 'rounded-bl-md bg-[var(--btn-regular-bg)] text-black/80 dark:text-white/85'}"
							>
								{#if message.content}
									{#if message.role === "assistant" && !message.error}
										<div class="md">{@html renderMarkdown(message.content)}</div>
									{:else}
										{message.content}
									{/if}
								{:else if isStreaming}
									<span class="inline-flex items-center gap-1 py-1">
										<span class="dot"></span>
										<span class="dot"></span>
										<span class="dot"></span>
									</span>
								{/if}
							</div>

							{#if chatWidgetConfig.showSources && message.sources && message.sources.length > 0}
								<div class="mt-1.5 flex max-w-[86%] flex-col gap-1">
									{#each message.sources.slice(0, 3) as source}
										<a
											href={source.url}
											title={`${source.title} · ${source.heading}`}
											class="inline-flex items-center gap-1 text-xs text-black/45 transition hover:text-[var(--primary)] dark:text-white/45"
										>
											<svg
												viewBox="0 0 24 24"
												width="13"
												height="13"
												fill="currentColor"
												class="shrink-0"
												aria-hidden="true"
											>
												<path
													d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
												/>
											</svg>
											<span class="truncate">{source.title} · {source.heading}</span>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="border-t border-[var(--line-divider)] px-3 py-2.5">
			<div class="flex items-end gap-2">
				<textarea
					bind:this={textarea}
					bind:value={input}
					on:input={autoGrow}
					on:keydown={onKeydown}
					rows="1"
					maxlength="1000"
					placeholder="问点什么…"
					class="chat-input max-h-24 flex-1 resize-none rounded-xl bg-[var(--btn-regular-bg)] px-3 py-2 text-sm text-black/80 outline-none placeholder:text-black/35 dark:text-white/85 dark:placeholder:text-white/35"
				></textarea>
				<button
					type="button"
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white transition disabled:cursor-not-allowed disabled:opacity-40"
					disabled={!canSend}
					aria-label="发送"
					on:click={() => send()}
				>
					{#if isStreaming}
						<span class="spinner"></span>
					{:else}
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" />
						</svg>
					{/if}
				</button>
			</div>
			<p class="mt-1.5 text-[11px] text-black/35 dark:text-white/35">
				回答由模型依据站内文章生成，可能有误。
			</p>
		</div>
	</div>
{/if}

<style>
	.chat-fab {
		height: 3.25rem;
		width: 3.25rem;
	}

	.chat-panel {
		animation: chat-in 0.22s ease-out;
	}

	@keyframes chat-in {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.chat-scroll {
		scrollbar-width: thin;
	}

	.md {
		word-break: break-word;
	}

	.md :global(p) {
		margin: 0 0 0.5em;
	}

	.md :global(p:last-child) {
		margin-bottom: 0;
	}

	.md :global(strong) {
		font-weight: 600;
	}

	.md :global(ul),
	.md :global(ol) {
		margin: 0.25em 0 0.5em;
		padding-left: 1.15em;
	}

	.md :global(ul) {
		list-style: disc;
	}

	.md :global(ol) {
		list-style: decimal;
	}

	.md :global(li) {
		margin: 0.15em 0;
	}

	.md :global(pre) {
		margin: 0.4em 0;
		padding: 0.55rem 0.65rem;
		border-radius: 0.5rem;
		background: var(--card-bg);
		overflow-x: auto;
		font-size: 12px;
		line-height: 1.55;
	}

	.md :global(pre code) {
		background: transparent;
		padding: 0;
		font-size: inherit;
	}

	.md :global(code) {
		background: var(--card-bg);
		padding: 0.1em 0.32em;
		border-radius: 4px;
		font-size: 0.92em;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}

	.md :global(a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.md :global(blockquote) {
		margin: 0.4em 0;
		padding-left: 0.6em;
		border-left: 2px solid var(--line-color);
		opacity: 0.85;
	}

	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4) {
		font-size: 13px;
		font-weight: 600;
		margin: 0.5em 0 0.25em;
	}

	.md :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
		margin: 0.4em 0;
	}

	.md :global(th),
	.md :global(td) {
		border: 1px solid var(--line-color);
		padding: 0.2em 0.35em;
		text-align: left;
	}

	.md :global(hr) {
		border: 0;
		border-top: 1px solid var(--line-divider);
		margin: 0.6em 0;
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 9999px;
		background: currentColor;
		opacity: 0.45;
		animation: dot-bounce 1.1s infinite ease-in-out;
	}

	.dot:nth-child(2) {
		animation-delay: 0.15s;
	}

	.dot:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes dot-bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.35;
		}
		30% {
			transform: translateY(-3px);
			opacity: 0.8;
		}
	}

	.spinner {
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.chat-panel,
		.dot {
			animation: none;
		}
	}
</style>

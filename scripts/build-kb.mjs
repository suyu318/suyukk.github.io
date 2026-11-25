/**
 * 构建站内知识库索引
 *
 * 扫描 src/content/posts 下已发布的 Markdown 文章，按标题层级切片，
 * 输出 src/generated/kb.json 供 /api/chat 检索使用。
 *
 * 跳过规则：draft: true、encrypted: true（加密文章不进索引）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT, "src/content/posts");
const OUT_DIR = path.join(ROOT, "src/generated");
const OUT_FILE = path.join(OUT_DIR, "kb.json");

const MAX_CHUNK = 900;
const MIN_CHUNK = 60;

function walk(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.isFile() && /\.mdx?$/.test(entry.name)) out.push(full);
	}
	return out;
}

/**
 * 与 Astro 的 entry.id 保持一致：逐段 slug 化
 * 规则来自 github-slugger：转小写、空格转连字符、去掉标点，保留中文
 */
function slugifySegment(segment) {
	return segment
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}\-_]/gu, "");
}

function toSlug(relativePath) {
	return relativePath
		.split("/")
		.map(slugifySegment)
		.join("/")
		.replace(/\/index$/, "");
}

function parseFrontmatter(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) return { data: {}, body: raw };
	const data = {};
	for (const line of match[1].split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
		if (!m) continue;
		let value = m[2].trim();
		if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
		if (value === "true") value = true;
		else if (value === "false") value = false;
		data[m[1]] = value;
	}
	return { data, body: raw.slice(match[0].length) };
}

function stripMarkdown(text) {
	return text
		.replace(/```[\w-]*\r?\n/g, "")
		.replace(/```/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/^\s*>\s?/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "· ")
		.replace(/\|/g, " ")
		.replace(/[*_~`]/g, "")
		.replace(/\r/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function splitLong(text, limit) {
	if (text.length <= limit) return [text];
	const parts = [];
	const paragraphs = text.split(/\n\n/);
	let buffer = "";
	for (const p of paragraphs) {
		if ((buffer + "\n\n" + p).length > limit && buffer) {
			parts.push(buffer.trim());
			buffer = p;
		} else {
			buffer = buffer ? `${buffer}\n\n${p}` : p;
		}
	}
	if (buffer.trim()) parts.push(buffer.trim());
	const out = [];
	for (const part of parts) {
		if (part.length <= limit * 1.4) {
			out.push(part);
			continue;
		}
		for (let i = 0; i < part.length; i += limit) {
			out.push(part.slice(i, i + limit));
		}
	}
	return out;
}

function buildChunks(body, meta, url) {
	const lines = body.split(/\r?\n/);
	const sections = [];
	let current = { heading: "导语", lines: [] };

	for (const line of lines) {
		const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
		if (headingMatch) {
			if (current.lines.join("\n").trim().length > 0) sections.push(current);
			current = { heading: headingMatch[2].trim(), lines: [] };
		} else {
			current.lines.push(line);
		}
	}
	if (current.lines.join("\n").trim().length > 0) sections.push(current);

	const chunks = [];
	for (const section of sections) {
		const text = stripMarkdown(section.lines.join("\n"));
		if (text.length < MIN_CHUNK) continue;
		for (const piece of splitLong(text, MAX_CHUNK)) {
			const cleaned = piece.trim();
			if (cleaned.length < MIN_CHUNK) continue;
			chunks.push({
				id: `${meta.slug}#${chunks.length + 1}`,
				title: meta.title,
				heading: section.heading,
				url,
				date: meta.date,
				category: meta.category,
				tags: meta.tags,
				text: cleaned,
			});
		}
	}
	return chunks;
}

function main() {
	if (!fs.existsSync(POSTS_DIR)) {
		console.error(`[kb] 找不到文章目录：${POSTS_DIR}`);
		process.exit(1);
	}

	const files = walk(POSTS_DIR).sort();
	const chunks = [];
	let posts = 0;
	let skipped = 0;

	for (const file of files) {
		const raw = fs.readFileSync(file, "utf-8");
		const { data, body } = parseFrontmatter(raw);

		if (data.draft === true) {
			skipped++;
			continue;
		}
		if (data.encrypted === true) {
			skipped++;
			continue;
		}

		const rel = path.relative(POSTS_DIR, file).split(path.sep).join("/");
		const slug = toSlug(rel.replace(/\.mdx?$/, ""));
		const url = `/posts/${slug}/`;
		const meta = {
			slug,
			title: String(data.title ?? slug),
			date: String(data.published ?? ""),
			category: String(data.category ?? ""),
			tags: String(data.tags ?? "")
				.replace(/^\[|\]$/g, "")
				.split(",")
				.map((t) => t.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean),
		};

		const postChunks = buildChunks(body, meta, url);
		if (postChunks.length === 0) {
			skipped++;
			continue;
		}
		posts++;
		chunks.push(...postChunks);
	}

	// 站点固定页面（关于页）也纳入索引，便于回答“这个站怎么搭的”这类问题
	const extras = [
		{
			file: path.join(ROOT, "src/content/spec/about.md"),
			slug: "about",
			title: "关于本站",
			url: "/about/",
			category: "页面",
		},
	];
	for (const extra of extras) {
		if (!fs.existsSync(extra.file)) continue;
		const { body } = parseFrontmatter(fs.readFileSync(extra.file, "utf-8"));
		chunks.push(
			...buildChunks(
				body,
				{
					slug: extra.slug,
					title: extra.title,
					date: "",
					category: extra.category,
					tags: ["关于"],
				},
				extra.url,
			),
		);
	}

	fs.mkdirSync(OUT_DIR, { recursive: true });
	fs.writeFileSync(
		OUT_FILE,
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				postCount: posts,
				chunkCount: chunks.length,
				chunks,
			},
			null,
			0,
		),
		"utf-8",
	);

	const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
	console.log(
		`[kb] 已索引 ${posts} 篇文章 / ${chunks.length} 个片段，跳过 ${skipped} 个文件，输出 ${size} KB`,
	);
}

main();

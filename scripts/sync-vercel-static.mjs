/**
 * 把 dist/client 同步到 Vercel Build Output 的 static 目录
 *
 * 使用 @astrojs/vercel 后，astro build 结束时会先把静态文件复制到
 * .vercel/output/static，随后 pagefind / 字体子集化才写入 dist/client。
 * 因此需要一个后置步骤，把新增产物补进最终部署目录。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "dist/client");
const DEST = path.join(ROOT, ".vercel/output/static");

if (!fs.existsSync(SRC)) {
	console.log("[sync] 未找到 dist/client，跳过同步");
	process.exit(0);
}

if (!fs.existsSync(DEST)) {
	console.log("[sync] 未检测到 .vercel/output/static，跳过同步（非 Vercel 适配器构建）");
	process.exit(0);
}

fs.cpSync(SRC, DEST, { recursive: true, force: true });

function countFiles(dir) {
	let total = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		total += entry.isDirectory()
			? countFiles(path.join(dir, entry.name))
			: 1;
	}
	return total;
}

console.log(`[sync] 已同步 ${countFiles(SRC)} 个文件到 .vercel/output/static`);

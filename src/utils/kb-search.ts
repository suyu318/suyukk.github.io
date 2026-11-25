/**
 * 极简 BM25 检索
 *
 * 中文按「字二元组」切分，英文/数字按词切分，无需分词词典。
 * 语料只有几十个片段，单次查询开销可忽略。
 */

export type KbChunk = {
	id: string;
	title: string;
	heading: string;
	url: string;
	date: string;
	category: string;
	tags: string[];
	text: string;
};

export type KbHit = KbChunk & { score: number };

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

export function tokenize(input: string): string[] {
	const text = input.toLowerCase();
	const tokens: string[] = [];

	const words = text.match(/[a-z0-9][a-z0-9_+#.-]*/g);
	if (words) tokens.push(...words);

	const cjkOnly = text.replace(/[^\u3400-\u9fff\uf900-\ufaff]+/g, " ");
	for (const seg of cjkOnly.split(/\s+/)) {
		if (!seg) continue;
		if (seg.length === 1) tokens.push(seg);
		for (let i = 0; i < seg.length - 1; i++) {
			tokens.push(seg.slice(i, i + 2));
		}
	}

	return tokens.filter((t) => t.length > 0 && (CJK.test(t) || t.length > 1));
}

type Doc = { chunk: KbChunk; tf: Map<string, number>; len: number };

export function search(
	chunks: KbChunk[],
	query: string,
	limit = 5,
): KbHit[] {
	const qTokens = [...new Set(tokenize(query))];
	if (qTokens.length === 0 || chunks.length === 0) return [];

	const docs: Doc[] = chunks.map((chunk) => {
		const tokens = tokenize(`${chunk.title} ${chunk.heading} ${chunk.text}`);
		const tf = new Map<string, number>();
		for (const token of tokens) {
			tf.set(token, (tf.get(token) ?? 0) + 1);
		}
		return { chunk, tf, len: tokens.length };
	});

	const total = docs.length;
	const avgLen =
		docs.reduce((sum, doc) => sum + doc.len, 0) / Math.max(total, 1) || 1;
	const k1 = 1.2;
	const b = 0.75;

	const df = new Map<string, number>();
	for (const token of qTokens) {
		let count = 0;
		for (const doc of docs) if (doc.tf.has(token)) count++;
		df.set(token, count);
	}

	const scored: KbHit[] = [];
	for (const doc of docs) {
		let score = 0;
		for (const token of qTokens) {
			const freq = doc.tf.get(token) ?? 0;
			if (freq === 0) continue;
			const docFreq = df.get(token) ?? 0;
			const idf = Math.log(1 + (total - docFreq + 0.5) / (docFreq + 0.5));
			score +=
				(idf * (freq * (k1 + 1))) /
				(freq + k1 * (1 - b + (b * doc.len) / avgLen));
		}
		if (score <= 0) continue;

		const headTokens = new Set(
			tokenize(`${doc.chunk.title} ${doc.chunk.heading}`),
		);
		let boost = 1;
		for (const token of qTokens) {
			if (headTokens.has(token)) boost += 0.08;
		}
		scored.push({ ...doc.chunk, score: score * boost });
	}

	scored.sort((a, b) => b.score - a.score);

	const topScore = scored[0]?.score ?? 0;
	const floor = Math.max(2.5, topScore * 0.28);

	const perPost = new Map<string, number>();
	const picked: KbHit[] = [];
	for (const hit of scored) {
		if (hit.score < floor) break;
		const used = perPost.get(hit.url) ?? 0;
		if (used >= 2) continue;
		perPost.set(hit.url, used + 1);
		picked.push(hit);
		if (picked.length >= limit) break;
	}

	return picked;
}

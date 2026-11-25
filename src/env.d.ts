/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
	readonly UMAMI_API_KEY?: string;
	readonly LLM_API_KEY?: string;
	readonly LLM_BASE_URL?: string;
	readonly LLM_MODEL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

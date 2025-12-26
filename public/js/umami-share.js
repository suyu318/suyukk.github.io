((global) => {
	const cacheKey = "umami-share-cache";
	const shareCacheKey = "umami-share-token-cache";
	const cacheTTL = 3600_000; // 1h
	const tokenCacheTTL = 300_000; // 5分钟，因为token有时效性

	/**
	 * 从分享链接获取Umami的x-umami-share-token
	 * @param {string} shareUrl - Umami分享链接
	 * @returns {Promise<string>} x-umami-share-token
	 */
	async function getShareToken(shareUrl) {
		// 检查token缓存
		const cached = localStorage.getItem(shareCacheKey);
		if (cached) {
			try {
				const parsed = JSON.parse(cached);
				if (Date.now() - parsed.timestamp < tokenCacheTTL) {
					return parsed.token;
				}
			} catch {
				localStorage.removeItem(shareCacheKey);
			}
		}

		// 从分享URL中提取shareId
		const match = shareUrl.match(/\/share\/([^\/\?#]+)/);
		if (!match) {
			throw new Error("无法从分享链接中提取shareId");
		}
		const shareId = match[1];
		
		// 构建API URL
		const baseUrl = shareUrl.replace(/\/share\/.*$/, '');
		const apiShareUrl = `${baseUrl}/api/share/${shareId}`;

		const res = await fetch(apiShareUrl);
		if (!res.ok) {
			throw new Error(`获取分享信息失败: ${res.status} ${res.statusText}`);
		}

		const data = await res.json();
		const token = data.token;
		
		if (!token) {
			throw new Error("未能从响应中获取token");
		}

		// 缓存token
		localStorage.setItem(
			shareCacheKey,
			JSON.stringify({ timestamp: Date.now(), token: token }),
		);

		return token;
	}

	/**
	 * 通过分享链接获取网站统计数据
	 * @param {string} shareUrl - Umami分享链接
	 * @param {string} websiteId - 网站ID
	 * @returns {Promise<object>} 网站统计数据
	 */
	async function fetchWebsiteStatsFromShare(shareUrl, websiteId) {
		// 检查缓存
		const cached = localStorage.getItem(cacheKey);
		if (cached) {
			try {
				const parsed = JSON.parse(cached);
				if (Date.now() - parsed.timestamp < cacheTTL) {
					return parsed.value;
				}
			} catch {
				localStorage.removeItem(cacheKey);
			}
		}

		const token = await getShareToken(shareUrl);
		
		// 构建stats API URL
		const baseUrl = shareUrl.replace(/\/share\/.*$/, '');
		const currentTimestamp = Date.now();
		// 使用当前时间减去一天作为开始时间，以获取最近的数据
		const startAt = currentTimestamp - 24 * 60 * 60 * 1000; // 24小时前
		const statsUrl = `${baseUrl}/api/websites/${websiteId}/stats?startAt=${startAt}&endAt=${currentTimestamp}&unit=hour&timezone=Asia%2FShanghai`;
		
		const res = await fetch(statsUrl, {
			headers: {
				'x-umami-share-token': token,
			},
		});

		if (!res.ok) {
			throw new Error(`获取网站统计数据失败: ${res.status} ${res.statusText}`);
		}

		const stats = await res.json();

		// 缓存结果
		localStorage.setItem(
			cacheKey,
			JSON.stringify({ timestamp: Date.now(), value: stats }),
		);

		return stats;
	}

	/**
	 * 通过分享链接获取特定页面的统计数据
	 * @param {string} shareUrl - Umami分享链接
	 * @param {string} websiteId - 网站ID
	 * @param {string} path - 页面路径
	 * @returns {Promise<object>} 页面统计数据
	 */
	async function fetchPageStatsFromShare(shareUrl, websiteId, path) {
		const token = await getShareToken(shareUrl);
		
		// 构建stats API URL，用于获取特定页面的数据
		const baseUrl = shareUrl.replace(/\/share\/.*$/, '');
		const currentTimestamp = Date.now();
		// 使用当前时间减去一天作为开始时间，以获取最近的数据
		const startAt = currentTimestamp - 24 * 60 * 60 * 1000; // 24小时前
		const statsUrl = `${baseUrl}/api/websites/${websiteId}/metrics?type=path&startAt=${startAt}&endAt=${currentTimestamp}&limit=100`;
		
		const res = await fetch(statsUrl, {
			headers: {
				'x-umami-share-token': token,
			},
		});

		if (!res.ok) {
			throw new Error(`获取页面统计数据失败: ${res.status} ${res.statusText}`);
		}

		const stats = await res.json();
		
		// 查找匹配的页面路径，需要处理路径匹配逻辑
		let pageStat = stats.find(stat => stat.x === path);
		
		// 如果没有精确匹配，尝试匹配文章路径（处理可能的路径格式差异）
		if (!pageStat) {
			// 检查路径是否以/posts/开头，如果是，也尝试匹配不带查询参数的版本
			if (path.startsWith('/posts/')) {
				pageStat = stats.find(stat => {
					// 比较路径，忽略查询参数
					const statPathWithoutQuery = stat.x.split('?')[0];
					const targetPathWithoutQuery = path.split('?')[0];
					return statPathWithoutQuery === targetPathWithoutQuery;
				});
			}
		}
		
		if (pageStat) {
			return {
				pageviews: pageStat.y, // 访问次数
				visitors: pageStat.visitors || pageStat.y // 如果没有单独的访客数，使用访问次数作为近似值
			};
		} else {
			// 如果没有找到匹配的页面，返回0值
			return {
				pageviews: 0,
				visitors: 0
			};
		}
	}

	/**
	 * 获取网站统计数据
	 * @param {string} baseUrl - Umami Cloud API基础URL
	 * @param {string} apiKey - API密钥
	 * @param {string} websiteId - 网站ID
	 * @returns {Promise<object>} 网站统计数据
	 */
	async function fetchWebsiteStats(baseUrl, apiKey, websiteId) {
		// 检查缓存
		const cached = localStorage.getItem(cacheKey);
		if (cached) {
			try {
				const parsed = JSON.parse(cached);
				if (Date.now() - parsed.timestamp < cacheTTL) {
					return parsed.value;
				}
			} catch {
				localStorage.removeItem(cacheKey);
			}
		}

		const currentTimestamp = Date.now();
		const statsUrl = `${baseUrl}/v1/websites/${websiteId}/stats?startAt=0&endAt=${currentTimestamp}`;

		const res = await fetch(statsUrl, {
			headers: {
				"x-umami-api-key": apiKey,
			},
		});

		if (!res.ok) {
			throw new Error("获取网站统计数据失败");
		}

		const stats = await res.json();

		// 缓存结果
		localStorage.setItem(
			cacheKey,
			JSON.stringify({ timestamp: Date.now(), value: stats }),
		);

		return stats;
	}

	/**
	 * 获取特定页面的统计数据
	 * @param {string} baseUrl - Umami Cloud API基础URL
	 * @param {string} apiKey - API密钥
	 * @param {string} websiteId - 网站ID
	 * @param {string} urlPath - 页面路径
	 * @param {number} startAt - 开始时间戳
	 * @param {number} endAt - 结束时间戳
	 * @returns {Promise<object>} 页面统计数据
	 */
	async function fetchPageStats(
		baseUrl,
		apiKey,
		websiteId,
		urlPath,
		startAt = 0,
		endAt = Date.now(),
	) {
		const statsUrl = `${baseUrl}/v1/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}&path=${encodeURIComponent(urlPath)}`;

		const res = await fetch(statsUrl, {
			headers: {
				"x-umami-api-key": apiKey,
			},
		});

		if (!res.ok) {
			throw new Error("获取页面统计数据失败");
		}

		return await res.json();
	}

	/**
	 * 获取 Umami 网站统计数据
	 * @param {string} baseUrl - Umami Cloud API基础URL
	 * @param {string} apiKey - API密钥
	 * @param {string} websiteId - 网站ID
	 * @returns {Promise<object>} 网站统计数据
	 */
	global.getUmamiWebsiteStats = async (baseUrl, apiKey, websiteId) => {
		try {
			return await fetchWebsiteStats(baseUrl, apiKey, websiteId);
		} catch (err) {
			throw new Error(`获取Umami统计数据失败: ${err.message}`);
		}
	};

	/**
	 * 获取特定页面的 Umami 统计数据
	 * @param {string} baseUrl - Umami Cloud API基础URL
	 * @param {string} apiKey - API密钥
	 * @param {string} websiteId - 网站ID
	 * @param {string} urlPath - 页面路径
	 * @param {number} startAt - 开始时间戳（可选）
	 * @param {number} endAt - 结束时间戳（可选）
	 * @returns {Promise<object>} 页面统计数据
	 */
	global.getUmamiPageStats = async (
		baseUrl,
		apiKey,
		websiteId,
		urlPath,
		startAt,
		endAt,
	) => {
		try {
			return await fetchPageStats(
				baseUrl,
				apiKey,
				websiteId,
				urlPath,
				startAt,
				endAt,
			);
		} catch (err) {
			throw new Error(`获取Umami页面统计数据失败: ${err.message}`);
		}
	};

	global.clearUmamiShareCache = () => {
		localStorage.removeItem(cacheKey);
	};
	
	/**
	 * 通过分享链接获取Umami统计数据
	 * @param {string} shareUrl - Umami分享链接
	 * @param {string} websiteId - 网站ID
	 * @returns {Promise<object>} 网站统计数据
	 */
	global.getUmamiWebsiteStatsFromShare = async (shareUrl, websiteId) => {
		try {
			return await fetchWebsiteStatsFromShare(shareUrl, websiteId);
		} catch (err) {
			throw new Error(`通过分享链接获取Umami统计数据失败: ${err.message}`);
		}
	};

	/**
	 * 通过分享链接获取特定页面的Umami统计数据
	 * @param {string} shareUrl - Umami分享链接
	 * @param {string} websiteId - 网站ID
	 * @param {string} path - 页面路径
	 * @returns {Promise<object>} 页面统计数据
	 */
	global.getUmamiPageStatsFromShare = async (shareUrl, websiteId, path) => {
		try {
			return await fetchPageStatsFromShare(shareUrl, websiteId, path);
		} catch (err) {
			throw new Error(`通过分享链接获取页面统计数据失败: ${err.message}`);
		}
	};

	/**
	 * 获取分享token
	 * @param {string} shareUrl - Umami分享链接
	 * @returns {Promise<string>} x-umami-share-token
	 */
	global.getUmamiShareToken = async (shareUrl) => {
		try {
			return await getShareToken(shareUrl);
		} catch (err) {
			throw new Error(`获取分享token失败: ${err.message}`);
		}
	};
})(window);

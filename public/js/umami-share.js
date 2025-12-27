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
		const startAt = 0;
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
		const startAt = 0;

		// 优先使用 stats 接口并按 url 过滤，能拿到 pageviews / visitors
		// 不同 Umami 版本对 url 的含义可能不同（pathname vs 完整URL），所以两种都尝试
		const urlCandidates = [path];
		try {
			if (typeof window !== 'undefined' && window.location && window.location.origin) {
				urlCandidates.push(`${window.location.origin}${path}`);
			}
		} catch {
			// noop
		}

		async function fetchStatsByUrl(urlValue) {
			const statsUrl = `${baseUrl}/api/websites/${websiteId}/stats?startAt=${startAt}&endAt=${currentTimestamp}&url=${encodeURIComponent(urlValue)}`;
			const statsRes = await fetch(statsUrl, {
				headers: {
					'x-umami-share-token': token,
				},
			});
			if (!statsRes.ok) return null;
			return await statsRes.json();
		}

		// 获取不带过滤的全站 stats，用于判断后端是否忽略 url 参数
		async function fetchUnfilteredStats() {
			const unfilteredUrl = `${baseUrl}/api/websites/${websiteId}/stats?startAt=${startAt}&endAt=${currentTimestamp}`;
			const res = await fetch(unfilteredUrl, {
				headers: {
					'x-umami-share-token': token,
				},
			});
			if (!res.ok) return null;
			return await res.json();
		}

		let unfilteredStats = null;
		for (const urlValue of urlCandidates) {
			const stats = await fetchStatsByUrl(urlValue);
			if (!stats) continue;

			// 某些 Umami 版本会忽略 url 过滤，直接返回全站 stats，导致每篇文章都显示同一组值
			if (path !== '/') {
				if (!unfilteredStats) {
					unfilteredStats = await fetchUnfilteredStats();
				}
				if (
					unfilteredStats &&
					(stats.pageviews || 0) === (unfilteredStats.pageviews || 0) &&
					(stats.visitors || 0) === (unfilteredStats.visitors || 0)
				) {
					// 看起来是被忽略了过滤条件，继续尝试下一个 urlCandidate
					continue;
				}
			}

			return {
				pageviews: stats.pageviews || 0,
				visitors: typeof stats.visitors === "number" ? stats.visitors : null,
			};
		}
		
		// 尝试使用不同的API端点来获取特定页面的数据
		// 首先尝试使用metrics API获取路径数据
		let metricsUrl = `${baseUrl}/api/websites/${websiteId}/metrics?type=path&startAt=${startAt}&endAt=${currentTimestamp}&limit=100`;
		
		const res = await fetch(metricsUrl, {
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
		
		// 如果还是没找到，尝试使用 pageviews API 直接获取特定路径的数据
		if (!pageStat) {
			for (const urlValue of urlCandidates) {
				const pageviewsUrl = `${baseUrl}/api/websites/${websiteId}/pageviews?startAt=${startAt}&endAt=${currentTimestamp}&url=${encodeURIComponent(urlValue)}`;
				const pageviewsRes = await fetch(pageviewsUrl, {
					headers: {
						'x-umami-share-token': token,
					},
				});
				
				if (pageviewsRes.ok) {
					const pageviewsData = await pageviewsRes.json();
					return {
						pageviews: pageviewsData.count || 0,
						// share 权限/不同版本下经常拿不到 per-page visitors，避免误用全站 visitors
						visitors: typeof pageviewsData.visitors === "number" ? pageviewsData.visitors : null
					};
				}
			}
		}
		
		if (pageStat) {
			return {
				pageviews: pageStat.y || pageStat.count || 0, // 访问次数，不同API可能返回不同的字段名
				visitors: typeof pageStat.visitors === "number" ? pageStat.visitors : null // 访客数
			};
		} else {
			// 如果没有找到匹配的页面，返回0值
			return {
				pageviews: 0,
				visitors: null
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

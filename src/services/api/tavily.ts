/**
 * Tavily 联网搜索客户端。
 *
 * 兼容接口本身没有搜索能力，这里在本地调用 Tavily，把结果作为工具返回值交给模型。
 * 文档：https://docs.tavily.com/documentation/api-reference/endpoint/search
 */

import { ApiError, request } from './client.js'
import type { WebSearchResult } from './types.js'

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'
/** 一次最多返回的结果条数 */
const MAX_RESULTS = 5

/** Tavily 的原始返回，只取用到的字段 */
type TavilyResponse = {
  results?: {
    title?: string
    url?: string
    content?: string
    score?: number
    published_date?: string
  }[]
}

/** 从 URL 取出站点名，作为来源卡片上显示的文字 */
const siteNameOf = (url: string): string | null => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

/**
 * 搜索并转换成应用内的结果结构，展示层可以直接复用。
 * 请求失败时抛出 ApiError，由调用方决定是报错还是按「无结果」处理。
 */
export const searchWithTavily = async (
  apiKey: string,
  query: string,
  signal: AbortSignal
): Promise<WebSearchResult[]> => {
  const response = await request(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: MAX_RESULTS,
      // 带上网页正文摘要，模型回答时能引用具体内容
      include_answer: false,
      search_depth: 'basic',
    }),
    signal,
  })
  let payload: TavilyResponse
  try {
    payload = (await response.json()) as TavilyResponse
  } catch {
    throw new ApiError('protocol', '')
  }
  return (payload.results ?? [])
    .filter((item) => item.url)
    .map(
      (item): WebSearchResult => ({
        type: 'web_search_result',
        title: item.title?.trim() || item.url || '',
        url: item.url ?? '',
        snippet: item.content?.trim() || '',
        site_icon: null,
        site_name: siteNameOf(item.url ?? ''),
        encrypted_content: '',
        page_age: item.published_date ?? null,
      })
    )
}

/** 把搜索结果拼成给模型看的文本 */
export const formatSearchResults = (query: string, results: WebSearchResult[]): string => {
  if (results.length === 0) {
    return `搜索「${query}」没有找到相关结果。`
  }
  const body = results
    .map((item, index) => `${index + 1}. [${item.title}](${item.url})\n${item.snippet}`)
    .join('\n\n')
  return `搜索「${query}」的结果：\n\n${body}`
}

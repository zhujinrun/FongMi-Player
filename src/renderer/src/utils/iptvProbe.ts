/**
 * 直播频道可用性探测 + 本机缓存。
 *
 * 原来的 checkChannel() 用 axios GET 整个地址来算耗时，只适合点播文件：
 * 这批源里 80% 是 live.ottiptv.cc 的 FLV 转发流，永远不结束，每条都要卡满
 * 60s axios 超时才被判失败，测一遍要几个小时，而且结论全是「死」。
 *
 * 这里换成「GET 后只读第一块就 abort」：首字节到达即说明台是活的，
 * 与整条流有多长无关。同时把结果按 URL 记在本机，列表过滤时直接查，
 * 不必每次进页面重测。
 */

export type ProbeResult = {
  ok: boolean;
  /** 首字节耗时，失败时为耗时上限 */
  ms: number;
  ts: number;
  /** 失败原因：http-404 / timeout / network / empty / html，协议不支持时是 unsupported */
  reason?: string;
};

export type ProbeProgress = {
  done: number;
  total: number;
  dead: number;
  alive: number;
};

const CACHE_KEY = 'fengmi.iptv.probe.v1';
const DEFAULT_TIMEOUT = 6000;
const DEFAULT_CONCURRENCY = 8;
/** 同一台主机连续几条都连不上，就认定整台机器不通，剩下的不再逐条等超时 */
const HOST_FAIL_THRESHOLD = 3;

let cache: Record<string, ProbeResult> | null = null;

const loadCache = (): Record<string, ProbeResult> => {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('[iptv-probe][cache][read-fail]', err);
    cache = {};
  }
  return cache as Record<string, ProbeResult>;
};

const persistCache = () => {
  if (!cache) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    // 配额满或序列化失败都不该影响体检本身，最差只是下次要重测
    console.warn('[iptv-probe][cache][write-fail]', err);
  }
};

/** 只有 http(s) 才谈得上「能不能播」，rtmp 之类一律视为未知，不参与过滤 */
export const isProbeable = (url?: string) => !!url && /^https?:\/\//i.test(url.trim());

export const getProbe = (url?: string): ProbeResult | undefined => {
  if (!url) return undefined;
  return loadCache()[url.trim()];
};

/**
 * 明确判定为不可用的才算死。没测过的返回 false，
 * 否则刚打开「只显示可播放」还没体检时列表会直接空掉。
 */
export const isDeadChannel = (url?: string) => getProbe(url)?.ok === false;

export const probeCacheSize = () => Object.keys(loadCache()).length;

/** 探测单条频道：拿到第一块数据即断开，只判定「有没有东西回来」 */
export const probeChannel = async (url: string, timeout = DEFAULT_TIMEOUT): Promise<ProbeResult> => {
  const target = (url || '').trim();
  const startedAt = Date.now();
  if (!isProbeable(target)) {
    return { ok: true, ms: 0, ts: Date.now(), reason: 'unsupported' };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(target, {
      signal: controller.signal,
      // 只要开头一小段：播放列表整份都很小，FLV 是无限流必须截断
      headers: { Range: 'bytes=0-32767' },
    });
    const ms = Date.now() - startedAt;

    if (!response.ok) {
      return { ok: false, ms, ts: Date.now(), reason: `http-${response.status}` };
    }

    const reader = response.body?.getReader();
    if (!reader) return { ok: false, ms, ts: Date.now(), reason: 'empty' };

    const chunk = (await reader.read()).value;
    controller.abort();
    if (!chunk || !chunk.length) {
      return { ok: false, ms: Date.now() - startedAt, ts: Date.now(), reason: 'empty' };
    }

    // 200 但吐 HTML 的「假活」很常见：nginx 默认页、门户首页、失效跳转
    const head = new TextDecoder('utf-8').decode(chunk.slice(0, 300)).toLowerCase();
    if (head.includes('<!doctype html') || head.includes('<html')) {
      return { ok: false, ms, ts: Date.now(), reason: 'html' };
    }

    return { ok: true, ms: Date.now() - startedAt, ts: Date.now() };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      ts: Date.now(),
      reason: timedOut ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 批量探测。同一 URL 只测一次；worker 池限并发，避免把源站打崩或占满连接数。
 * onProgress 每完成一条就回调一次，用来驱动界面上的进度。
 *
 * 整组死源是常态：同一台机器上的几十个频道一起连不上。这里只对「连不上」
 * 做主机级短路——同 host 连续失败到阈值后，剩余地址直接判死，不再逐条
 * 等满超时（28 条同机死源从 28×8s 降到 3×8s）。4xx/5xx 不短路：主机活着，
 * 只是这个地址没了，不能连坐整台机器。
 */
export const probeChannels = async (
  urls: string[],
  options: {
    concurrency?: number;
    timeout?: number;
    onProgress?: (progress: ProbeProgress) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<Record<string, ProbeResult>> => {
  const { concurrency = DEFAULT_CONCURRENCY, timeout = DEFAULT_TIMEOUT, onProgress, shouldStop } = options;

  const targets = Array.from(new Set(urls.filter(isProbeable).map((url) => url.trim())));
  const result: Record<string, ProbeResult> = {};
  const hostFails = new Map<string, number>();
  const deadHosts = new Set<string>();
  let cursor = 0;
  let done = 0;
  let dead = 0;

  const report = () => onProgress?.({ done, total: targets.length, dead, alive: done - dead });

  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  };

  const worker = async () => {
    while (cursor < targets.length) {
      if (shouldStop?.()) return;
      const url = targets[cursor];
      cursor += 1;

      const host = hostOf(url);
      // 整台机器都不通，剩下的不必再逐条等满超时
      if (host && deadHosts.has(host)) {
        result[url] = { ok: false, ms: 0, ts: Date.now(), reason: 'host-down' };
        done += 1;
        dead += 1;
        report();
        continue;
      }

      const item = await probeChannel(url, timeout);
      result[url] = item;
      done += 1;
      if (!item.ok) {
        dead += 1;
        // 只有「连不上」才可能是整机问题；4xx/5xx 说明主机活着，只是这个地址没了
        if (host && (item.reason === 'timeout' || item.reason === 'network')) {
          const fails = (hostFails.get(host) || 0) + 1;
          hostFails.set(host, fails);
          if (fails >= HOST_FAIL_THRESHOLD) deadHosts.add(host);
        }
      }
      report();
    }
  };

  const workerCount = Math.min(concurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return result;
};

/** 体检结果并入本机缓存；同一 URL 以最新一次为准 */
export const mergeProbeCache = (entries: Record<string, ProbeResult>) => {
  Object.assign(loadCache(), entries);
  persistCache();
};

export const clearProbeCache = () => {
  cache = {};
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (err) {
    console.warn('[iptv-probe][cache][clear-fail]', err);
  }
};

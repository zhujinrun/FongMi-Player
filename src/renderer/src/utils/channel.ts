import { nanoid } from 'nanoid';
import has from 'lodash/has';
import isString from 'lodash/isString';

import request from '@/utils/request';

let controller = new AbortController();

const m3u = (text: string) => {
  const GROUP = /.*group-title="(.?|.+?)".*/i;
  const LOGO = /.*tvg-logo="(.?|.+?)".*/i;
  const NAME = /.*,(.+?)(?:$|\n|\s)/i;

  const docs: any[] = [];
  let doc: { name?: any; logo?: any; group?: any; url?: any };
  const splitList = text.split('\n');
  splitList.forEach((line: string) => {
    if (line.startsWith('#EXTINF:')) {
      doc = {}; // 切断指针的联系
      doc.name = line.match(NAME) ? line.match(NAME)![1]?.trim() : '';
      doc.logo = line.match(LOGO) ? line.match(LOGO)![1]?.trim() : '';
      doc.group = line.match(GROUP) ? line.match(GROUP)![1]?.trim() : '';
    } else if (line.indexOf('://') > -1) {
      if (line.startsWith('#EXT-X-SUB-URL')) return; // #EXT-X-SUB-URL https://ghproxy.com/https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u
      if (line.startsWith('#EXTM3U')) return; // #EXTM3U url-tvg="http://epg.51zmt.top:8000/e.xml,https://epg.112114.xyz/pp.xml
      doc.url = line?.trim();
      docs.push(doc);
    }
  });
  return docs;
};

const txt = (text: string) => {
  const docs: any[] = [];
  let group: any;
  const splitList = text.split('\n');
  splitList.forEach((line: string) => {
    const split = line.split(',');
    if (split.length < 2) return;
    if (line.indexOf('#genre#') > -1) [group] = split;
    if (split[1].indexOf('://') > -1) {
      const doc = {
        name: split[0]?.trim(),
        url: split[1]?.trim(),
        group: group?.trim(),
      };
      docs.push(doc);
    }
  });
  return docs;
};

type SourceType = 'local' | 'remote' | 'batches' | 'tvbox';

/** 一个列表文本，按首行嗅探格式：TVBox 的 lives.type 不可靠（饭太硬全标 0 实际是 m3u） */
const parseList = (text: string) => {
  const body = String(text ?? '').trim();
  if (!body) return [];
  return body.startsWith('#EXTM3U') ? m3u(body) : txt(body);
};

/** 走主进程拉原始字节：渲染进程改不了 User-Agent，而且部分源站只有 IPv4 能通 */
const fetchBinary = async (url: string, ua = ''): Promise<Uint8Array> => {
  const res = await window.electron.ipcRenderer.invoke('iptv-fetch', url, ua);
  if (!res || !res.status) throw new Error(`fetch failed: ${url}`);
  if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${url}`);
  const binary = atob(res.body);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
};

const fetchText = async (url: string, ua?: string) => new TextDecoder('utf-8').decode(await fetchBinary(url, ua || ''));

/**
 * TVBox 配置正文有两种形态：纯 JSON，或「JPEG 占位图 + FFD9 之后的 base64」（饭太硬
 * 的 /tv 就是这样，浏览器看到的是一张图）。配置里还常带 // 注释掉的条目，标准 JSON
 * 解析器会在这里失败，TVBox 自己用 fastjson 所以容忍。
 */
const tvboxConfigFromText = (raw: string) => {
  const tryJson = (s: string) => {
    const start = s.indexOf('{');
    if (start < 0) return null;
    const body = s
      .slice(start)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = tryJson(raw);
  if (direct) return direct;

  // JPEG 与 base64 之间可能夹着分隔符（饭太硬是两个 *），atob 遇到就抛，所以要清洗而不是校验
  const compact = raw.replace(/[^A-Za-z0-9+/=]/g, '');
  if (compact.length < 16) return null;
  const padded = compact + '='.repeat((4 - (compact.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return tryJson(new TextDecoder('utf-8').decode(bytes));
  } catch {
    return null;
  }
};

const tvboxConfigFromBuffer = (bytes: Uint8Array) => {
  // 从尾部找最后一个 FFD9，它后面就是 base64 配置
  let imageEnd = -1;
  for (let i = bytes.length - 2; i >= 0; i -= 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      imageEnd = i + 2;
      break;
    }
  }
  if (imageEnd > 0 && imageEnd < bytes.length) {
    const tail = new TextDecoder('ascii').decode(bytes.subarray(imageEnd)).trim();
    const fromTail = tail ? tvboxConfigFromText(tail) : null;
    if (fromTail) return fromTail;
  }
  return tvboxConfigFromText(new TextDecoder('utf-8').decode(bytes));
};

/** TVBox 配置 → 内嵌 lives 逐条拉取，替代「把整个配置当频道列表解析」得到 0 条 */
const tvboxChannels = async (path: string) => {
  const config = tvboxConfigFromBuffer(await fetchBinary(path));
  const lives = Array.isArray(config?.lives) ? config.lives : [];
  if (lives.length === 0) throw new Error('not a tvbox config: no lives');

  const docs: any[] = [];
  for (const live of lives) {
    const url = String(live?.url ?? '').trim();
    if (!url) continue;
    // type 3 是订阅（还要再解一层，且多半带有效期），127.0.0.1 是 TVBox 自己的本地代理
    if (Number(live?.type) === 3) continue;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) continue;
    try {
      const list = parseList(await fetchText(url, live?.ua));
      // 没写分组的补上源名，否则界面上全落进「未分组」
      list.forEach((doc) => {
        if (!doc.group) doc.group = live?.name;
      });
      docs.push(...list);
    } catch (err) {
      console.warn(`[iptv][tvbox] live 跳过 ${live?.name}: ${err}`);
    }
  }
  // 同一批 m3u 常被多个 live 引用，按 名字+地址 去重
  const seen = new Set<string>();
  const unique = docs.filter((doc) => {
    const key = `${doc.name}|${doc.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 配置能读到但一条频道都取不到（订阅过期 / 全部不可达）时明确报错，别让用户以为加成功了
  if (unique.length === 0) throw new Error('tvbox config has no usable live source');
  return unique;
};

const parseChannel = async (type: SourceType, path: string) => {
  try {
    let channelContent: any[] = [];
    if (type === 'tvbox') {
      channelContent = await tvboxChannels(path);
    } else {
      let fileContent;
      if (type === 'local') {
        await window.electron.ipcRenderer.invoke('read-file', path).then((res) => {
          fileContent = res;
        });
      } else if (type === 'remote') {
        fileContent = await request({
          url: path,
          method: 'GET',
        });
      } else {
        fileContent = path;
      }
      if (fileContent) channelContent = parseList(String(fileContent));
    }

    for (let i = 0; i < channelContent.length; i++) {
      const dataItem = channelContent[i];
      if (has(dataItem, 'id')) {
        // 使用 isString() 检查 dataItem.id 是否为字符串类型
        if (!isString(dataItem.id)) {
          channelContent[i].id = `${channelContent[i].id.id}`;
        }
      } else {
        channelContent[i].id = nanoid();
      }
    }

    return channelContent;
  } catch (err) {
    throw err;
  }
};

const checkChannel = async (url: string) => {
  try {
    const startTime: Date = new Date(); // 记录开始请求的时间
    await request({
      url,
      method: 'GET',
    });
    const endTime: Date = new Date(); // 记录接收到响应的时间
    const delay: number = endTime.getTime() - startTime.getTime(); // 计算延迟
    return delay;
  } catch (err) {
    console.error(err);
    return false;
  }
};

const stopCheckChannel = () => {
  controller.abort();

  controller = new AbortController();
};

/**
 * 获取电子节目单
 * @param {*} url epg阶段单api
 * @param {*} tvg_name 节目名称
 * @param {*} date 日期 2023-01-31
 * @returns 电子节目单列表
 */
const fetchChannelEpg = async (url: string, tvg_name: string, date: string) => {
  try {
    const response = await request({
      url,
      method: 'GET',
      params: {
        ch: tvg_name,
        date: date,
      },
    });
    const epgData = response.epg_data;
    return epgData;
  } catch (err) {
    throw err;
  }
};

export { parseChannel, checkChannel, stopCheckChannel, fetchChannelEpg };

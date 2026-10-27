import Base64 from 'crypto-js/enc-base64';
import Utf8 from 'crypto-js/enc-utf8';
import Md5 from 'crypto-js/md5';
import ip from 'ip';
import JSON5 from 'json5';

import request, { requestComplete } from '@/utils/request';
import { usePlayStore, useSettingStore } from '@/store';

/**
 * 将obj所有key变小写
 * @param obj
 */
function keysToLowerCase(obj) {
  return Object.keys(obj).reduce((result, key) => {
    const newKey = key.toLowerCase();
    result[newKey] = obj[key]; // 如果值也是对象，可以递归调用本函数
    return result;
  }, {});
}

const getConfig = async (url: string, method = 'GET', headers = {}, body = {}) => {
  try {
    const customHeaders = {
      Cookie: 'custom-cookie',
      Origin: 'custom-origin',
      Host: 'custom-host',
      Connection: 'custom-connection',
      'User-Agent': 'custom-ua',
      Referer: 'custom-referer',
      Redirect: 'custom-redirect',
    };
    headers = keysToLowerCase(headers);

    for (const [originalHeader, customHeader] of Object.entries(customHeaders)) {
      let originalHeaderKey = originalHeader.toLowerCase();
      if (headers.hasOwnProperty(originalHeaderKey)) {
        headers[customHeader] = headers[originalHeaderKey];
        delete headers[originalHeaderKey];
      }
    }

    const response = await request({
      url,
      method,
      data: method !== 'GET' ? body : undefined,
      headers: headers || undefined,
    });

    let res;
    try {
      res = JSON5.parse(response);
    } catch (parseError) {
      res = response;
    }

    return res || '';
  } catch (err) {
    throw err;
  }
};

/**
 * 按指定字符集解码字节流。
 * 原先用 iconv-lite，但它整个包 209KB，只为了 getHtml 里的这一次解码 —— 而 getHtml
 * 只被源编辑页调用，tool.ts 却是全站引用的公共模块，于是 iconv 被绑进了首屏。
 * Chromium 的 TextDecoder 自带 gbk/gb18030/big5 等解码表，够用且零成本。
 */
const decodeByCharset = (data: ArrayBuffer | Uint8Array, charset: string) => {
  try {
    return new TextDecoder(charset || 'utf-8').decode(data as ArrayBuffer);
  } catch {
    // 未知编码标签（比如后端写了 'undefined'）时退回 utf-8，避免整次请求直接失败
    return new TextDecoder('utf-8').decode(data as ArrayBuffer);
  }
};

const getHtml = async (url: string, method = 'GET', encode = 'UTF-8', headers = {}, body = {}) => {
  try {
    const customHeaders = {
      Cookie: 'custom-cookie',
      Origin: 'custom-origin',
      Host: 'custom-host',
      Connection: 'custom-connection',
      'User-Agent': 'custom-ua',
      Referer: 'custom-referer',
      Redirect: 'custom-redirect',
    };
    headers = keysToLowerCase(headers);

    for (const [originalHeader, customHeader] of Object.entries(customHeaders)) {
      let originalHeaderKey = originalHeader.toLowerCase();
      if (headers.hasOwnProperty(originalHeaderKey)) {
        headers[customHeader] = headers[originalHeaderKey];
        delete headers[originalHeaderKey];
      }
    }

    const response = await request({
      url,
      method,
      responseType: 'arraybuffer',
      data: method !== 'GET' ? body : undefined,
      headers: headers || undefined,
    });

    const res = decodeByCharset(response, encode); // 后端编码可能是 GBK
    return res || '';
  } catch (err) {
    throw err;
  }
};

const supportedFormats: string[] = [
  'mp4',
  'mkv',
  'flv',
  'm3u8',
  'avi',
  'magnet',
  'mpd',
  'mpd',
  'mp3',
  'm4a',
  'wav',
  'flac',
  'aac',
  'ogg',
  'wma',
];

// 判断媒体类型
const checkMediaType = async (url: string): Promise<string> => {
  if (url && (url.startsWith('http') || url.startsWith('magnet'))) {
    const fileType: any = supportedFormats.find((format) => url.includes(format));
    if (fileType) {
      return fileType;
    } else {
      const getMediaType: any = await getMeadiaType(url);
      return getMediaType;
    }
  } else {
    return ''; // 如果 URL 不以 http 开头，返回 null
  }
};

/**
 * 读首个数据块嗅探真实容器。
 * HEAD 在直播源上普遍不可信：ottiptv 那类 FLV 转发地址对 HEAD 直接回 404，
 * 拿到 content-type: text/plain，类型判定就会落到 unknown → 误用 HLS 内核。
 * 这里改为 GET 后只读第一块就 abort，不会把整条直播流拉下来。
 */
const sniffMediaType = async (url: string, timeout = 6000): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.body) return 'unknown';
    const reader = response.body.getReader();
    const chunk = (await reader.read()).value;
    controller.abort();
    if (!chunk || !chunk.length) return 'unknown';
    // FLV 魔数 "FLV"，比文本判断更可靠
    if (chunk[0] === 0x46 && chunk[1] === 0x4c && chunk[2] === 0x56) return 'flv';
    const head = new TextDecoder('utf-8').decode(chunk.slice(0, 512));
    if (head.includes('#EXTM3U') || head.includes('#EXTINF')) return 'm3u8';
    if (head.includes('ftyp')) return 'mp4';
    if (head.startsWith('ID3')) return 'mp3';
    return 'unknown';
  } catch (_err) {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
};

const getMeadiaType = async (url: string): Promise<string> => {
  let mediaType: string = 'unknown';
  try {
    const response = await requestComplete({
      url,
      method: 'HEAD',
    });
    if (response.status === 200) {
      const contentType = response.headers['content-type'];
      const supportedFormats: Record<string, string> = {
        'video/mp4': 'mp4',
        'video/x-flv': 'flv',
        'video/ogg': 'ogx',
        'application/vnd.apple.mpegurl': 'm3u8',
        'application/x-mpegURL': 'm3u8',
        'application/octet-stream': 'm3u8',
        'video/avi': 'avi',
        'video/x-msvideo': 'avi',
        'video/x-matroska': 'mkv',
        'video/quicktime': 'mov',
        'video/x-ms-wmv': 'wmv',
        'video/3gpp': '3gp',
        'audio/mpeg': 'mp3',
        'audio/wav': 'mav',
        'audio/aac': 'aac',
        'audio/ogg': 'oga',
      };

      for (const format in supportedFormats) {
        if (contentType.includes(format)) {
          mediaType = supportedFormats[format];
        }
      }
      // 200 但 content-type 不认识（常见 text/plain、application/json）也要嗅探
      if (mediaType === 'unknown') mediaType = await sniffMediaType(url);
    } else {
      mediaType = await sniffMediaType(url);
    }
  } catch (err) {
    mediaType = await sniffMediaType(url);
    console.log('[tool][getMeadiaType][head-failed]', err);
  } finally {
    console.log(`媒体播放类型：${mediaType}`);
    return mediaType;
  }
};

const checkUrlIpv6 = async (url: string) => {
  let hostname = new URL(url).hostname;
  if (ip.isV4Format(hostname)) {
    return 'IPv4';
  } else if (ip.isV6Format(hostname)) {
    return 'IPv6';
  } else {
    return 'Unknown';
  }
};

/**
 * 判断直播源是不是「直播」（决定播放器要不要显示进度条）。
 * mediaType 已知时先短路：FLV 是无限流，原先无条件 GET 整包会一直下载到
 * 60s 超时才 reject，点一个台要白等一分钟。
 */
const checkLiveM3U8 = async (url: string, mediaType: string = ''): Promise<boolean> => {
  if (mediaType === 'flv') return true;
  // 已知不是 HLS 的直接按点播处理，不值得为进度条去拉整包
  if (mediaType && mediaType !== 'm3u8' && mediaType !== 'unknown') return false;

  try {
    const response = await request({
      url,
      method: 'GET',
      timeout: 8000,
    });

    const isLiveStream = !(
      response.indexOf('#EXT-X-ENDLIST') !== -1 ||
      (response.indexOf('#EXT-X-PLAYLIST-TYPE') !== -1 &&
        response.match(/#EXT-X-PLAYLIST-TYPE:(.*)/)[1].toUpperCase() === 'VOD') ||
      (response.indexOf('#EXT-X-MEDIA-SEQUENCE') !== -1 &&
        parseInt(response.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1]) === 0)
    );

    return isLiveStream;
  } catch (err) {
    return false;
  }
};

const copyToClipboardApi = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
};

// 深拷贝辅助函数
const dictDeepClone = (obj: any): any => {
  return JSON.parse(JSON.stringify(obj));
};

// 读取localStorage
const getLocalStorage = (key: string): any => {
  const value = localStorage.getItem(key);
  if (value) {
    return JSON.parse(value);
  }
  return null;
};

// 存储localStorage
const setLocalStorage = (key: string, value: any): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

// 读取pinia
const getPinia = (store: string, key: string): any => {
  switch (store) {
    case 'setting':
      const storeSetting = useSettingStore();
      return storeSetting[key] || null;
    case 'play':
      const storePlay = usePlayStore();
      return storePlay[key] || null;
    default:
      return null;
  }
};

const loadExternalResource = (url: string, type: 'css' | 'js' | 'font') => {
  // 检查资源是否已存在
  const isResourceLoaded = () => {
    const selector = type === 'js' ? `script[src="${url}"]` : `link[href="${url}"]`;
    return document.querySelectorAll(selector).length > 0;
  };

  // 如果资源已加载，则直接返回
  if (isResourceLoaded()) {
    console.log(`[tool][loadExternalResource]Resource already loaded:${url}`);
    return Promise.resolve(url); // 如果已加载，直接返回成功的Promise
  }

  return new Promise((resolve, reject) => {
    const createTag = () => {
      let tag;
      switch (type) {
        case 'css':
        case 'font':
          tag = document.createElement('link');
          tag.rel = type === 'css' ? 'stylesheet' : 'preload';
          tag.as = type === 'font' ? 'font' : '';
          break;
        case 'js':
          tag = document.createElement('script');
          break;
        default:
          reject(new Error(`Unsupported resource type: ${type}`));
          return null;
      }
      return tag;
    };

    const tag = createTag();
    if (!tag) return; // 如果类型不支持，前面已reject，这里直接返回

    // 设置资源URL
    if (type === 'js') {
      tag.src = url;
    } else {
      tag.href = url;
    }

    // 加载完成的回调
    const onLoadOrError = (success) => {
      const action = success ? 'loaded' : 'failed';
      console.log(`[tool][loadExternalResource]Resource ${action}:`, url);
      (success ? resolve : reject)(url);
    };

    // 事件监听
    tag.onload = () => onLoadOrError(true);
    tag.onerror = () => onLoadOrError(false);

    // 插入文档
    document.head.appendChild(tag);
  });
};

const encodeBase64 = (str: string) => {
  return Base64.stringify(Utf8.parse(str));
};

const decodeBase64 = (str: string) => {
  return Base64.parse(str).toString(Utf8);
};

const encodeBtoa = (str: string) => {
  return btoa(str);
};

const decodeAtob = (str: string) => {
  return btoa(str);
};

const encodeUnicode = (str: string) => {
  const encodeUnicode = (str: string) => {
    const res: any = [];
    for (var i = 0; i < str.length; i++) {
      res[i] = ('00' + str.charCodeAt(i).toString(16)).slice(-4);
    }
    return '\\u' + res.join('\\u');
  };
  return encodeUnicode(str);
};

const decodeUnicode = (str: string) => {
  function decodeUnicode(str) {
    str = str.replace(/\\/g, '%');
    return unescape(str);
  }
  return decodeUnicode(str);
};

const encodeUrl = (str: string) => {
  return encodeURIComponent(str);
};

const decodeUrl = (str: string) => {
  return decodeURIComponent(str);
};

const encodeMd5 = (str: string) => {
  return Md5(str).toString();
};

const getPublicIp = async () => {
  const urls = ['https://ipv6.icanhazip.com', 'https://ipv4.icanhazip.com'];

  for (const url of urls) {
    try {
      const response = await request({ url, method: 'GET' });
      if (response) return response.trim();
    } catch (err) {
      console.info(`[tool][getPublicIp] Error fetching from ${url}:`, err);
    }
  }

  return null;
};

export {
  getConfig,
  getHtml,
  getPublicIp,
  supportedFormats,
  getMeadiaType,
  checkMediaType,
  checkUrlIpv6,
  checkLiveM3U8,
  copyToClipboardApi,
  dictDeepClone,
  getLocalStorage,
  setLocalStorage,
  getPinia,
  loadExternalResource,
  encodeBase64,
  decodeBase64,
  encodeUnicode,
  decodeUnicode,
  encodeUrl,
  decodeUrl,
  encodeMd5,
  encodeBtoa,
  decodeAtob,
};

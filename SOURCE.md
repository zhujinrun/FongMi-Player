核心结论：当前播放器分成两层数据标准化：

```text
资源站 / IPTV / 网盘
        ↓
Play Store: film / iptv / drive
        ↓
Play.vue 统一取出 URL
        ↓
影视源解析、官方解析、嗅探
        ↓
{ url, mediaType, headers }
        ↓
playerCreate()
        ↓
xgplayer / artplayer / dplayer / nplayer
        ↓
HLS.js / flv.js / Shaka / WebTorrent / 原生 video
```

## 1. 三类播放入口

主播放窗口是 `pages/Play.vue`，根据 Store 中的 `type` 分三种处理：【Play.vue:775-788】

### 影视 `film`

影视列表页最终写入：

```ts
{
  type: 'film',
  data: {
    info: item,
    ext: {
      site: site
    }
  }
}
```

来源于 `Film.vue`：【Film.vue:647-666】

`info` 通常是 CMS 标准影视详情对象：

```ts
{
  vod_id,
  vod_name,
  vod_pic,
  vod_year,
  vod_area,
  vod_content,
  vod_director,
  vod_actor,
  vod_play_from,
  vod_play_url
}
```

不同 CMS 类型会在 `cms.ts` 中被转换成这个统一结构，例如 XML CMS 会将自身字段转换为 `vod_play_from` 和 `vod_play_url`：【cms.ts:717-763】

### IPTV

IPTV 直接把频道对象作为播放信息：

```ts
{
  type: 'iptv',
  data: {
    info: {
      name,
      url,
      ...
    },
    ext: {
      epg,
      skipIpv6,
      logo
    }
  }
}
```

入口在 `Iptv.vue`：【Iptv.vue:263-282】

播放时基本是：

```ts
createPlayer(info.url)
```

不会经过影视解析和嗅探。

### 网盘 / Drive

网盘播放信息类似：

```ts
{
  type: 'drive',
  data: {
    info: {
      name,
      url,
      vod_pic
    },
    ext: {
      files,
      site
    }
  }
}
```

入口在 `Drive.vue`：【Drive.vue:226-252】

播放时同样直接使用 `info.url`，网盘文件切换时调用 `playerNext()`。

另外，`Analyze` 页面和设置页还有一个单独的播放器组件 `components/player/index.vue`，支持：

- `iframe`：直接加载网页播放器
- `player`：使用统一播放器实例

这条路径主要用于解析测试和播放预览，不是影视主播放窗口。【components/player/index.vue:18-56】

---

## 2. 影视源的数据格式

影视源最关键的是这两个字段：

```ts
vod_play_from: '线路A$$$线路B'

vod_play_url:
  '第1集$urlA1#第2集$urlA2$$$第1集$urlB1#第2集$urlB2'
```

含义是：

- `$$$`：不同播放线路之间的分隔符
- `$`：剧集名称和地址之间的分隔符
- `#`：同一线路下不同剧集之间的分隔符

`formatSeason()` 会转换成：

```ts
{
  线路A: [
    '第1集$urlA1',
    '第2集$urlA2'
  ],
  线路B: [
    '第1集$urlB1',
    '第2集$urlB2'
  ]
}
```

具体逻辑在：【film.ts:561-595】

单集播放项最终通过：

```ts
const { index, url } = formatIndex(item)
```

拆成：

```ts
{
  index: '第1集',
  url: 'https://...'
}
```

对应实现：【film.ts:548-552】

所以当前影视播放源的最小单元其实不是对象，而是一个字符串：

```text
剧集名称$播放地址
```

这也是后续支持新格式时需要注意的地方。如果新数据格式中 URL 自身可能包含 `$`，当前 `split('$')` 逻辑就会产生问题。

---

## 3. 播放地址解析流程

影视单集拿到原始 URL 后，会进入 `playHelper()`：【film.ts:193-210】

大致顺序如下：

### 第一层：站点自身解析

如果站点配置了 `site.playUrl`：

```ts
playerUrl = fetchJxJsonPlayUrlHelper(site.playUrl, url)
```

默认按 JSON 结果取：

```json
{
  "url": "https://real-play-url..."
}
```

### 第二层：按站点类型处理

目前支持：

| `site.type` | 类型 | 处理方式 |
|---|---|---|
| `2` | drpy[js0] | 调用 drpy 302 redirect |
| `6` | hipy[t4] | 调接口获取播放地址、脚本和扩展参数 |
| `7` | js[t3] | 执行 t3 规则获取播放地址 |
| `8` | catvod[nodejs] | POST `/play` 获取播放地址 |

资源站类型定义在站点设置中：【site/constants.ts】

### 第三层：官方解析

如果地址属于爱优腾、B站等官方域名，或者当前线路名称命中解析线路标识，就会调用配置的解析接口。

解析配置大致为：

```ts
{
  flag: [],
  name: '解析器名称',
  url: '解析接口',
  type: 0 | 1
}
```

其中：

- `type: 0`：网页型解析
- `type: 1`：JSON 型解析

### 第四层：直接识别媒体类型

如果处理后的地址已经能识别出媒体格式，则直接返回：

```ts
{
  url,
  mediaType,
  isOfficial,
  headers
}
```

### 第五层：兜底嗅探

如果 URL 不是明确媒体地址，则调用嗅探器，最终返回：

```ts
{
  data: '真实播放地址',
  headers: {
    ...
  }
}
```

再被转换为：

```ts
{
  url: snifferResult.data,
  mediaType: checkMediaType(data.url),
  headers: snifferResult.headers
}
```

嗅探器的自定义模式确实支持返回请求头：【sniffer.ts:196-244】

不过目前有一个扩展时需要特别留意的问题：

> `headers` 会从嗅探结果中返回，但主播放流程没有把它传入 `playerCreate()`。

`Play.vue` 当前调用方式只有：

```ts
createPlayer(response.url, response.mediaType)
```

没有传递 `response.headers`。【Play.vue:759-771】

因此，如果未来要支持必须携带 `Referer`、`User-Agent`、Token 或 Cookie 的新格式，需要先扩展播放器参数结构，否则即使解析层拿到了 headers，播放器请求时也用不到。

---

## 4. 当前媒体类型识别

格式声明集中在 `utils/tool.ts`：

```ts
[
  'mp4',
  'mkv',
  'flv',
  'm3u8',
  'avi',
  'magnet',
  'mpd',
  'mp3',
  'm4a',
  'wav',
  'flac',
  'aac',
  'ogg',
  'wma'
]
```

实现位置：【tool.ts:102-133】

当前判断逻辑比较简单：

1. 如果 URL 中包含某个格式字符串，直接返回该格式；
2. 否则发起 `HEAD` 请求；
3. 根据 `Content-Type` 推断格式。

例如：

```text
video/mp4        -> mp4
video/x-flv      -> flv
application/...  -> m3u8
video/x-matroska -> mkv
video/quicktime  -> mov
audio/mpeg       -> mp3
```

HEAD 类型映射在：【tool.ts:135-175】

这里有几个现状：

- 使用 `url.includes(format)`，不是严格检查文件扩展名；
- URL 参数中只要出现 `mp4`，也可能被误判；
- 支持列表中 `mpd` 重复了一次；
- `mov`、`wmv`、`3gp` 等 HEAD 能识别，但后面的播放器映射没有对应实现；
- 非 `http` 和 `magnet` 开头的地址不会被正常识别；
- `file://`、本地路径、部分自定义协议目前不在支持范围内。

---

## 5. 播放器格式映射

统一播放器入口在 `utils/common/player/index.ts`。

当前映射关系是：【player/index.ts:64-82】

```ts
mp3/m4a/wav/flac/aac/ogg/wma -> customMpegts
mp4                         -> customMp4
flv                         -> customFlv
m3u8                        -> customHls
mpd                         -> customDash
magnet                      -> customWebTorrent
其他                         -> customHls
```

当前四种播放器模式：

```text
xgplayer
artplayer
dplayer
nplayer
```

播放器创建时会根据 `mediaType` 设置对应的 `type`，例如：

```ts
{
  url: 'https://...',
  mediaType: 'm3u8'
}
```

最终会变成：

```ts
{
  url: 'https://...',
  type: 'customHls'
}
```

入口实现：【player/index.ts:161-224】

底层公共流实现主要包括：

- `customHls`：HLS.js
- `customFlv`：flv.js
- `customDash`：Shaka Player
- `customWebTorrent`：WebTorrent
- `customMpegts`：mpegts.js

对应实现：【depend.ts:32-114】

---

## 6. 当前真正稳定支持的格式

从“识别层 + 映射层 + 播放器适配层”综合看，目前相对明确的是：

| 格式 | 当前状态 |
|---|---|
| MP4 | 主要依赖原生 video / xgplayer MP4 插件 |
| FLV | 有 flv.js 支持 |
| M3U8 / HLS | 有 HLS.js 支持 |
| MPD / DASH | 有 Shaka 支持 |
| Magnet | 有 WebTorrent 支持，但只查找 MP4/MKV 文件 |
| MP3 等音频 | 映射到了 `customMpegts`，但四个播放器适配器没有完整统一接入，属于需要验证的路径 |
| MKV | 能被识别，但会落入默认 `customHls`，并不是真正的 MKV 播放支持 |
| AVI / MOV / WMV / 3GP | 能部分识别，但没有对应播放适配器 |

最重要的现状是：

> “能识别”不等于“能播放”。

例如 MKV 被 `checkMediaType()` 识别为 `mkv`，但 `mapVideoTypeToPlayerType()` 没有 `mkv` 分支，最终会默认映射成 `customHls`，这通常会导致播放失败。

---

## 7. 后续扩展新视频源时的落点

如果你后面要支持的是“新的资源站数据格式”，优先改这层：

```text
cms.ts / 站点适配器
        ↓
统一转换成 vod_play_from + vod_play_url
```

如果你要支持的是“新的播放协议或文件格式”，至少需要检查这几处：

```text
1. supportedFormats
2. checkMediaType()
3. mapVideoTypeToPlayerType()
4. player/index.ts
5. 各播放器模块的 customType / plugin
6. playerNext()
7. destroy()
8. headers / 请求参数传递
```

建议后续把播放对象从当前的：

```ts
{
  url,
  mediaType,
  isOfficial,
  headers
}
```

逐步扩展为更通用的结构：

```ts
{
  url: string,
  mediaType: string,
  headers?: Record<string, string>,
  referer?: string,
  userAgent?: string,
  type?: 'vod' | 'live' | 'torrent' | 'iframe',
  drm?: object,
  extra?: object
}
```

这样以后支持带请求头、鉴权参数、DRM、分片协议或网盘临时地址时，不需要重新改一整条链路。

目前最值得优先整理的两个问题是：

1. `mediaType` 的识别结果和实际播放器映射不完整；
2. `headers` 已经在解析层产生，但还没有真正进入播放器请求链路。

这两个点会直接影响后续支持 MKV、AVI、带 Referer 的 HLS、带 Token 的 DASH 等新视频源。
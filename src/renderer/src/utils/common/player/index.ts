/*!
 * @module multi-player
 * @brief 多播放器集成方案
 * @author JohnZhu <john.zhujr@gmail.com>
 * @update 2024-07-01
 * @version 0.1.3
 *
 * **ChangeLog说明**:
 * - 2024.5.12:
 *   - 初步实现方法集成[xgplayer|nplayer|dplayer|artplayer]
 * - 2024.5.13:
 *   - 除xgplayer外增加弹幕发送逻辑
 *   - 优化xgplayer兼容性-xgplayer-flv.js替代xgplayer-flv, xgplayer-hls.js替代xgplayer-hls
 * - 2024.5.14:
 *   - 优化公共流逻辑-先检测环境是否支持
 *   - 修复seek方法xgplayer进度跳转失败
 *   - 修复playerNext方法nplayer会退出全屏
 * - 2024.5.15:
 *   - 修复取消监听事件导致组件内监听事件失效-提取为公共方法[时间变动|弹幕发送]
 *   - 修复自定义dplayer的off传入func匹配错误
 * - 2024.5.16:
 *   - 扩展dplayer画中画功能、控制栏弹幕开关
 *   - 调整dplayer参数unlimited为false-解决阻塞主进程问题
 *   - 修复触发playerNext方法在触发playerBarrage方法切换失败-没有赋值dp.options.video.src导致地址一直不变
 * - 2024.5.25:
 *   - 动态异步加载依赖
 *   - 按播放器解耦
 * - 2024.6.1:
 *   - 修复playerNext方法nplayer类型为mp4不生效
 *   - 统一风格-nplayer音量进度条改为垂直|扩展画中画控制栏显示|live模式去进度条
 *   - 统一风格-live模式去除相关弹幕组件[减少内存]
 * - 2024.6.2:
 *   - 修复mpd无法播放问题-类型映射
 *   - 修复xgplayer初始化播放器失败-plugin赋值错误
 *   - 优化mpd播放-使用shaka库替代dash库[dash库经常卡死|反复请求同一分片]
 *   - 修复artplayer弹幕库5.1版本-参数对齐
 *   - 修复nplayer弹幕不滚动-BulletOption中type赋值错误
 *   - 修复dplayer弹幕控制不生效-弹幕开关控制逻辑误删
 * - 2024.6.3:
 *   - 支持mp3|m4a音频-使用MPEG-TS库
 * - 2024.6.4:
 *   - 修复西瓜播放器加载视频错误
 *   - 修复多次创建播放器扩展插件会重复添加-默认参数使用深拷贝
 * - 2024.6.29:
 *   - 修复在live模式下切换下一个报错-需判断弹幕组件库是否加载
 *   - 修复flv数据流切换失败, 始终播放一个视频流
 *   - 统一调用公共逻辑摧毁实例(除西瓜播放器外)
 *   - 去除nplayer控制条调用画中画(遗留多次创建会创建多个dom问题bug)
 * - 2024.6.30:
 *   - 优化记忆音量和倍速(遗留art播放器UI显示不对bug-已提issue)-存储localStorage
 *   - 统一倍速为[0.5, 0.75, 1, 1.25, 1.5, 2]
 * - 2024.7.1:
 *   - 扩展dplayer播放器缺失once方法
 *   - 重写dplayer播放器destroy方法-始终会释放playrate为1的信号
 *
 * ---
 */

import cloneDeep from 'lodash/cloneDeep';
import { checkMediaType, checkLiveM3U8 } from '@/utils/tool';

let playerModulesCache: { [key: string]: any } = {};

const mapVideoTypeToPlayerType = (videoType: string): string | undefined => {
  const audioTypes = ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'wma'];
  if (audioTypes.includes(videoType)) return 'customMpegts';

  switch (videoType) {
    case 'mp4':
      return 'customMp4';
    case 'flv':
      return 'customFlv';
    case 'm3u8':
      return 'customHls';
    case 'mpd':
      return 'customDash';
    case 'magnet':
      return 'customWebTorrent';
    default:
      return 'customHls';
  }
};

const loadPlayerMethod = async (playerMode: string) => {
  if (!playerModulesCache[playerMode]) {
    switch (playerMode) {
      case 'artplayer':
        playerModulesCache[playerMode] = await import('./playerModule/artplayer');
        break;
      case 'dplayer':
        playerModulesCache[playerMode] = await import('./playerModule/dplayer');
        break;
      case 'nplayer':
        playerModulesCache[playerMode] = await import('./playerModule/nplayer');
        break;
      case 'xgplayer':
        playerModulesCache[playerMode] = await import('./playerModule/xgplayer');
        break;
      default:
        throw new Error(`Unknown player mode: ${playerMode}`);
    }
  }
  return playerModulesCache[playerMode];
};

const playerBarrage = async (player: any, playerMode: string, data: any, options: any, id: string) => {
  const { start, mode, color, content, url } = options;
  let comments: any = [];
  let cleanedData: any = [];

  if (playerMode !== 'dplayer') {
    cleanedData = data;
  }

  const playerModule = await loadPlayerMethod(playerMode);
  const { barrge } = playerModule;

  switch (playerMode) {
    case 'xgplayer':
      comments = cleanedData.map((item: any, index: number) => ({
        duration: 5000,
        id: String(index + 1),
        start: item[start] * 1000,
        txt: item[content],
        mode: ['left', 'right'].includes(item[mode]) ? 'scroll' : item[mode],
        color: true,
        style: { color: item[color] },
      }));
      break;
    case 'dplayer':
      comments = data;
      break;
    case 'artplayer':
      comments = cleanedData.map((item: any) => ({
        text: item[content],
        time: parseInt(item[start]),
        color: item[color],
        border: false,
        mode: item[mode] === 'scroll' ? 1 : 0,
      }));
      break;
    case 'nplayer':
      comments = cleanedData.map((item: any) => ({
        color: item[color],
        text: item[content],
        time: parseInt(item[start]),
        type: item[mode] === 'top' || item[mode] === 'bottom' ? item[mode] : 'scroll',
        isMe: false,
        force: true,
      }));
      break;
  }

  if (playerMode !== 'dplayer') {
    comments = comments.concat([]).sort((a, b) => a.time - b.time);
  }

  barrge(player, comments, url, id);
};

const playerCreate = async (
  url: string,
  type: string,
  container: string | Element,
  playerMode: string,
  videoType: string = '',
): Promise<any> => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { create, options } = playerModule;

  // 先定类型再判直播：checkLiveM3U8 需要 mediaType 才能对 FLV 这类无限流短路，
  // 否则会为了判断进度条把整条直播流拉下来（旧顺序正是先 GET 后定类型，点台必卡）
  videoType = videoType || (await checkMediaType(url)) || '';
  const isLive = type === 'iptv' ? await checkLiveM3U8(url, videoType) : false;

  let config = cloneDeep(options);
  if (playerMode === 'xgplayer') {
    config.id = container;
    config.url = url;
    if (isLive) config.isLive = true;
    config.type = mapVideoTypeToPlayerType(videoType);
  } else if (playerMode === 'artplayer') {
    config.container = container;
    config.url = url;
    if (isLive) config.isLive = true;
    config.type = mapVideoTypeToPlayerType(videoType);
  } else if (playerMode === 'dplayer') {
    config.container = container;
    config.video.url = url;
    if (isLive) config.live = true;
    config.video.type = mapVideoTypeToPlayerType(videoType);
  } else if (playerMode === 'nplayer') {
    config.container = container;
    if (isLive) config.live = true;
    config.src = url;
    config.type = mapVideoTypeToPlayerType(videoType);
  }

  return create(config);
};

const playerDestroy = async (player: any, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { destroy } = playerModule;
  if (playerModulesCache[playerMode]) delete playerModulesCache[playerMode];
  return destroy(player);
};

const playerNext = async (player: any, playerMode: string, options: any) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { playNext } = playerModule;
  const { url, mediaType } = options;
  const videoType = mediaType || (await checkMediaType(url)) || '';

  let data = {
    url,
    type: mapVideoTypeToPlayerType(videoType),
  };

  return playNext(player, data);
};

const playerSeek = async (player: any, playerMode: string, time: number) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { seek } = playerModule;
  return seek(player, time);
};

const playerPause = async (player: any, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { pause } = playerModule;
  return pause(player);
};

// 以下五个是快捷键层要用的读写能力。四个内核都导出了同名方法，但
// 「读」的一侧不一致：dplayer 的 volume 是方法而非属性，muted 也要落到
// video 元素上；artplayer/nplayer/xgplayer 都是实例属性。差异只在这里处理，
// 上层（Play.vue）不必知道用的是哪个内核。
// 实例形状按内核而异，用 unknown + 就地断言，避免再引入 any。
type ShortcutPlayerShape = { volume?: number; muted?: boolean; video?: HTMLVideoElement };

const playerToggle = async (player: unknown, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { toggle } = playerModule;
  return toggle(player);
};

const playerCurrentTime = async (player: unknown, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { currentTime } = playerModule;
  return currentTime(player) || 0;
};

const playerDuration = async (player: unknown, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { duration } = playerModule;
  return duration(player) || 0;
};

const playerVolume = async (player: unknown, playerMode: string, value?: number) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { volume } = playerModule;
  if (typeof value === 'number') return volume(player, value);
  const instance = player as ShortcutPlayerShape | null;
  return (playerMode === 'dplayer' ? instance?.video?.volume : instance?.volume) ?? 0;
};

const playerMuted = async (player: unknown, playerMode: string, value?: boolean) => {
  // dplayer 的实例上没有 muted 访问器，真正的声音开关在 video 元素上
  const instance = player as ShortcutPlayerShape | null;
  const target = playerMode === 'dplayer' ? instance?.video : instance;
  if (!target) return false;
  if (typeof value === 'boolean') target.muted = value;
  return !!target.muted;
};

// 倍速阶梯：每个内核自带的档位与顺序都不一样（nplayer 出厂只有 0.25/0.5/1/1.5/2，
// xgplayer 的插件又是另一套顺序），键盘只有先收成一把统一的梯子，才不会
// 「同一个键在不同内核上跳的步长不一样」。nplayer 的菜单档位在 playerModule 里
// 已经被改写成同一套，所以键盘与内核菜单看到的是同一串数字。
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// 读写播放速率。这里**不能**复用各内核模块里的 speed()：
// artplayer 与 xgplayer 的实现是 `once('ready')` / `once(loadeddata')` 里赋值，
// 那是给「创建播放器时恢复上次倍速」用的；播放中途调用时事件早已过去，
// 赋值永远不会发生（键盘按下去毫无反应）。运行时改速率只能直接落到实例上。
type RatePlayerShape = ShortcutPlayerShape & {
  playbackRate?: number;
  settingNamedMap?: { speed?: { value?: number } };
};

const playerPlaybackRate = async (player: unknown, playerMode: string, value?: number) => {
  const instance = player as RatePlayerShape | null;
  if (!instance) return 1;
  // dplayer 的 speed() 就是 `video.playbackRate = rate`，实例上没有该属性
  const target = playerMode === 'dplayer' ? instance.video : instance;
  if (!target) return 1;
  if (typeof value === 'number') {
    target.playbackRate = value;
    // nplayer 的设置菜单只在自己的 change 回调里同步 value，从外部改速率要连菜单值
    // 一起写，否则打开菜单仍停在上一次点选的档位上
    if (playerMode === 'nplayer') {
      const menu = instance.settingNamedMap?.speed;
      if (menu) menu.value = value;
    }
  }
  // 尚未就绪时读到的可能是 0 或 NaN，统一按 1 倍处理
  return Number(target.playbackRate) || 1;
};

const playerTimeUpdate = async (player: any, playerMode: string, callback: any) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { onTimeUpdate } = playerModule;
  return onTimeUpdate(player, callback);
};

const offPlayerBarrage = async (player: any, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { offBarrage } = playerModule;
  return offBarrage(player);
};

const offPlayerTimeUpdate = async (player: any, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { offTimeUpdate } = playerModule;
  return offTimeUpdate(player);
};

const playerOnError = async (player: any, playerMode: string, callback: any) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { onError } = playerModule;
  if (onError) return onError(player, callback);
};

const offPlayerError = async (player: any, playerMode: string) => {
  const playerModule = await loadPlayerMethod(playerMode);
  const { offError } = playerModule;
  if (offError) return offError(player);
};

export {
  playerBarrage,
  playerCreate,
  playerDestroy,
  playerNext,
  playerSeek,
  playerPause,
  playerToggle,
  playerCurrentTime,
  playerDuration,
  playerVolume,
  playerMuted,
  playerPlaybackRate,
  PLAYBACK_RATES,
  playerTimeUpdate,
  playerOnError,
  offPlayerBarrage,
  offPlayerTimeUpdate,
  offPlayerError,
};

export { setStreamErrorNotify } from './playerModule/components';

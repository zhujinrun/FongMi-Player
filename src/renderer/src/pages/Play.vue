<template>
  <div class="container">
    <div class="container-header" :class="!isVisible.macMaximize ? 'drag' : 'no-drag'">
      <div class="left no-drag"
        :style="{ 'padding-left': platform === 'darwin' && !isVisible.macMaximize ? '68px' : '0' }">
        <div class="open-main-win" @click="openMainWinEvent">
          <home-icon />
          <span class="tip-gotomain">{{ $t('pages.player.header.backMain') }}</span>
        </div>
      </div>
      <div class="spacer">
        <span v-if="type === 'film'">{{ `${info["vod_name"]} ${formatIndex(active.filmIndex).index}` }}</span>
        <span v-else>{{ info["name"] }}</span>
      </div>
      <div class="right no-drag">
        <div class="system-functions">
          <div v-if="type === 'film'" class="setting system-function">
            <t-button theme="default" shape="square" variant="text" @click="isSettingVisible = true">
              <setting-icon />
            </t-button>
            <t-dialog v-model:visible="isSettingVisible" :header="$t('pages.player.setting.title')" placement="center"
              width="508" :footer=false>
              <div class="setting-warp">
                <div class="setting-item-warp">
                  <span>{{ $t('pages.player.setting.autoSkip') }}</span>
                  <t-switch v-model="set.skipStartEnd" />
                </div>
                <div v-if="set.skipStartEnd" class="setting-item-warp">
                  <div class="skip-time-in-start">
                    <t-input-number v-model="skipConfig.skipTimeInStart" theme="normal" align="right"
                      @change="skipTimeInEndChange">
                      <template #label>{{ $t('pages.player.setting.skipStart') }}</template>
                      <template #suffix>{{ $t('pages.player.setting.skipSeconds') }}</template>
                    </t-input-number>
                  </div>
                  <div class="skip-time-in-end">
                    <t-input-number v-model="skipConfig.skipTimeInEnd" theme="normal" align="right"
                      @change="skipTimeInEndChange">
                      <template #label>{{ $t('pages.player.setting.skipEnd') }}</template>
                      <template #suffix>{{ $t('pages.player.setting.skipSeconds') }}</template>
                    </t-input-number>
                  </div>
                </div>
                <div class="setting-item-warp">
                  <span>{{ $t('pages.player.setting.autoNext') }}</span>
                  <t-switch v-model="set.preloadNext" />
                </div>
                <div class="setting-item-warp">
                  <span>{{ $t('pages.player.setting.autoPlayNext') }}</span>
                  <t-switch v-model="set.autoNext" />
                </div>
                <div class="setting-item-warp">
                  <span>{{ $t('pages.player.setting.skipAd') }}</span>
                  <t-switch v-model="set.skipAd" />
                </div>
                <div class="tip-warp">
                  <span>{{ $t('pages.player.setting.tip') }}</span>
                </div>
              </div>
            </t-dialog>
          </div>
          <div class="staple system-function">
            <t-button theme="default" shape="square" variant="text" @click="toggleAlwaysOnTop">
              <pin-filled-icon v-if="isVisible.pin" />
              <pin-icon v-else />
            </t-button>
          </div>
        </div>
        <system-control class="mg-left window" />
      </div>
    </div>
    <div class="container-main">
      <div class="player">
        <div class="container-player" :class='["subject", isVisible.aside ? "subject-ext" : ""]'>
          <div class="player-panel">
            <div class="player-media">
              <!-- 全屏容器：把播放器包一层，并让各内核的全屏请求重定向到这里
                   （见 installFullscreenRedirect）。这样全屏后选集面板与错误提示
                   仍在全屏元素内，且不会被内核 destroy 时的 innerHTML = '' 清掉。 -->
              <div ref="fsWrapRef" class="mse-wrap">
                <div id="mse" class="player"></div>
                <div v-show="isVisible.fullscreen && type === 'film'" class="fs-tools">
                  <!-- 面板展开时 dock 要跟着左移，否则会被 300px 宽的面板整个盖住，用户就收不回去了 -->
                  <div :class="['fs-tools-dock', { 'is-open': isVisible.fsPanel }]"
                    @click="isVisible.fsPanel = !isVisible.fsPanel">
                    <chevron-left-icon v-if="isVisible.fsPanel" class="fs-dock-icon" />
                    <chevron-right-icon v-else class="fs-dock-icon" />
                  </div>
                  <div v-show="isVisible.fsPanel" class="fs-panel">
                    <div class="fs-panel-header">
                      <span class="fs-panel-title">{{ $t('pages.player.film.anthology') }}</span>
                      <span class="fs-panel-name nowrap">{{ active.filmIndex }}</span>
                      <close-icon class="fs-panel-close" @click="isVisible.fsPanel = false" />
                    </div>
                    <t-dropdown v-if="lineNames.length > 1" placement="bottom" :max-height="240">
                      <t-button size="small" theme="default" variant="text" auto-width>
                        <span class="fs-panel-line">{{ active.flimSource }}</span>
                        <template #suffix>
                          <chevron-down-icon size="16" />
                        </template>
                      </t-button>
                      <t-dropdown-menu>
                        <t-dropdown-item v-for="key in lineNames" :key="key" :value="key"
                          @click="(options) => switchLineEvent(options.value as string)">
                          <span :class="[key === active.flimSource ? 'active' : '']">{{ key }}</span>
                        </t-dropdown-item>
                      </t-dropdown-menu>
                    </t-dropdown>
                    <div class="fs-panel-list">
                      <div v-for="(item, index) in season?.[active.flimSource]" :key="item"
                        :class='["fs-ep", item === active.filmIndex ? "fs-ep-active" : ""]'
                        @click="fsSelectEpisode(item)">
                        {{ formatReverseOrder(isVisible.reverseOrder ? 'positive' : 'negative', index,
                          season?.[active.flimSource]?.length) }}
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="nextCountdown > 0" class="next-tip">
                  <div class="next-tip-card">
                    <span class="next-tip-title">{{ $t('pages.player.next.tip', [nextCountdown]) }}</span>
                    <div class="next-tip-actions">
                      <t-button theme="primary" size="small" @click="confirmNextPlay">
                        {{ $t('pages.player.next.play') }}
                      </t-button>
                      <t-button theme="default" size="small" variant="outline" @click="cancelNextPlay">
                        {{ $t('pages.player.next.cancel') }}
                      </t-button>
                    </div>
                  </div>
                </div>
                <div v-if="isVisible.playError" class="player-error-mask">
                  <div class="player-error-content">
                    <p class="player-error-msg">{{ playErrorMsg }}</p>
                    <p class="player-error-desc">{{ $t('pages.player.error.desc') }}</p>
                    <t-button theme="primary" variant="outline" @click="retryPlay">
                      {{ $t('pages.player.error.retry') }}
                    </t-button>
                  </div>
                </div>
                <!-- 键盘操作回声：全屏时没有鼠标点击，靠它确认按键确实生效 -->
                <transition name="shortcut-fade">
                  <div v-if="shortcutHint" class="shortcut-hint">{{ shortcutHint }}</div>
                </transition>
                <!-- 快捷键一览：按 ? 打开。放在 .mse-wrap 内，全屏下同样可见 -->
                <div v-if="isVisible.shortcuts" class="shortcut-help" @click.self="isVisible.shortcuts = false">
                  <div class="shortcut-help-card">
                    <div class="shortcut-help-header">
                      <span class="shortcut-help-title">{{ $t('pages.player.shortcut.title') }}</span>
                      <close-icon class="shortcut-help-close" @click="isVisible.shortcuts = false" />
                    </div>
                    <div class="shortcut-help-body">
                      <div v-for="row in shortcutRows" :key="row.keys" class="shortcut-help-row">
                        <span class="shortcut-help-keys">{{ row.keys }}</span>
                        <span class="shortcut-help-desc">{{ row.desc }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="btn-box dock-show" @click="isVisible.aside = !isVisible.aside">
          <chevron-left-icon v-if="isVisible.aside" class="btn-icon" />
          <chevron-right-icon v-else class="btn-icon" />
        </div>
      </div>
      <div class="aside" v-show="!isVisible.aside">
        <div v-if="type == 'iptv'" class="iptv content">
          <div class="title-warp">
            <p class="title nowrap">{{ info["name"] }}</p>
          </div>
          <div class="iptv-main content-main">
            <t-tabs v-model="active.iptvNav" class="iptv-tabs tabs">
              <t-tab-panel value="epg" :label="$t('pages.player.iptv.epg')">
                <div class="contents-wrap scroll-y epg-wrap">
                  <div v-for="(item, index) in iptvConfig.epgData" :key="index" class="content">
                    <div class="content-item content-item-between">
                      <div class="time-warp">{{ item["start"] }}</div>
                      <div class="title-wrap nowrap">{{ item["title"] }}</div>
                      <div class="status-wrap">
                        <span v-if='filterEpgStatus(item["start"], item["end"]) === "played"' class="played">
                          {{ $t(`pages.player.status.${filterEpgStatus(item["start"], item["end"])}`) }}
                        </span>
                        <span v-if='filterEpgStatus(item["start"], item["end"]) === "playing"' class="playing">
                          {{ $t(`pages.player.status.${filterEpgStatus(item["start"], item["end"])}`) }}
                        </span>
                        <span v-if='filterEpgStatus(item["start"], item["end"]) === "unplay"' class="unplay">
                          {{ $t(`pages.player.status.${filterEpgStatus(item["start"], item["end"])}`) }}
                        </span>
                      </div>
                    </div>
                    <t-divider dashed style="margin: 5px 0" />
                  </div>
                </div>
              </t-tab-panel>
              <t-tab-panel value="channel" :label="$t('pages.player.iptv.channel')">
                <div class="contents-wrap scroll-y channel-wrap">
                  <div v-for="item in iptvConfig.channelData" :key='item["id"]' class="content">
                    <div class="content-item content-item-start" @click="changeChannelEvent(item)">
                      <div class="logo-wrap">
                        <t-image class="logo" fit="contain" :src='generateLogo(item)'
                          :style="{ width: '64px', height: '32px', maxHeight: '32px', background: 'none' }" :lazy="true"
                          :loading="renderLoading" :error="renderError">
                        </t-image>
                      </div>
                      <div class="title-wrap nowrap title-warp-channel">{{ item["name"] }}</div>
                      <div class="status-wrap">
                        <span :class='item["id"] === info["id"] ? "playing" : "unplay"'>
                          {{ item["id"] === info["id"] ? $t('pages.player.status.playing') :
                            $t('pages.player.status.unplay') }}
                        </span>
                      </div>
                    </div>
                    <t-divider dashed style="margin: 5px 0" />
                  </div>
                  <infinite-loading style="text-align: center; color: #fdfdfd" :distance="200" @infinite="load">
                    <template #complete>{{ $t('pages.player.infiniteLoading.complete') }}</template>
                    <template #error>{{ $t('pages.player.infiniteLoading.error') }}</template>
                  </infinite-loading>
                </div>
              </t-tab-panel>
            </t-tabs>
          </div>
        </div>
        <div v-if="type == 'film'" class="film content">
          <div v-if="!active.profile" class="contents-wrap">
            <div class="tvg-block">
              <div class="title-album">
                <div class="title-text nowrap">{{ info["vod_name"] }}</div>
                <div class="title-desc" @click="active.profile = true">
                  <span class="title-unfold">{{ $t('pages.player.film.desc') }}</span>
                  <chevron-right-s-icon />
                </div>
              </div>
              <div class="hot-block nowrap">
                <span v-show="scoreText" class="rate">
                  <star-icon />
                  {{ scoreText }}
                </span>
                <t-divider layout="vertical" v-show="scoreText && info['type_name']" />
                <span v-show='info["type_name"]' class="nowrap">{{ info["type_name"] }}</span>
                <t-divider layout="vertical" v-show='info["vod_area"]' />
                <span v-show='info["vod_area"]' class="nowrap">{{ info["vod_area"] }}</span>
                <t-divider layout="vertical" v-show='info["vod_year"]' />
                <span v-show='info["vod_year"]' class="nowrap">{{ info["vod_year"] }}</span>
              </div>
              <div class="function">
                <div class="func-item like" @click="putBinge(false)">
                  <span>
                    <heart-icon class="icon" v-if="isVisible.binge" />
                    <heart-filled-icon class="icon" v-else />
                  </span>
                  <span class="tip">{{ $t('pages.player.film.like') }}</span>
                </div>
                <div class="dot"></div>
                <div class="func-item download" @click="downloadEvent">
                  <download-icon class="icon" />
                  <span class="tip">{{ $t('pages.player.film.download') }}</span>
                </div>
                <div class="dot"></div>
                <div class="func-item share" @click="shareEvent">
                  <share-popup v-model:visible="isVisible.share" :data="shareData">
                    <template #customize>
                      <div style="display: flex;flex-direction: row;align-items: center;">
                        <share-1-icon class="icon" />
                        <span class="tip">{{ $t('pages.player.film.share') }}</span>
                      </div>
                    </template>
                  </share-popup>
                </div>
              </div>
              <dialog-download-view :data="downloadDialogData" v-model:visible="isVisible.download" />
            </div>
            <div class="anthology-contents-scroll">
              <div class="box-anthology-header">
                <div class="left">
                  <h4 class="box-anthology-title">{{ $t('pages.player.film.anthology') }}</h4>
                  <div class="box-anthology-line">
                    <t-dropdown placement="bottom" :max-height="250">
                      <t-button size="small" theme="default" variant="text" auto-width>
                        <span class="title">{{ $t('pages.player.film.line') }}</span>
                        <template #suffix>
                          <chevron-down-icon size="16" />
                        </template>
                      </t-button>
                      <t-dropdown-menu>
                        <t-dropdown-item v-for="(_, key, index) in season" :key="index" :value="key"
                          @click="(options) => switchLineEvent(options.value as string)">
                          <span :class="[key as any === active.flimSource ? 'active' : '']">{{ key }}</span>
                        </t-dropdown-item>
                      </t-dropdown-menu>
                    </t-dropdown>
                  </div>
                  <div class="box-anthology-analyze" v-show="isVisible.official">
                    <t-dropdown placement="bottom" :max-height="250">
                      <t-button size="small" theme="default" variant="text" auto-width>
                        <span class="title">{{ $t('pages.player.film.analyze') }}</span>
                        <template #suffix>
                          <chevron-down-icon size="16" />
                        </template>
                      </t-button>
                      <t-dropdown-menu>
                        <t-dropdown-item v-for="item in dataAnalyze.active" :key="item.id" :value="item.id"
                          @click="(options) => switchAnalyzeEvent(options.value as string)">
                          <span :class="[item.id === active.analyzeId ? 'active' : '']">{{ item.name }}</span>
                        </t-dropdown-item>
                      </t-dropdown-menu>
                    </t-dropdown>
                  </div>
                </div>
                <div class="right">
                  <div class="box-anthology-reverse-order" @click="reverseOrderEvent">
                    <order-descending-icon v-if="isVisible.reverseOrder" size="1.2em" />
                    <order-ascending-icon v-else size="1.2em" />
                  </div>
                </div>
              </div>
              <div class="listbox">
                <div class="tag-container">
                  <div v-for="(item, index) in season?.[active.flimSource]" :key="item"
                    :class='["mainVideo-num", item === active.filmIndex ? "mainVideo-selected" : ""]'
                    @click="changeEvent(item)">
                    <t-tooltip :content="formatName(item)">
                      <div class="mainVideo_inner">
                        {{ formatReverseOrder(isVisible.reverseOrder ? 'positive' : 'negative', index,
                          season?.[active.flimSource]?.length)
                        }}
                        <div class="playing"></div>
                      </div>
                    </t-tooltip>
                  </div>
                </div>
                <!-- <t-tabs v-model="active.flimSource" class="film-tabs">
                  <t-tab-panel v-for="(value, key, index) in season" :key="index" :value="key" :label="key">
                    <div class="tag-container">
                      <div v-for="(item, index) in season?.[active.flimSource]" :key="item"
                        :class='["mainVideo-num", item === active.filmIndex ? "mainVideo-selected" : ""]'
                        @click="changeEvent(item)">
                        {{ index }} {{ item }}
                        <t-tooltip :content="formatName(item)">
                          <div class="mainVideo_inner">
                            {{ formatReverseOrder(isVisible.reverseOrder ? 'positive' : 'negative', index, value.length)
                            }}
                            <div class="playing"></div>
                          </div>
                        </t-tooltip>
                      </div>
                    </div>
                  </t-tab-panel>
                </t-tabs> -->
              </div>
              <div class="recommend" v-show="recommend.length != 0">
                <div class="component-title">{{ $t('pages.player.film.recommend') }}</div>
                <div class="component-list">
                  <div v-for="content in recommend" :key='content["id"]' class="videoItem-card">
                    <div class="videoItem-left" @click="recommendEvent(content)">
                      <t-image class="card-main-item" :src='content["vod_pic"]'
                        :style="{ width: '126px', height: '70px', 'border-radius': '5px' }" :lazy="true" fit="cover">
                      </t-image>
                    </div>
                    <div class="videoItem-right">
                      <div class="title nowrap">{{ content["vod_name"] }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="profile">
            <div class="side-head">
              <div class="title">{{ $t('pages.player.film.desc') }}</div>
              <close-icon size="1.3em" class="icon" @click="active.profile = false" />
            </div>
            <t-divider dashed style="margin: 5px 0" />
            <div class="side-body scroll-y ">
              <div class="card">
                <div class="cover">
                  <t-image class="card-main-item" :src='info["vod_pic"]'
                    :style="{ width: '100%', height: '100%', 'border-radius': '5px' }" :lazy="true" fit="cover" />
                </div>
                <div class="content">
                  <div class="name">{{ info["vod_name"] }}</div>
                  <div class="type">{{ info["type_name"] }}</div>
                  <div class="num">{{ info["vod_remarks"] }}</div>
                </div>
              </div>
              <div class="text">
                <span v-html='formatContent(info["vod_content"])'></span>
              </div>
              <div class="case">
                <div class="title">{{ $t('pages.player.film.actors') }}</div>
                <div class="content">
                  <div v-show='info["vod_director"]'>
                    <span class="name">{{ $t('pages.player.film.director') }}: </span>
                    <span class="role">{{ info["vod_director"] }}</span>
                  </div>
                  <div v-show='info["vod_actor"]'>
                    <span class="name">{{ $t('pages.player.film.actor') }}: </span>
                    <span class="role">{{ info["vod_actor"] }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="type == 'drive'" class="drive content">
          <div class="title-warp">
            <p class="title nowrap">{{ info["name"] }}</p>
          </div>
          <div class="drive-main content-main">
            <t-tabs v-model="active.driveNav" class="drive-tabs tabs">
              <t-tab-panel value="season" :label="$t('pages.player.drive.anthology')">
                <div class="contents-wrap scroll-y drive-wrap">
                  <div v-for="item in driveDataList" :key='item["id"]' class="content">
                    <template v-if='item["type"] === 10'>
                      <div class="content-item content-item-start" @click="changeDriveEvent(item)">
                        <div class="logo-wrap">
                          <t-image class="logo" fit="cover" :src='item["thumb"]'
                            :style="{ width: '64px', height: '28px', background: 'none', borderRadius: '6px' }"
                            :lazy="true" :loading="renderLoading" :error="renderError" />
                        </div>
                        <div class="title-wrap nowrap">{{ item["name"] }}</div>
                        <div class="status-wrap">
                          <span :class='info["name"] === item["name"] ? "playing" : "unplay"'>
                            {{ item["name"] === info["name"] ? $t('pages.player.status.playing') :
                              $t('pages.player.status.unplay') }}
                          </span>
                        </div>
                      </div>
                      <t-divider dashed style="margin: 5px 0" />
                    </template>
                  </div>
                </div>
              </t-tab-panel>
            </t-tabs>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="tsx">
import 'v3-infinite-loading/lib/style.css';
import '@/style/player/index.less';

import find from 'lodash/find';
import has from 'lodash/has';
import isEmpty from 'lodash/isEmpty';
import isEqual from 'lodash/isEqual';
import throttle from 'lodash/throttle';
import unionWith from 'lodash/unionWith';
import moment from 'moment';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronRightSIcon,
  CloseIcon,
  Tv1Icon,
  DownloadIcon,
  HeartIcon,
  HeartFilledIcon,
  HomeIcon,
  LoadingIcon,
  OrderAscendingIcon,
  OrderDescendingIcon,
  PinFilledIcon,
  PinIcon,
  StarIcon,
  SettingIcon,
  Share1Icon
} from 'tdesign-icons-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import InfiniteLoading from 'v3-infinite-loading';
import { computed, onBeforeUnmount, onMounted, ref, reactive, shallowRef, watch } from 'vue';

import { fetchChannelList } from '@/api/iptv';
import { isDeadChannel } from '@/utils/iptvProbe';
import { checkUrlIpv6, getLocalStorage } from '@/utils/tool';
import { playerBarrage, playerCreate, playerDestroy, playerNext, playerSeek, playerPause, playerToggle, playerCurrentTime, playerDuration, playerVolume, playerMuted, playerPlaybackRate, PLAYBACK_RATES, playerTimeUpdate, offPlayerTimeUpdate, offPlayerBarrage, playerOnError, offPlayerError, setStreamErrorNotify } from '@/utils/common/player';
import {
  fetchBingeData,
  putBingeData,
  fetchHistoryData,
  putHistoryData,
  fetchAnalyzeData,
  fetchBarrageData,
  playHelper,
  reverseOrderHelper,
  fetchDoubanRecommendHelper,
  fetchRecommendSearchHelper,
  formatName,
  formatIndex,
  formatContent,
  formatScore,
  formatSeason,
  formatReverseOrder
} from '@/utils/common/film';
import { __jsEvalReturn } from '@/utils/alist_open';
import { fetchChannelEpg } from '@/utils/channel';
import { usePlayStore } from '@/store';

import SystemControl from '@/layouts/components/SystemControl.vue';
import DialogDownloadView from './play/componets/DialogDownload.vue';
import SharePopup from '../components/share-popup/index.vue';
import { t } from '@/locales';
import logoIcon from '@/assets/icon.png';

const remote = window.require('@electron/remote');
const { BrowserWindow } = require('@electron/remote');

const win = remote.getCurrentWindow();
const { platform } = window.electron.process;

// 获取pinia播放数据
const store = usePlayStore();
const type = computed(() => {
  return store.getType;
});
const data = computed(() => {
  return store.getData;
});
const set = computed(() => {
  return store.getSetting;
});
const snifferAnalyze = computed(() => {
  const analyzeSource = active.analyzeId
    ? find(dataAnalyze.value.active, { id: active.analyzeId })
    : dataAnalyze.value.default;

  const data = {
    flag: dataAnalyze.value.flag,
    name: analyzeSource.name,
    url: analyzeSource.url,
    type: analyzeSource.type,
  };
  return data;
});
const info = ref(data.value.info) as any;
const ext = ref(data.value.ext) as any;
// 没有评分时整块（星星 + 数字）都不显示，而不是摆一个 0.0
const scoreText = computed(() => formatScore(info.value?.vod_score));

const downloadDialogData = ref({ season: '', current: '' });

const player = shallowRef(null); // 重要, proxy对象art播放器报错

// 切集/进度监听互斥与重注册定时器
let switching = false;
let reRegisterTimer: ReturnType<typeof setTimeout> | null = null;

const tmp = reactive({
  skipTime: 0,
  url: "",
  sourceUrl: "",
  preloadNext: "",
  preloadLoading: false,
  preloadBarrage: [],
  preloadSourceUrl: '',
  preloadIndex: '',
  playerHeaders: {}
}) as any;

const active = reactive({
  iptvNav: 'epg',
  driveNav: 'season',
  flimSource: '',
  filmIndex: '',
  filmCurrent: '',
  profile: false,
  analyzeId: ''
});
const recommend = ref([]) as any; // 推荐
const season = ref(); // 选集
const isSettingVisible = ref(false);

const dataHistory = ref({}) as any; // 历史
const dataBinge = ref({}) as any;

const driveDataList = ref({});
const spider = ref(null);

const skipConfig = ref({
  skipTimeInStart: 30,
  skipTimeInEnd: 30,
});

const pagination = ref({
  pageIndex: 0,
  pageSize: 32,
  count: 0,
});

const shareData = ref({
  name: '',
  url: '',
  provider: 'fmplayer',
});

const VIDEO_PROCESS_DOC = reactive({
  playEnd: false,
  watchTime: 0,
  duration: 0,
});

// ===== 连播倒计时 =====
// 片尾直接切下一集太突然（尤其是跟着片尾字幕看的时候），这里给 5 秒缓冲并可取消。
// 倒计时期间即视为本集已看完，取消后也不再重复弹出，直到用户拖回正片。
const NEXT_COUNTDOWN_SECONDS = 5;
const nextCountdown = ref(0);
const nextDismissed = ref(false);
let nextCountdownTimer: ReturnType<typeof setInterval> | null = null;
let nextPlayCallback: (() => void) | null = null;

const clearNextCountdown = () => {
  if (nextCountdownTimer) {
    clearInterval(nextCountdownTimer);
    nextCountdownTimer = null;
  }
  nextCountdown.value = 0;
  nextPlayCallback = null;
};

// 立即播放下一集
const confirmNextPlay = () => {
  const callback = nextPlayCallback;
  clearNextCountdown();
  callback?.();
};

// 取消连播：停留在此集片尾，拖回正片后可再次触发
const cancelNextPlay = () => {
  clearNextCountdown();
  nextDismissed.value = true;
};

const dataAnalyze = ref({
  default: { url: '' },
  flag: [],
  active: []
}) as any;

const isVisible = reactive({
  share: false,
  pin: false,
  macMaximize: false,
  download: false,
  binge: false,
  aside: false,
  reverseOrder: true,
  official: false,
  playError: false,
  fullscreen: false,
  fsPanel: false,
  shortcuts: false
})

// 全屏容器（包裹 #mse，见模板注释）
const fsWrapRef = ref<HTMLElement | null>(null);
// 可切换的线路名
const lineNames = computed(() => Object.keys(season.value || {}).filter((key) => !!key));

const iptvConfig = ref({
  epg: '',
  skipIpv6: false,
  channelData: [],
  epgData: []
})

const renderError = () => {
  return (
    <div class="renderIcon">
      <Tv1Icon size="1.5em" stroke-width="2" />
    </div>
  );
};
const renderLoading = () => {
  return (
    <div class="renderIcon">
      <LoadingIcon size="1.5em" stroke-width="2" />
    </div>
  );
};

// 播放失败兜底
const playErrorMsg = ref('');
let playErrorTimer: ReturnType<typeof setTimeout> | null = null;

// 播放器/流引擎错误：延迟兜底展示,期间恢复播放则取消
const handlePlayerError = () => {
  if (playErrorTimer) {
    clearTimeout(playErrorTimer);
    playErrorTimer = null;
  }
  if (isVisible.playError) return;
  playErrorMsg.value = t('pages.player.error.title');
  playErrorTimer = setTimeout(() => {
    isVisible.playError = true;
    playErrorTimer = null;
  }, 3000);
};

// 取消播放失败状态
const cancelPlayError = () => {
  if (playErrorTimer) {
    clearTimeout(playErrorTimer);
    playErrorTimer = null;
  }
  isVisible.playError = false;
};

// 展示播放失败状态
const notifyPlayError = (message?: string, immediate: boolean = false) => {
  if (playErrorTimer) {
    clearTimeout(playErrorTimer);
    playErrorTimer = null;
  }
  playErrorMsg.value = message || t('pages.player.error.title');
  if (immediate) {
    isVisible.playError = true;
    return;
  }
  playErrorTimer = setTimeout(() => {
    isVisible.playError = true;
    playErrorTimer = null;
  }, 3000);
};

// ===== 全屏 =====
// 四个播放器内核（dplayer/xgplayer/artplayer/nplayer）都对自己的容器（#mse）
// 调用 requestFullscreen。全屏元素只有 #mse 时，选集侧栏与失败提示都在它外面：
// 长剧换集必须退出全屏，播放失败时只剩一块黑屏、看不到重试按钮。
// 这里把「#mse 及其实例内部元素」的全屏请求统一重定向到外层 .mse-wrap，
// 全屏范围就包含了选集面板与错误提示；顺带还有一个好处——换集会销毁并重建
// 播放器（内核 destroy 时会清空 #mse 的 innerHTML），而 .mse-wrap 里的面板
// 不在被清空的范围内，换集后仍留在全屏里。
let restoreFullscreenRedirect: (() => void) | null = null;

const redirectFullscreenTarget = (el: Element | null): HTMLElement | null => {
  const mse = document.getElementById('mse');
  const wrap = fsWrapRef.value;
  if (!el || !mse || !wrap) return null;
  // xgplayer/artplayer 可能把全屏目标设成自己创建的内部节点，故判断包含关系
  return el === mse || el.contains(mse) || mse.contains(el) ? wrap : null;
};

const installFullscreenRedirect = () => {
  const request = Element.prototype.requestFullscreen;
  Element.prototype.requestFullscreen = function (this: Element, ...args: []) {
    const target = redirectFullscreenTarget(this);
    if (target && target !== this) return request.apply(target, args);
    return request.apply(this, args);
  };
  return () => {
    Element.prototype.requestFullscreen = request;
  };
};

const syncFullscreenState = () => {
  const el = document.fullscreenElement;
  const wrap = fsWrapRef.value;
  isVisible.fullscreen = !!el && !!wrap && (el === wrap || el.contains(wrap));
  if (!isVisible.fullscreen) {
    isVisible.fsPanel = false;
    // 全屏时按 Esc 是 Chromium 直接退出全屏，keydown 不会派发给页面，
    // 所以浮层收不到那次 Esc，只能在这里跟着收掉
    isVisible.shortcuts = false;
  }
};

const exitFullscreenIfNeeded = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
};

// ===== 键盘快捷键 =====
// 四个内核原本各有内置热键，但只有 artplayer/dplayer/xgplayer 有，键位和步长
// 还都不一样，nplayer 一个都没有——换个内核手感就变了。现在把它们统一关掉
// （见 playerModule/*.ts），键位只在这里定义，所以任何内核都是同一套操作。
const SEEK_STEP = 5;
const SEEK_STEP_LARGE = 10;
const VOLUME_STEP = 0.1;

// 键盘操作没有点击动作，不回声用户无法确认生效（全屏时尤其明显）
const shortcutHint = ref('');
let shortcutHintTimer: ReturnType<typeof setTimeout> | null = null;

const flashShortcut = (text: string, duration = 1200) => {
  shortcutHint.value = text;
  if (shortcutHintTimer) clearTimeout(shortcutHintTimer);
  shortcutHintTimer = setTimeout(() => {
    shortcutHint.value = '';
    shortcutHintTimer = null;
  }, duration);
};

const formatClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
};

// 焦点在输入框/可编辑区域时不抢键，否则在设置项、搜索框里打字会误触播放控制
const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

const shortcutPlayerMode = () => set.value.playerMode.type;

const togglePlay = async () => {
  if (!player.value) return;
  await playerToggle(player.value, shortcutPlayerMode());
};

const seekBy = async (delta: number) => {
  if (!player.value) return;
  // 直播流没有可跳转的时长，方向键保持默认行为
  if (type.value === 'iptv') return;
  const mode = shortcutPlayerMode();
  const current = await playerCurrentTime(player.value, mode);
  const total = await playerDuration(player.value, mode);
  const target = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, current + delta));
  await playerSeek(player.value, mode, target);
  flashShortcut(`${delta > 0 ? '+' : '-'}${Math.abs(delta)}s  ${formatClock(target)}`);
};

// 长按时 keydown 每 30ms 就来一次，而每次调档都要「先读当前值、再写回」——
// 中间有 await，同一批按键会读到同一个旧值：连按 6 下只前进 1 档。
// 用一条串行链把调整动作排队，长按才能一档一档走满。
const createSerialQueue = () => {
  let chain: Promise<unknown> = Promise.resolve();
  return (task: () => Promise<void>) => {
    chain = chain.then(task).catch(() => {});
    return chain;
  };
};
const queueVolume = createSerialQueue();
const queuePlaybackRate = createSerialQueue();

const applyVolume = async (delta: number) => {
  if (!player.value) return;
  const mode = shortcutPlayerMode();
  const wasMuted = await playerMuted(player.value, mode);
  const current = await playerVolume(player.value, mode);
  const next = Math.min(1, Math.max(0, Math.round((current + delta) * 100) / 100));
  await playerVolume(player.value, mode, next);
  // 写音量会把静音状态带跑：nplayer 的 volume setter 里写死「音量 > 0 就取消静音」，
  // dplayer 同理。往下调时用户根本不想开声音，所以写完按语义再落一次静音位：
  // ↑ 是「我要听得见」，↓ 保持原状态，归零则静音。
  await playerMuted(player.value, mode, delta > 0 && next > 0 ? false : wasMuted || next === 0);
  flashShortcut(`${t('pages.player.shortcut.volume')} ${Math.round(next * 100)}%`);
};

const changeVolume = (delta: number) => queueVolume(() => applyVolume(delta));

// 倍速：以前只有各内核自己的下拉菜单（档位、顺序、入口位置都不同，nplayer 甚至要
// 进二级菜单），音量却有键——同一层操作一半能用键、一半不能。这里按统一阶梯走。
const formatRate = (rate: number) => `${Number(rate.toFixed(2))}×`;

const applyPlaybackRateStep = async (step: number) => {
  if (!player.value) return;
  // 直播没有倍速可调，和 seekBy 一样不响应
  if (type.value === 'iptv') return;
  const mode = shortcutPlayerMode();
  const current = await playerPlaybackRate(player.value, mode);
  // 当前速率不一定在阶梯上（内核自己恢复的档位，或内核菜单给的是 3x），
  // 先找最近的一档再走一步，避免按下后跳到离得很远的位置
  let index = 0;
  for (let i = 1; i < PLAYBACK_RATES.length; i++) {
    if (Math.abs(PLAYBACK_RATES[i] - current) < Math.abs(PLAYBACK_RATES[index] - current)) index = i;
  }
  const next = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, index + step))];
  await playerPlaybackRate(player.value, mode, next);
  flashShortcut(`${t('pages.player.shortcut.rate')} ${formatRate(next)}`);
};

const changePlaybackRate = (step: number) => queuePlaybackRate(() => applyPlaybackRateStep(step));

const toggleMute = async () => {
  if (!player.value) return;
  const mode = shortcutPlayerMode();
  const muted = await playerMuted(player.value, mode);
  await playerMuted(player.value, mode, !muted);
  flashShortcut(muted ? t('pages.player.shortcut.unmuted') : t('pages.player.shortcut.muted'));
};

const toggleFullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => { });
    return;
  }
  fsWrapRef.value?.requestFullscreen().catch((err) => console.warn('[fullscreen]', err));
};

// 上一集/下一集：season 已经按用户选择的正序/倒序排过，indexOf 拿到的就是显示顺序
const stepEpisode = async (delta: number) => {
  if (type.value !== 'film') return;
  const list: string[] = season.value?.[active.flimSource] || [];
  const index = list.indexOf(active.filmIndex);
  const target = index < 0 ? '' : list[index + delta];
  if (!target) return;
  await fsSelectEpisode(target);
};

const shortcutRows = computed(() => [
  { keys: 'Space / K', desc: t('pages.player.shortcut.playPause') },
  { keys: '← / →', desc: t('pages.player.shortcut.seek', [SEEK_STEP]) },
  { keys: 'J / L', desc: t('pages.player.shortcut.seek', [SEEK_STEP_LARGE]) },
  { keys: '↑ / ↓', desc: t('pages.player.shortcut.volume') },
  { keys: 'M', desc: t('pages.player.shortcut.mute') },
  { keys: '< / >', desc: t('pages.player.shortcut.rate') },
  { keys: 'F', desc: t('pages.player.shortcut.fullscreen') },
  { keys: '[ / ]', desc: t('pages.player.shortcut.episode') },
  { keys: 'Esc', desc: t('pages.player.shortcut.escape') },
  { keys: '?', desc: t('pages.player.shortcut.help') },
]);

const onShortcutKeydown = (event: KeyboardEvent) => {
  // 带修饰键的组合留给系统与应用（Ctrl+R、Cmd+Q、老板键等）
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // 输入法组字期间不抢键
  if (event.isComposing || event.keyCode === 229) return;
  if (isEditableTarget(event.target)) return;

  const key = event.key || '';

  // Esc 先处理：它同时是关闭浮层的通用键，不能被下面的「弹窗阻断」吃掉
  if (key === 'Escape') {
    if (isVisible.shortcuts) {
      isVisible.shortcuts = false;
      event.preventDefault();
      return;
    }
    if (isVisible.fsPanel) isVisible.fsPanel = false;
    return;
  }

  // 弹窗打开时不响应，否则空格会作用到对话框背后的播放器上
  if (isVisible.download || isVisible.share || isVisible.shortcuts) return;

  switch (key.toLowerCase()) {
    case ' ':
    case 'k':
      event.preventDefault();
      void togglePlay();
      return;
    case 'arrowleft':
      event.preventDefault();
      void seekBy(-SEEK_STEP);
      return;
    case 'arrowright':
      event.preventDefault();
      void seekBy(SEEK_STEP);
      return;
    case 'j':
      event.preventDefault();
      void seekBy(-SEEK_STEP_LARGE);
      return;
    case 'l':
      event.preventDefault();
      void seekBy(SEEK_STEP_LARGE);
      return;
    case 'arrowup':
      event.preventDefault();
      void changeVolume(VOLUME_STEP);
      return;
    case 'arrowdown':
      event.preventDefault();
      void changeVolume(-VOLUME_STEP);
      return;
    case 'm':
      event.preventDefault();
      void toggleMute();
      return;
    // 减速 / 加速。半角 , . 一并认下：多数人不会为改个倍速去按 Shift
    case '<':
    case ',':
      event.preventDefault();
      void changePlaybackRate(-1);
      return;
    case '>':
    case '.':
      event.preventDefault();
      void changePlaybackRate(1);
      return;
    case 'f':
      event.preventDefault();
      toggleFullscreen();
      return;
    case '[':
      event.preventDefault();
      void stepEpisode(-1);
      return;
    case ']':
      event.preventDefault();
      void stepEpisode(1);
      return;
    case '?':
    case '/':
      event.preventDefault();
      isVisible.shortcuts = !isVisible.shortcuts;
      return;
    default:
      return;
  }
};

// 只在第一次进播放页提示一次，否则用户永远不知道键盘能用
const SHORTCUT_TIP_KEY = 'fmplayer_shortcut_tip_shown';
const maybeShowShortcutTip = () => {
  try {
    if (localStorage.getItem(SHORTCUT_TIP_KEY)) return;
    localStorage.setItem(SHORTCUT_TIP_KEY, '1');
  } catch {
    return;
  }
  flashShortcut(t('pages.player.shortcut.tip'), 4000);
};

onMounted(() => {
  setStreamErrorNotify(handlePlayerError);
  initPlayer();
  minMaxEvent();
  restoreFullscreenRedirect = installFullscreenRedirect();
  document.addEventListener('fullscreenchange', syncFullscreenState);
  window.addEventListener('keydown', onShortcutKeydown);
  maybeShowShortcutTip();
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState);
  window.removeEventListener('keydown', onShortcutKeydown);
  if (shortcutHintTimer) {
    clearTimeout(shortcutHintTimer);
    shortcutHintTimer = null;
  }
  restoreFullscreenRedirect?.();
  restoreFullscreenRedirect = null;
  clearNextCountdown();
  exitFullscreenIfNeeded();
});

// 加载播放器
const createPlayer = async (url: string, videoType: string = '') => {
  tmp.url = url;
  cancelPlayError();
  const { playerMode } = set.value;

  if (reRegisterTimer) {
    clearTimeout(reRegisterTimer);
    reRegisterTimer = null;
  }

  const containers = {
    xgplayer: 'mse',
    artplayer: '#mse',
    dplayer: document.getElementById('mse'),
    nplayer: '#mse',
  };

  try {
    player.value = await playerCreate(url, type.value, containers[playerMode.type], playerMode.type, videoType) as any;
  } catch (err) {
    console.error('[player][create]', err);
    notifyPlayError(undefined, true);
    return;
  }

  try {
    await playerOnError(player.value, playerMode.type, handlePlayerError);
    if (type.value !== 'film') {
      await playerTimeUpdate(player.value, playerMode.type, ({ currentTime }) => {
        if (currentTime) cancelPlayError();
      });
    }
  } catch (err) {
    console.error('[player][listen]', err);
  }

  if (tmp.skipTime) playerSeek(player.value, playerMode.type, tmp.skipTime);

  if (type.value === 'film') {
    await timerUpdatePlayProcess(); // 更新播放进度

    // 弹幕
    const options = set.value.barrage;
    const { flimSource, filmIndex } = active;
    const danmuList = await fetchBarrage(tmp.sourceUrl, options, { flimSource, filmIndex });
    if (danmuList.length > 0) {
      if (playerMode.type === 'dplayer') {
        playerBarrage(player.value, playerMode.type, tmp.sourceUrl, options, tmp.sourceUrl);
      } else {
        playerBarrage(player.value, playerMode.type, danmuList, options, tmp.sourceUrl);
      };
    }
  };

  setSystemMediaInfo(); // 设置系统媒体信息

  // setTimeout(() => {
  // console.log('setTimeout')
  // playerPause(player.value, playerMode.type);
  // offPlayerTimeUpdate(player.value, playerMode.type);
  // offPlayerBarrage(player.value, playerMode.type);
  // playerNext(player.value, playerMode.type, {url: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8',type:'m3u8'});
  // }, 6000);  // 测试用例
};

// 摧毁播放器
const destroyPlayer = async () => {
  if (!player.value) return;
  const { playerMode } = set.value;
  try {
    await offPlayerError(player.value, playerMode.type);
    await offPlayerTimeUpdate(player.value, playerMode.type);
    await playerDestroy(player.value, playerMode.type);
  } catch (err) {
    console.error('[player][destroy]', err);
  } finally {
    player.value = null;
  }
};

// 设置系统媒体信息
const setSystemMediaInfo = () => {
  if ("mediaSession" in navigator) {
    let doc = {
      title: '' as string,
      artist: '' as string,
      artwork: [] as any[],
    };

    if (type.value === 'iptv') {
      doc = {
        title: info.value["name"],
        artist: '直播',
        artwork: [
          { src: logoIcon, sizes: "128x128", type: "image/png" },
        ]
      };
    } else if (type.value === 'drive') {
      doc = {
        title: info.value["name"],
        artist: '网盘',
        artwork: [
          { src: logoIcon, sizes: "128x128", type: "image/png" },
        ]
      };
    } else {
      doc = {
        title: info.value["vod_name"],
        artist: formatIndex(active.filmIndex).index,
        artwork: [
          { src: info.value["vod_pic"], sizes: "128x128", type: "image/png" },
        ]
      }
    }

    navigator.mediaSession.metadata = new MediaMetadata(doc);
  };

  let title;
  if (type.value === 'film') title = `${info.value["vod_name"]} ${formatIndex(active.filmIndex).index}`;
  else title = info.value["name"];
  document.title = title;
};

// 获取解析
const fetchAnalyze = async (): Promise<void> => {
  const response = await fetchAnalyzeData();
  dataAnalyze.value = response;

  if (response.default?.id) active.analyzeId = response.default?.id;
};

const switchLineEvent = async (id: string) => {
  active.flimSource = id;
};

// 切换播放源:按列表位置重排集数索引后自动重新播放,保持当前进度
watch(
  () => active.flimSource,
  (newSource, oldSource) => {
    if (!oldSource || !newSource || newSource === oldSource) return;
    if (type.value !== 'film' || switching || !player.value) return;

    const oldList: string[] = season.value?.[oldSource];
    const newList: string[] = season.value?.[newSource];
    if (!oldList?.length || !newList?.length) return;

    let pos = oldList.indexOf(active.filmIndex);
    if (pos < 0) pos = 0;
    const episode = newList[Math.min(pos, newList.length - 1)];
    // 换线路时集名变了但内容相同，沿用当前进度
    if (episode && episode !== active.filmIndex) changeEvent(episode, false, { keepProgress: true });
  }
);

// 切换解析接口
const switchAnalyzeEvent = async (id: string) => {
  active.analyzeId = id;
  if (active.filmIndex) {
    cancelPlayError();
    try {
      // 恢复当前进度
      if (set.value.skipStartEnd && VIDEO_PROCESS_DOC.watchTime < skipConfig.value.skipTimeInStart) {
        tmp.skipTime = skipConfig.value.skipTimeInStart;
      } else {
        tmp.skipTime = VIDEO_PROCESS_DOC.watchTime || 0;
      }

      const { site } = ext.value;
      const { snifferMode, skipAd } = set.value;

      let { url } = formatIndex(active.filmIndex);
      url = decodeURIComponent(url);
      tmp.url = tmp.sourceUrl = url;

      const analyze = snifferAnalyze.value;
      const response = await filmPlayAndHandleResponse(snifferMode, url, site, analyze, active.flimSource, skipAd);
      if (response?.url) {
        if (player.value) {
          const { playerMode } = set.value;
          if (reRegisterTimer) {
            clearTimeout(reRegisterTimer);
            reRegisterTimer = null;
          }
          await offPlayerTimeUpdate(player.value, playerMode.type);
          await playerNext(player.value, playerMode.type, { url: response!.url, mediaType: response!.mediaType! || '' });
          if (tmp.skipTime) await playerSeek(player.value, playerMode.type, tmp.skipTime);
          reRegisterTimer = setTimeout(async () => {
            reRegisterTimer = null;
            await timerUpdatePlayProcess();
          }, 1500);
        } else {
          createPlayer(response!.url, response!.mediaType!);
        }
      } else notifyPlayError(t('pages.player.message.sniiferError'), true);
    } catch (err) {
      console.error('[player][analyze]', err);
      notifyPlayError(undefined, true);
    }
  }
};

// 获取历史
const fetchHistory = async (): Promise<void> => {
  const response = await fetchHistoryData(ext.value.site.id, info.value.vod_id);
  if (response.siteSource) active.flimSource = response.siteSource;
  if (response.videoIndex) active.filmIndex = response.videoIndex;
  if (!response.siteSource) response.siteSource = active.flimSource;
  if (!response.videoIndex) response.videoIndex = active.filmIndex;
  dataHistory.value = response;
  const { skipTimeInStart, skipTimeInEnd } = response;
  skipConfig.value = { skipTimeInStart, skipTimeInEnd };
};

// 某一集应该从第几秒开始播
// - 有该集自己的进度：用它；已看完（playEnd）则从头开始，避免重开直接跳片尾又触发连播
// - 没有该集进度：用调用方给的兜底值（老数据只有整部片一条 watchTime）
const episodeStartTime = (episode?: string, fallbackWatch = 0): number => {
  const progress = dataHistory.value?.progress || {};
  const saved = episode ? progress[episode] : null;
  const start = set.value.skipStartEnd ? skipConfig.value.skipTimeInStart : 0;

  if (saved) {
    if (saved.playEnd) return start;
    const watch = saved.watchTime || 0;
    if (!(watch > 0)) return start;
    if (set.value.skipStartEnd && watch < skipConfig.value.skipTimeInStart) return start;
    return watch;
  }

  const watch = fallbackWatch || 0;
  if (!(watch > 0)) return start;
  if (set.value.skipStartEnd && watch < skipConfig.value.skipTimeInStart) return start;
  return watch;
};

// 更新历史
let historySaving = false;
const putHistory = async (): Promise<void> => {
  if (historySaving) return; // 防止并发时重复addHistory产生多条记录
  historySaving = true;
  try {
    // 每集进度：以集名为 key（换线路时序号会漂移，集名更稳）
    const progress = { ...(dataHistory.value?.progress || {}) };
    if (active.filmIndex) {
      progress[active.filmIndex] = {
        watchTime: VIDEO_PROCESS_DOC.watchTime || 0,
        duration: VIDEO_PROCESS_DOC.duration || 0,
        playEnd: !!VIDEO_PROCESS_DOC.playEnd
      };
    }

    const doc = {
      date: moment().unix(),
      type: 'film',
      relateId: ext.value.site.id,
      siteSource: active.flimSource,
      playEnd: VIDEO_PROCESS_DOC.playEnd,
      videoId: info.value["vod_id"],
      videoImage: info.value["vod_pic"],
      videoName: info.value["vod_name"],
      videoIndex: active.filmIndex,
      watchTime: VIDEO_PROCESS_DOC.watchTime,
      duration: VIDEO_PROCESS_DOC.duration,
      skipTimeInStart: skipConfig.value.skipTimeInStart,
      skipTimeInEnd: skipConfig.value.skipTimeInEnd,
      progress
    };

    const response = await putHistoryData(dataHistory.value?.id, doc);
    if (response) dataHistory.value = response;
  } finally {
    historySaving = false;
  }
};

// 进度保存节流,避免每个timeupdate都发一次请求
const putHistoryThrottled = throttle(() => {
  putHistory();
}, 250);

const filmPlayAndHandleResponse = async (snifferMode, url, site, analyze, flimSource, skipAd) => {
  MessagePlugin.info(t('pages.player.message.play'));
  const response = await playHelper(snifferMode, url, site, analyze, flimSource, skipAd);
  isVisible.official = response!.isOfficial;

  if (response?.url) {
    if (isVisible.official) {
      if (analyze?.name) MessagePlugin.info(t('pages.player.message.official', [analyze.name]));
      else MessagePlugin.warning(t('pages.player.message.noDefaultAnalyze'));
    }
  } else MessagePlugin.error(t('pages.player.message.sniiferError'));

  return response;
};

// 初始化film
const initFilmPlayer = async (isFirst) => {
  const { site } = ext.value;
  await getDetailInfo();

  if (!isFirst) {
    await fetchHistory();
    if (!has(dataHistory.value, "id")) await putHistory();
    await fetchAnalyze();

    fetchRecommend();
    fetchBinge();

    // 从「当前这一集」的进度开始；老数据没有 progress 字段，退回整部片的 watchTime
    const legacyWatch = active.filmIndex === dataHistory.value?.videoIndex ? dataHistory.value?.watchTime : 0;
    tmp.skipTime = episodeStartTime(active.filmIndex, legacyWatch);
  }
  // isFirst（切集/换线路）时 tmp.skipTime 已由 changeEvent 按目标集的进度算好

  // 解析直链
  const { snifferMode, skipAd } = set.value;

  let { url } = formatIndex(active.filmIndex);
  url = decodeURIComponent(url);

  tmp.url = tmp.sourceUrl = url;

  const analyze = snifferAnalyze.value;
  const response = await filmPlayAndHandleResponse(snifferMode, url, site, analyze, active.flimSource, skipAd);
  if (response?.url) {
    await createPlayer(response!.url, response!.mediaType! || '');
  } else notifyPlayError(t('pages.player.message.sniiferError'), true);
};

// 初始化播放器
const initPlayer = async (isFirst = false) => {
  cancelPlayError();
  try {
    switch (type.value) {
      case 'iptv':
        await initIptvPlayer();
        break;
      case 'film':
        await initFilmPlayer(isFirst);
        break;
      case 'drive':
        await initCloudPlayer();
        break;
      default:
        break;
    };
  } catch (err) {
    console.error('[player][init]', err);
    notifyPlayError(undefined, true);
  }
};

// 重试播放
const retryPlay = async () => {
  cancelPlayError();
  await destroyPlayer();
  await initPlayer();
};

// 获取播放源及剧集
const getDetailInfo = async (): Promise<void> => {
  const formattedSeason = await formatSeason(info.value);

  active.flimSource = active.flimSource || Object.keys(formattedSeason)[0];
  active.filmIndex = active.filmIndex || formattedSeason[active.flimSource][0];

  info.value.fullList = formattedSeason;
  season.value = formattedSeason;
  if (isVisible.reverseOrder) season.value = formattedSeason;
  else season.value = reverseOrderHelper('negative', formattedSeason);
};

// 切换选集 silent: 连播链路静默失败,由调用方统一展示错误
const changeEvent = async (item, silent = false, opts: { keepProgress?: boolean } = {}) => {
  if (switching) return false;
  switching = true;
  cancelPlayError();
  clearNextCountdown();
  if (reRegisterTimer) {
    clearTimeout(reRegisterTimer);
    reRegisterTimer = null;
  }
  try {
    // 先把上一集的真实进度落库：必须在改 active.filmIndex 之前，
    // 否则旧进度会被写到新集上；原实现还会把旧进度直接重置成 0，等于切一集丢一集。
    const prevIndex = active.filmIndex;
    const prevWatch = VIDEO_PROCESS_DOC.watchTime || 0;
    const prevEnd = !!VIDEO_PROCESS_DOC.playEnd;
    if (prevIndex) {
      const progress = { ...(dataHistory.value?.progress || {}) };
      progress[prevIndex] = {
        watchTime: prevWatch,
        duration: VIDEO_PROCESS_DOC.duration || 0,
        playEnd: prevEnd
      };
      dataHistory.value = { ...(dataHistory.value || {}), progress };
    }
    await putHistory();

    active.filmIndex = item;

    // 目标集从哪开始：该集有自己的进度就用它；换线路沿用当前进度；否则从头
    const saved = (dataHistory.value?.progress || {})[item];
    const start = set.value.skipStartEnd ? skipConfig.value.skipTimeInStart : 0;
    let seek = start;
    if (saved) seek = saved.playEnd ? start : saved.watchTime || start;
    else if (opts.keepProgress) seek = prevEnd ? start : prevWatch;

    VIDEO_PROCESS_DOC.watchTime = seek;
    VIDEO_PROCESS_DOC.duration = 0;
    VIDEO_PROCESS_DOC.playEnd = false;
    nextDismissed.value = false; // 新一集重新允许片尾倒计时
    tmp.skipTime = seek;

    if (tmp.preloadNext?.url && tmp.preloadIndex === item && set.value.preloadNext) {
      const { playerMode } = set.value;

      await offPlayerTimeUpdate(player.value, playerMode.type);
      await playerNext(player.value, playerMode.type, tmp.preloadNext);
      if (tmp.preloadBarrage.length > 0) {
        await offPlayerBarrage(player.value, playerMode.type);
        const options = set.value.barrage;
        if (playerMode.type === 'dplayer') {
          playerBarrage(player.value, playerMode.type, tmp.preloadSourceUrl, options, tmp.preloadSourceUrl);
        } else {
          playerBarrage(player.value, playerMode.type, tmp.preloadBarrage, options, tmp.preloadSourceUrl);
        };
        tmp.preloadBarrage = [];
      };
      if (tmp.skipTime) {
        await playerSeek(player.value, playerMode.type, tmp.skipTime);
      };
      setSystemMediaInfo(); // 更新系统媒体信息
      reRegisterTimer = setTimeout(async () => {
        reRegisterTimer = null;
        await timerUpdatePlayProcess();
      }, 1500);
    } else {
      await destroyPlayer();
      await initFilmPlayer(true);
    }

    tmp.preloadLoading = false;
    tmp.preloadNext = {};
    tmp.preloadIndex = '';
    tmp.sourceUrl = tmp.preloadSourceUrl;
    tmp.preloadSourceUrl = '';
    return true;
  } catch (err) {
    console.error('[player][change]', err);
    if (!silent) notifyPlayError(undefined, true);
    return false;
  } finally {
    switching = false;
  }
};

// 全屏面板选集：切集成功后自动收起，否则面板会一直挡着画面
const fsSelectEpisode = async (item: string) => {
  if (item === active.filmIndex) {
    isVisible.fsPanel = false;
    return;
  }
  const ok = await changeEvent(item);
  if (ok) isVisible.fsPanel = false;
};

// 提前获取下一集链接
const preloadNext = async (item: string) => {
  const url = decodeURIComponent(formatIndex(item).url);

  tmp.preloadSourceUrl = url;
  tmp.preloadIndex = item;

  const { snifferMode, skipAd } = set.value;
  const { site } = ext.value;
  const { flimSource } = active;
  const analyze = snifferAnalyze.value;
  const response = await playHelper(snifferMode, url, site, analyze, flimSource, skipAd);
  tmp.preloadNext = { ...response };

  if (response?.url) { // 预加载弹幕 用下一集自己的链接,不能取当前集的
    const options = set.value.barrage;
    tmp.preloadBarrage = await fetchBarrage(url, options, { flimSource, filmIndex: item });
  };
};

// 获取豆瓣影片推荐
const fetchRecommend = async () => {
  const response = await fetchDoubanRecommendHelper(info.value);
  recommend.value = response;
};

// 定时更新播放进度
const timerUpdatePlayProcess = async () => {
  const { playerMode } = set.value;
  const { siteSource } = dataHistory.value;
  let index = 0;

  if (player.value) await offPlayerTimeUpdate(player.value, playerMode.type);

  const isLast = () => {
    const list = season.value?.[siteSource];
    if (!list || index < 0) return true; // 无选集数据或不在列表中,停止连播
    if (isVisible.reverseOrder) {
      return list.length === index + 1;
    } else {
      return index === 0;
    }
  }

  const autoPlayNext = async () => {
    VIDEO_PROCESS_DOC.playEnd = true;
    VIDEO_PROCESS_DOC.duration = 0;

    if (isLast() || !set.value.autoNext) {  // 最后一集或未开启自动连播
      putHistory();
      return;
    };

    console.log('[player][progress] autoPlayNext');
    const list: string[] = season.value?.[siteSource] || [];
    const nextOf = (item: string) => {
      const pos = list.indexOf(item);
      const nextPos = isVisible.reverseOrder ? pos + 1 : pos - 1;
      if (pos < 0 || nextPos < 0 || nextPos >= list.length) return '';
      return list[nextPos];
    };
    const first = isVisible.reverseOrder ? list[index + 1] : list[index - 1];
    if (!first) { notifyPlayError(undefined, true); return; }

    // 连播失败:重试1次,仍失败跳过本集,下一集也失败则弹出错误
    let ok = await changeEvent(first, true);
    if (!ok) ok = await changeEvent(first, true);
    if (!ok) {
      const skipped = nextOf(first);
      if (skipped) ok = await changeEvent(skipped, true);
      if (!ok) notifyPlayError(undefined, true);
    }
    if (ok) MessagePlugin.info(t('pages.player.message.next'));
  };

  // 片尾倒计时：先记录「本集已看完」，再给 5 秒缓冲
  const startNextCountdown = () => {
    nextPlayCallback = autoPlayNext;
    nextCountdown.value = NEXT_COUNTDOWN_SECONDS;
    // playEnd 先落库：即使中途取消，重开这一集也应该从头开始而不是跳片尾
    VIDEO_PROCESS_DOC.playEnd = true;
    putHistoryThrottled();

    nextCountdownTimer = setInterval(() => {
      nextCountdown.value -= 1;
      if (nextCountdown.value <= 0) {
        const callback = nextPlayCallback;
        clearNextCountdown();
        callback?.();
      }
    }, 1000);
  };

  const onTimeUpdate = async (currentTime: number, duration: number) => {
    if (currentTime) cancelPlayError();
    VIDEO_PROCESS_DOC.watchTime = currentTime;
    VIDEO_PROCESS_DOC.duration = duration;

    const watchTime = set.value.skipStartEnd ? currentTime + skipConfig.value.skipTimeInEnd : currentTime;
    if (duration && watchTime >= duration) {
      if (!switching) {
        if (!isLast() && set.value.autoNext) {
          if (!nextCountdown.value && !nextDismissed.value) startNextCountdown();
        } else {
          VIDEO_PROCESS_DOC.playEnd = true;
          putHistoryThrottled();
        }
      }
    } else {
      // 拖回正片后重新允许倒计时
      if (nextDismissed.value && duration && watchTime + 5 < duration) nextDismissed.value = false;
      putHistoryThrottled();
    }

    // 预加载下一步链接 提前30秒预加载
    if (duration && watchTime + 30 >= duration) {
      if (!isLast() && !tmp.preloadLoading && set.value.preloadNext) {
        try {
          tmp.preloadLoading = true;
          await preloadNext(isVisible.reverseOrder ? season.value[siteSource][index + 1] : season.value[siteSource][index - 1]);
        } catch (err) {
          console.error('[player][preload]', err);
          tmp.preloadLoading = false; // 失败复位,否则后续无法再预加载
          tmp.preloadNext = {};
          tmp.preloadIndex = '';
          tmp.preloadSourceUrl = '';
          tmp.preloadBarrage = [];
        };
      };
    };

    if (getLocalStorage('player:process')) console.log(`[player][timeUpdate] - current:${currentTime}; watch:${watchTime}; duration:${duration}; percentage:${Math.trunc((currentTime / duration) * 100)}%`);
  };

  await playerTimeUpdate(player.value, playerMode.type, ({ currentTime, duration }) => {
    index = season.value?.[siteSource]?.indexOf(active.filmIndex) ?? -1;
    onTimeUpdate(currentTime, duration);
  });
};

// 获取弹幕
const fetchBarrage = async (url: string, options: any, active: any) => {
  const response = await fetchBarrageData(url, options, active);
  return response || [];
};

// 获取收藏
const fetchBinge = async () => {
  const { id } = ext.value.site;
  const { vod_id } = info.value;
  const response = await fetchBingeData(id, vod_id);
  dataBinge.value = response.data;
  isVisible.binge = !response.status;
};

// 更新收藏
const putBinge = async (update: boolean = false) => {
  const constructDoc = () => ({
    relateId: ext.value.site.id,
    videoId: info.value.vod_id,
    videoImage: info.value.vod_pic,
    videoName: info.value.vod_name,
    videoType: info.value.type_name,
    videoRemarks: info.value.vod_remarks,
  });

  let response: any;

  if (dataBinge.value?.id) {
    if (update) {
      response = await putBingeData('update', dataBinge.value.id, constructDoc());
      if (response?.data) dataBinge.value = response.data;
    } else {
      response = await putBingeData('del', dataBinge.value.id, {});
      dataBinge.value = {
        relateId: null,
        videoId: 0,
        videoImage: "",
        videoName: "",
        videoType: "",
        videoRemarks: "",
        id: null
      };
    }
  } else if (!update) {
    response = await putBingeData('add', '', constructDoc());
    if (response?.data) dataBinge.value = response.data;
  }

  if (response && !response.status) {
    MessagePlugin.error(t('pages.player.message.error'));
    return;
  }

  if (!update) isVisible.binge = !isVisible.binge;
};

// 选集排序
const reverseOrderEvent = () => {
  isVisible.reverseOrder = !isVisible.reverseOrder;
  if (isVisible.reverseOrder) {
    season.value = reverseOrderHelper('positive', info.value.fullList);
  } else {
    season.value = reverseOrderHelper('negative', season.value);
  }
};

// 推荐刷新数据
const recommendEvent = async (item) => {
  const { site } = ext.value;

  const response = await fetchRecommendSearchHelper(site, item.vod_name);

  if (!isEmpty(response)) {
    info.value = response;
    recommend.value = [];
    dataHistory.value = {};
    skipConfig.value = { skipTimeInStart: 30, skipTimeInEnd: 30 };
    VIDEO_PROCESS_DOC.duration = 0;
    VIDEO_PROCESS_DOC.watchTime = 0;
    VIDEO_PROCESS_DOC.playEnd = false;

    tmp.skipTime = 0;
    active.flimSource = '';
    active.filmIndex = '';
    season.value = '';
    isVisible.binge = false;
    store.updateConfig({
      type: 'film',
      data: { info: item, ext: ext.value }
    });

    initPlayer();
  } else {
    MessagePlugin.warning(t('pages.player.message.noRecommendSearch'))
  }
};

// 更新历史跳过参数
const skipTimeInEndChange = () => {
  putHistory();
};

// 分享
const shareEvent = () => {
  const sourceUrl = 'https://web.fmplayer.fun/?url=';
  let name;

  if (type.value === 'film') name = `${info.value["vod_name"]} ${formatIndex(active.filmIndex).index}`;
  else name = info.value["name"];

  const params = `${tmp.url}&name=${name}`;
  const url = `${sourceUrl}${params}`;

  shareData.value = {
    ...shareData.value,
    name,
    url,
  };

  isVisible.share = true;
};

//下载 dialog 数据
const downloadEvent = () => {
  downloadDialogData.value = {
    season: season.value,
    current: tmp.url
  };
  isVisible.download = true;
};

// 初始化iptv
const initIptvPlayer = async () => {
  if (data.value.ext["epg"]) getEpgList(ext.value["epg"], info.value["name"], moment().format('YYYY-MM-DD'));
  const url = info.value["url"];

  createPlayer(url);
};

// 电子节目单播放状态
const filterEpgStatus = (start: string, end: string): 'playing' | 'unplay' | 'played' => {
  const nowTimestamp = moment();
  const startTimestamp = moment().set({
    hours: parseInt(start.split(':')[0], 10),
    minutes: parseInt(start.split(':')[1], 10),
  });
  const endTimestamp = moment().set({
    hours: parseInt(end.split(':')[0], 10),
    minutes: parseInt(end.split(':')[1], 10),
  });

  if (nowTimestamp.isBetween(startTimestamp, endTimestamp)) return 'playing';
  if (nowTimestamp.isBefore(startTimestamp)) return 'unplay';
  if (nowTimestamp.isAfter(endTimestamp)) return 'played';

  throw new Error('Invalid state: unable to determine EPG status');
};

// 加载channel
const load = async ($state) => {
  console.log('[play][channel]loading...');
  try {
    const resLength = await getChannelList();
    console.log(`[play][channel]return length: ${resLength}`);
    if (resLength === 0) $state.complete();
    else $state.loaded();
  } catch (err) {
    console.error(err);
    $state.error();
  }
};

// 检查ipv6
const checkChannelListIpv6 = async (data: any[]) => {
  const newdata = await Promise.all(
    data.map(async (item) => {
      try {
        const checkStatus = await checkUrlIpv6(item.url);
        return checkStatus !== 'IPv6' ? item : null;
      } catch (err) {
        console.log(`[play][channel][checkIpv6][error]${err}`);
        return null;
      }
    })
  );

  return newdata.filter(item => item !== null);
};

// 获取直播列表
const getChannelList = async () => {
  const { pageIndex, pageSize } = pagination.value;
  // ext 是跨窗口传过来的普通对象，这里只关心两个过滤开关
  const { skipIpv6, availableOnly } = (data.value.ext || {}) as {
    skipIpv6?: boolean;
    availableOnly?: boolean;
  };
  const { channelData } = iptvConfig.value;

  const res = await fetchChannelList(pageIndex, pageSize);
  pagination.value.count = res.total;

  const sourceLength = res.data.length;

  if (skipIpv6) res.data = await checkChannelListIpv6(res.data);
  // 电视页已经判死的频道不该再出现在侧栏，否则点开还是同一块黑屏
  if (availableOnly) res.data = res.data.filter((item) => !isDeadChannel(item.url));
  const restultLength = res.data.length;
  iptvConfig.value.channelData = unionWith(channelData, res.data, isEqual);
  const length = sourceLength;

  if ((skipIpv6 || availableOnly) && sourceLength && sourceLength !== restultLength) {
    if (res.data.length === 0) {
      pagination.value.pageIndex++;
      await getChannelList();
    }
  }

  pagination.value.pageIndex++;
  return length;
};

// 获取电子节目单
const getEpgList = async (url: string, name: string, date: string): Promise<void> => {
  try {
    const res = await fetchChannelEpg(url, name, date);
    iptvConfig.value.epgData = res;
  } catch (err) {
    console.log(`[play][epg][error]${err}`);
  }
};

// 切换channel
const changeChannelEvent = async (item) => {
  cancelPlayError();
  store.updateConfig({
    type: 'iptv',
    data: { info: item, ext: ext.value }
  });
  info.value = item;
  const url = info.value["url"];
  if (player.value) {
    const { playerMode } = set.value;
    await playerNext(player.value, playerMode.type, { url, mediaType: '' });
  } else {
    createPlayer(url);
  }
};

// 生成台标
const generateLogo = (item) => {
  let url = item.logo;
  if (ext.value.logo) {
    url = `${ext.value.logo}${item.name}.png`;
  };
  return url;
}

// 初始化网盘
const initCloudPlayer = async () => {
  driveDataList.value = ext.value["files"];
  const url = info.value["url"];
  createPlayer(url);
};

const spiderInit = async () => {
  if (!spider.value) spider.value = __jsEvalReturn();
  await spider.value.init({
    skey: 'siteKey',
    ext: [
      { ...ext.value.site }
    ],
  });
};

// 切换cloud
const changeDriveEvent = async (item) => {
  cancelPlayError();
  try {
    await spiderInit();
    const res = JSON.parse(await spider.value.file(item.path));
    store.updateConfig({
      type: 'drive',
      data: {
        info: {
          name: res.name,
          url: res.url,
          vod_pic: res.thumb
        }
      },
    });
    info.value = res;
    const url = info.value["url"];
    if (player.value) {
      const { playerMode } = set.value;
      await playerNext(player.value, playerMode.type, { url, mediaType: '' });
    } else {
      createPlayer(url);
    }
  } catch (err) {
    console.error('[player][drive]', err);
    notifyPlayError(undefined, true);
  }
};

// electron窗口置顶
const toggleAlwaysOnTop = (): void => {
  const isAlwaysOnTop = win.isAlwaysOnTop();
  const newValue = !isAlwaysOnTop;

  win.setAlwaysOnTop(newValue);
  BrowserWindow.getFocusedWindow().webContents.send('alwaysOnTop', newValue ? 'no' : 'yes');
  isVisible.pin = newValue;
};

// 全屏事件 mac修复状态栏 css 用
const minMaxEvent = (): void => {
  const handleFullScreen = (isFullScreen) => {
    isVisible.macMaximize = isFullScreen;
  };

  win.on('enter-full-screen', () => handleFullScreen(true));
  win.on('leave-full-screen', () => handleFullScreen(false));
};

// 打开主窗口
const openMainWinEvent = (): void => {
  window.electron.ipcRenderer.send('showMainWin');
};

// 更新playShow状态
window.electron.ipcRenderer.on('destroy-playerWindow', () => {
  store.updateConfig({
    status: false,
  });
});
</script>

<style lang="less" scoped>
.container {
  height: calc(100vh);
  width: calc(100vw);
  overflow-y: hidden;
  background: var(--td-bg-color-page);

  .nowrap {
    display: inline-block;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    height: auto;
    width: auto;
    font-weight: normal;
  }

  .scroll-y {
    overflow-y: scroll;
    overflow-x: hidden;
  }

  .drag {
    -webkit-app-region: drag;
  }

  .no-drag {
    -webkit-app-region: no-drag;
  }

  .container-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 32px;
    margin: var(--td-comp-margin-m) var(--td-comp-margin-xs);

    .mg-left {
      margin-left: 20px;
    }

    .left {
      .open-main-win {
        display: flex;
        flex-direction: row;
        justify-content: space-around;
        align-items: center;
        height: 32px;
        width: 120px;
        border-radius: var(--td-radius-default);
        background-color: var(--td-bg-color-container);
        padding: 2px 10px;
        transition: 0.15s linear;
        cursor: pointer;

        .tip-gotomain {
          display: inline-block;
          margin-left: 5px;
        }

        &:hover {
          background-color: var(--td-bg-content-hover-2);
        }
      }
    }

    .spacer {
      flex: 1 1 auto;
      overflow: hidden;
      text-align: center;

      span {
        font-weight: 700;
        text-align: center;
        display: inline-block;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .right {
      display: flex;
      height: 100%;

      .system-functions {
        display: flex;
        align-items: center;
        justify-content: space-around;
        background: var(--td-bg-color-container);
        border-radius: var(--td-radius-default);

        &>.system-function:first-of-type {
          margin-left: 0;
        }

        .system-function {
          margin-left: var(--td-comp-margin-xs);
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;

          :deep(.t-button) {
            &:not(.t-is-disabled):not(.t-button--ghost) {
              --ripple-color: transparent;
            }
          }

          :deep(.t-button__text) {
            svg {
              color: rgba(132, 133, 141, 0.8);
            }
          }

          :deep(.t-button--variant-text) {
            &:hover {
              border-color: transparent;
              background-color: transparent;

              .t-button__text {
                svg {
                  color: var(--td-primary-color);
                }
              }
            }
          }
        }
      }

      .window {
        height: 100%;
      }
    }
  }

  .container-main {
    height: calc(100% - var(--td-comp-size-xxxl));
    width: 100%;
    display: flex;
    justify-content: space-between;

    .player {
      flex: 1 1;
      position: relative;

      .container-player {
        width: 100%;
        height: 100%;

        .player-panel {
          position: relative;
          width: 100%;
          height: 100%;
          background: url(@/assets/bg-player.jpg) center center;

          .player-media {
            width: 100%;
            height: 100%;

            .mse-wrap {
              width: 100%;
              height: 100%;
              position: relative;

              // 全屏时补一层黑底，避免宽高比不一致时露出页面背景
              &:fullscreen {
                background: #000;
              }

              .player {
                width: 100%;
                height: 100%;
                position: relative;
              }
            }

            // 片尾连播倒计时（放在 .mse-wrap 内，全屏时同样可见）
            .next-tip {
              position: absolute;
              right: 24px;
              bottom: 76px;
              z-index: 40;

              .next-tip-card {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 14px;
                border-radius: 8px;
                background: rgba(0, 0, 0, 0.78);
                backdrop-filter: blur(6px);
                color: #fbfbfb;

                .next-tip-title {
                  font-size: 13px;
                  white-space: nowrap;
                }

                .next-tip-actions {
                  display: flex;
                  gap: 8px;
                }
              }
            }

            // 快捷键回声：键盘操作没有点击反馈，靠它确认按键生效（全屏时尤其需要）
            .shortcut-hint {
              position: absolute;
              left: 50%;
              bottom: 88px;
              transform: translateX(-50%);
              z-index: 130;
              padding: 8px 16px;
              border-radius: 8px;
              background: rgba(0, 0, 0, 0.78);
              backdrop-filter: blur(6px);
              color: #fbfbfb;
              font-size: 14px;
              font-variant-numeric: tabular-nums;
              white-space: nowrap;
              pointer-events: none;
            }

            .shortcut-fade-enter-active,
            .shortcut-fade-leave-active {
              transition: opacity 0.18s ease;
            }

            .shortcut-fade-enter-from,
            .shortcut-fade-leave-to {
              opacity: 0;
            }

            // 快捷键一览：按 ? 打开，层级高于选集面板，否则会被它盖住
            .shortcut-help {
              position: absolute;
              inset: 0;
              z-index: 140;
              display: flex;
              align-items: center;
              justify-content: center;
              background: rgba(0, 0, 0, 0.55);

              .shortcut-help-card {
                width: 380px;
                max-width: calc(100% - 48px);
                padding: 16px 18px;
                border-radius: 10px;
                background: rgba(28, 28, 30, 0.96);
                backdrop-filter: blur(8px);
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
                color: #fbfbfb;
              }

              .shortcut-help-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 10px;
              }

              .shortcut-help-title {
                font-size: 14px;
                font-weight: 600;
              }

              .shortcut-help-close {
                cursor: pointer;
                opacity: 0.7;

                &:hover {
                  opacity: 1;
                }
              }

              .shortcut-help-row {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 6px 0;
                font-size: 13px;

                & + .shortcut-help-row {
                  border-top: 1px solid rgba(255, 255, 255, 0.08);
                }
              }

              .shortcut-help-keys {
                flex: 0 0 96px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                color: #9fd4ff;
              }

              .shortcut-help-desc {
                flex: 1;
                opacity: 0.9;
              }
            }

            .fs-tools {
              position: absolute;
              inset: 0;
              // 取值要高于播放失败遮罩（100）：播放失败时选集面板是换集/换源的最后手段，
              // 被遮罩压住就变成了「打不开也退不出」的死锁
              z-index: 120;
              pointer-events: none;

              .fs-tools-dock {
                pointer-events: auto;
                position: absolute;
                top: 50%;
                right: 0;
                transform: translateY(-50%);
                width: 32px;
                height: 84px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.4);
                border-radius: 8px 0 0 8px;
                cursor: pointer;
                transition: background 0.15s ease-out, right 0.2s ease-out;

                &:hover {
                  background: rgba(0, 0, 0, 0.6);
                }

                // 面板展开后停靠在面板左侧，保持可点（否则被面板覆盖，无法收起）
                &.is-open {
                  right: 300px;
                }

                .fs-dock-icon {
                  width: 24px;
                  height: 24px;
                  color: #fbfbfb;
                }
              }

              .fs-panel {
                pointer-events: auto;
                position: absolute;
                top: 0;
                right: 0;
                bottom: 0;
                width: 300px;
                display: flex;
                flex-direction: column;
                padding: 12px 12px 0;
                box-sizing: border-box;
                background: rgba(20, 20, 20, 0.92);
                backdrop-filter: blur(6px);

                .fs-panel-header {
                  display: flex;
                  align-items: baseline;
                  gap: 8px;
                  margin-bottom: 4px;

                  .fs-panel-title {
                    color: #fbfbfb;
                    font-size: 15px;
                    font-weight: 500;
                  }

                  .fs-panel-name {
                    max-width: 150px;
                    color: rgba(251, 251, 251, 0.6);
                    font-size: 12px;
                  }

                  .fs-panel-close {
                    margin-left: auto;
                    color: rgba(251, 251, 251, 0.6);
                    cursor: pointer;
                    transition: color 0.15s ease-out;

                    &:hover {
                      color: #fbfbfb;
                    }
                  }
                }

                .fs-panel-line {
                  color: rgba(251, 251, 251, 0.85);
                }

                .fs-panel-list {
                  flex: 1;
                  min-height: 0;
                  display: flex;
                  flex-wrap: wrap;
                  align-content: flex-start;
                  gap: 8px;
                  margin-top: 6px;
                  padding: 8px 0;
                  overflow-y: auto;
                  border-top: 1px solid rgba(255, 255, 255, 0.12);

                  .fs-ep {
                    min-width: 46px;
                    height: 32px;
                    line-height: 32px;
                    padding: 0 8px;
                    border-radius: 4px;
                    text-align: center;
                    font-size: 13px;
                    color: rgba(251, 251, 251, 0.85);
                    background: rgba(255, 255, 255, 0.08);
                    cursor: pointer;

                    &:hover {
                      background: rgba(255, 255, 255, 0.18);
                    }

                    &.fs-ep-active {
                      color: #fff;
                      background: var(--td-brand-color);
                    }
                  }
                }
              }
            }
          }

          .player-error-mask {
            position: absolute;
            inset: 0;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.72);

            .player-error-content {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
              padding: 24px;
              text-align: center;

              .player-error-msg {
                color: #fbfbfb;
                font-size: 16px;
                font-weight: 500;
              }

              .player-error-desc {
                color: rgba(251, 251, 251, 0.6);
                font-size: 13px;
                margin-bottom: 8px;
              }
            }
          }
        }
      }

      .subject {
        width: 100%;
      }

      .subject:hover~.dock-show {
        display: flex;
      }

      .subject-ext {
        width: 100vw !important;
      }

      .dock-show {
        display: none;
        transition: 0.15s ease-out;
        background: rgba(0, 0, 0, .4);
        border-radius: 8px 0 0 8px;
        width: 32px;
        height: 84px;
        position: absolute;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        flex-direction: column;
        justify-content: center;
        align-items: center;
        // 必须高于 .player-error-mask 的 z-index(100)：播放出错时错误遮罩 inset:0
        // 会铺满播放器区域，若按钮层级低于遮罩，会被盖住导致无法点击收起剧集面板。
        z-index: 110;
        cursor: pointer;

        &:hover {
          display: flex;
          background: rgba(0, 0, 0, .5);
        }

        .btn-icon {
          width: 24px;
          height: 24px;
          color: #fbfbfb;
        }
      }
    }

    .aside {
      transition: 0.15s ease-out;
      width: 300px;
      height: 100%;
      position: relative;
      background: var(--td-bg-container);
      border-radius: var(--td-radius-medium);
      padding: 10px 10px 0;
      box-sizing: border-box;

      .content {
        height: -webkit-fill-available;

        .title-warp {
          height: 26px;
          line-height: 26px;

          .title {
            max-width: 100%;
            font-size: 20px;
            min-height: 32px;
            line-height: 32px;
            font-weight: 500;
            color: var(--td-text-color-primary);
          }
        }

        .content-main {
          height: calc(100% - 26px);

          .tabs {
            height: 100%;
            background-color: var(--td-bg-container);
          }

          .contents-wrap {
            height: 100%;
            width: 100%;
            padding-top: 10px;
            display: flex;
            flex-direction: column;

            .content {
              .content-item-start {
                justify-content: flex-start;
              }

              .content-item-between {
                justify-content: space-between;
              }

              .content-item {
                display: flex;
                grid-column-gap: var(--td-size-2);
                height: 38px;
                align-items: center;
                font-weight: 500;
                cursor: pointer;
                padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);

                .time-warp {
                  width: 40px;
                  color: #f09736;
                  margin-right: 10px;
                }

                .status-wrap {
                  text-align: right;

                  .played {
                    color: #2774f6;
                  }

                  .playing {
                    color: #f09736;
                  }

                  .unplay {
                    color: var(--td-text-color-primary);
                  }
                }

                .logo-wrap {
                  max-width: 60px;
                  margin-right: 10px;
                }

                .title-wrap {
                  font-weight: bold;
                  flex: 1;
                }

                &:hover {
                  background-color: var(--td-bg-content-hover-2);
                  border-radius: var(--td-radius-medium);
                }
              }
            }
          }

          :deep(.t-tab-panel) {
            background-color: var(--td-bg-container);
          }

          .channel-wrap,
          .epg-wrap,
          .drive-wrap {
            height: calc(100vh - 150px);
          }
        }

        .tvg-block {
          width: 100%;
          word-break: break-all;
          display: flex;
          flex-direction: column;
          align-items: baseline;

          .title-album {
            font-size: 100%;
            width: 100%;

            .title-text {
              max-width: 80%;
              font-weight: 500;
              line-height: 16px;
              font-size: 16px;
              color: var(--td-text-color-primary);
            }

            .title-desc {
              display: inline;
              align-items: center;
              margin-left: 9px;
              font-size: 12px;
              cursor: pointer;
            }
          }

          .hot-block {
            display: flex;
            flex-direction: row;
            align-items: center;
            font-size: 12px;
            height: 12px;
            line-height: 12px;
            overflow: visible;
            position: relative;
            margin-top: 8px;
            width: inherit;

            .rate {
              color: var(--td-brand-color);
            }
          }

          .function {
            width: 100%;
            display: flex;
            flex-direction: row;
            justify-content: space-evenly;
            align-items: center;
            margin-top: 15px;
            margin-bottom: 12px;
            font-size: 14px;
            height: 40px;
            position: relative;
            background: hsla(0, 0%, 100%, .06);
            box-shadow: 0 2px 16px 0 rgba(0, 0, 0, .16);
            border-radius: 8px;

            .func-item {
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              font-size: 12px;
              line-height: 12px;
              text-align: center;

              &:hover {
                color: var(--td-text-color-primary);
              }

              .tip {
                vertical-align: top;
                line-height: 25px;
                text-align: center;
                margin-left: 4px;
              }
            }

            .dot {
              height: 24px;
              width: 1px;
              border-right: 1px solid;
              border-image-source: linear-gradient(180deg, hsla(0, 0%, 100%, 0), hsla(0, 0%, 100%, .1) 53%, hsla(0, 0%, 100%, 0));
              border-image-slice: 1;
            }
          }
        }

        .anthology-contents-scroll {
          position: relative;
          height: calc(100vh - 56px - 10px - 111px);
          overflow-y: auto;
          overflow-x: hidden;

          .box-anthology-header {
            font-size: 16px;
            line-height: 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: var(--td-text-color-primary);

            .left {
              display: flex;
              flex-direction: row;
              flex-wrap: nowrap;
              justify-content: flex-start;
              align-items: flex-end;

              .mg-left {
                margin-left: var(--td-comp-margin-xs);
              }

              .box-anthology-title {
                white-space: nowrap;
                position: relative;
                font-size: 18px;
                line-height: 25px;
                font-weight: 600;
              }

              .box-anthology-analyze,
              .box-anthology-line {
                :deep(.t-button) {
                  padding: 0;
                }

                :deep(.t-button:not(.t-is-disabled):not(.t-button--ghost)) {
                  --ripple-color: transparent;
                }

                :deep(.t-button--variant-text) {
                  color: var(--td-text-color-secondary);

                  .t-button__suffix {
                    margin-left: var(--td-comp-margin-xxs);
                  }

                  .t-button__text {
                    &:before {
                      content: "";
                      width: 1px;
                      margin: 0 var(--td-comp-margin-xs);
                      background: linear-gradient(180deg, transparent, var(--td-border-level-1-color), transparent);
                    }
                  }

                  &:hover,
                  &:focus-visible {
                    background-color: transparent !important;
                    border-color: transparent !important;
                    color: var(--td-brand-color);
                  }
                }
              }
            }

            .right {
              .box-anthology-reverse-order {
                cursor: pointer;
              }
            }
          }

          .listbox {
            overflow: hidden;

            .tag-container {
              display: flex;
              flex-wrap: wrap;
              padding-top: 10px;

              .mainVideo-num {
                position: relative;
                width: 41px;
                font-size: 18px;
                height: 41px;
                line-height: 41px;
                border-radius: 8px;
                text-align: center;
                cursor: pointer;
                margin-bottom: 4px;
                margin-right: 4px;
                box-shadow: 0 2px 8px 0 rgba(0, 0, 0, .08);

                &:hover {
                  background-image: linear-gradient(var(--td-brand-color-2), var(--td-brand-color-3));
                }

                &:before {
                  content: "";
                  display: block;
                  position: absolute;
                  top: 1px;
                  left: 1px;
                  right: 1px;
                  bottom: 1px;
                  border-radius: 8px;
                  background-color: var(--td-bg-container);
                  z-index: 2;
                }

                .mainVideo_inner {
                  position: absolute;
                  top: 1px;
                  left: 1px;
                  right: 1px;
                  bottom: 1px;
                  border-radius: 8px;
                  z-index: 3;
                  overflow: hidden;
                  background-image: linear-gradient(hsla(0, 0%, 100%, .04), hsla(0, 0%, 100%, .06));

                  .playing {
                    display: none;
                    min-width: 10px;
                    height: 8px;
                    background: url(@/assets/player/playon-green.gif) no-repeat;
                  }
                }
              }

              .mainVideo-selected {
                color: var(--td-brand-color);
                background-image: linear-gradient(hsla(0, 0%, 100%, .1), hsla(0, 0%, 100%, .06));

                // box-shadow: 0 2px 8px 0 rgba(0,0,0,.08), inset 0 4px 10px 0 rgba(0,0,0,.14);
                .playing {
                  display: inline-block !important;
                  position: absolute;
                  left: 6px;
                  bottom: 6px;
                }
              }
            }
          }

          .recommend {
            .component-title {
              font-size: 16px;
              line-height: 16px;
              margin-top: 10px;
              margin-bottom: 12px;
              font-weight: 500;
              color: var(--td-text-color-primary);
            }

            .component-list {
              .videoItem-card {
                width: 100%;
                position: relative;
                z-index: 1;
                cursor: pointer;
                display: flex;
                align-items: center;
                column-gap: 4px;
                cursor: pointer;
                padding: 6px 0;

                .videoItem-left {
                  position: relative;
                  float: left;
                  margin-right: 10px;
                  font-size: 12px;
                  height: 100%;
                  overflow: hidden;
                }

                .videoItem-right {
                  flex: 1 1;
                  position: relative;
                  overflow: hidden;
                  display: flex;
                  flex-direction: column;
                  justify-content: flex-start;

                  .title {
                    font-size: 14px;
                    line-height: 20px;
                    max-height: 40px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    word-break: break-all;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    color: var(--td-text-color-primary);
                  }

                  .subtitle {
                    margin-top: 6px;
                    line-height: 14px;
                    font-size: 12px;
                    max-height: 40px;
                    white-space: wrap;
                  }
                }
              }
            }
          }
        }

        .profile {
          display: flex;
          flex-direction: column;
          height: 100%;

          .side-head {
            flex-shrink: 0;
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;

            .title {
              font-size: 16px;
              line-height: 24px;
            }

            .icon {
              cursor: pointer;
            }
          }

          .side-body {
            flex: 1;
            position: relative;
            padding: 8px 0;

            .card {
              display: flex;
              flex-direction: row;

              .cover {
                width: 84px;
                height: 112px;
                margin-right: 12px;
              }

              .content {
                flex: 1;
                padding-top: 10px;

                .name {
                  font-size: 16px;
                  line-height: 24px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  display: -webkit-box;
                  -webkit-line-clamp: 2;
                  -webkit-box-orient: vertical;
                }

                .type {
                  font-size: 14px;
                  line-height: 20px;
                  margin-top: 5px;
                }

                .num {
                  font-size: 14px;
                  line-height: 20px;
                  margin-top: 5px;
                }
              }
            }

            .text {
              margin-top: 8px;
              line-height: 20px;
              font-size: 14px;
            }

            .case {
              margin-top: 12px;

              .title {
                line-height: 16px;
                font-size: 14px;
                font-weight: 500;
                color: var(--td-text-color-primary);
              }
            }
          }
        }
      }
    }
  }
}

.setting-warp {
  display: inline-flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  padding-bottom: 2px;

  .setting-item-warp {
    display: flex;
    justify-content: space-between;
  }

  .tip-warp {
    bottom: 4px;
  }
}

.setting-warp,
.download-warp {
  .tip-warp {
    color: var(--td-gray-color-6);
    font-size: var(--td-font-size-link-small);
    position: absolute;
    left: calc(var(--td-comp-paddingLR-xxl) + var(--td-size-1));
  }
}

.active {
  color: var(--td-brand-color);
}

:deep(.t-input) {
  background-color: var(--td-bg-content-input) !important;
  border-color: transparent !important;
}

@media only screen and (max-width: 640px) {
  .container {
    width: 100%;
    overflow: auto;

    &:hover>.container-header {
      opacity: 1;
      pointer-events: auto;
      transition: opacity 0.15s linear 0s, visibility 0s linear 0s;
    }

    .container-header {
      background: linear-gradient(360deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, .8));
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      z-index: 999;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s linear 3s, visibility 0s linear 3s;
      height: 56px;
      margin: 0;
      padding: var(--td-comp-paddingTB-xxxs) var(--td-comp-paddingLR-xs) 0;

      .left {
        .open-main-win {
          background-color: transparent !important;
          color: #f3f3f3;
          width: auto !important;

          .tip-gotomain {
            display: none !important;
          }

          &:hover {
            background-color: transparent !important;
            color: #fbfbfb;
          }
        }
      }

      .spacer {
        color: #fbfbfb;
      }

      .right {
        color: #fbfbfb;

        .system-functions {
          background-color: transparent !important;

          .staple {
            margin-left: 0;

            svg {
              color: #fbfbfb !important;
            }

            &:hover {
              background-color: transparent !important;
              color: #fbfbfb !important;
            }
          }

          .setting {
            display: none !important;
          }
        }

        .window {
          margin: 12px 0 0 0 !important;
          border-radius: 0 !important;
          background-color: transparent !important;
          cursor: pointer;
          --tb-control-hover-color: transparent !important;
          --tb-control-symbol-color: #fbfbfb !important;
          --tb-control-close-symbol-color: #fbfbfb !important;

          :deep(.titlebar__window-controls) {
            .window__control {
              cursor: pointer !important;
            }

            .window__control-close:hover {
              background-color: transparent !important;
            }
          }
        }
      }
    }

    .container-main {
      height: 100vh;

      .player {
        .dock-show {
          display: none !important;
        }
      }

      .aside {
        display: none !important;
      }
    }
  }
}
</style>

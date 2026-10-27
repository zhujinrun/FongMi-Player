<template>
  <div class="iptv view-container">
    <common-nav
      :title="$t('pages.iptv.name')"
      :list="iptvConfig.data"
      :active="active.nav"
      search
      @change-key="changeDefaultIptvEvent"
    />
    <div class="content">
      <!-- 配置读取失败原先会把 loading 和错误插槽一起关掉，页面全白且没有任何重试入口 -->
      <state-view
        v-if="pageState"
        :type="pageState === 'error' ? 'error' : 'empty'"
        :title="stateText.title"
        :description="stateText.desc"
        :action-text="pageState === 'noSource' ? $t('pages.state.goSetting') : $t('pages.state.retry')"
        @action="pageState === 'noSource' ? goIptvSetting() : retryLoad()"
      />
      <header v-if="!pageState" class="header">
        <div class="header-nav">
          <TagNav :list="classConfig.data" :active="active.class" @change-key="changeClassEvent" />
        </div>
        <!-- 检测与过滤必须挨在一起：这批源八成是转发地址，先测一遍才知道哪些能播 -->
        <div class="header-tools">
          <span v-if="probe.running" class="probe-progress">
            {{ probe.done }}/{{ probe.total }} · {{ $t('pages.iptv.probe.alive') }} {{ probe.alive }}
          </span>
          <span v-else-if="probe.summary" class="probe-progress">{{ probe.summary }}</span>
          <t-button
            class="probe-btn"
            size="small"
            variant="outline"
            @click="probe.running ? stopProbe() : probeAllEvent()"
          >
            {{ probe.running ? $t('pages.iptv.probe.stop') : $t('pages.iptv.probe.start') }}
          </t-button>
          <label class="probe-only">
            <t-switch v-model="availableOnly" size="small" />
            <span>{{ $t('pages.iptv.probe.onlyPlayable') }}</span>
          </label>
        </div>
      </header>
      <div v-if="!pageState" class="container">
        <div id="back-top" class="content-wrapper">
          <t-row :gutter="[16, 16]" style="margin: 0">
            <!-- 首屏/切分类时的占位：和影视页同一套骨架，只是封面比例不同 -->
            <skeleton-grid v-if="listSkeleton" :count="12" aspect="62%" />
            <template v-else>
              <t-col
                v-for="item in displayList"
                :key="item.id"
                :md="3"
                :lg="3"
                :xl="2"
                :xxl="1"
                :class="['card', { 'card-stale': listStale }]"
                @click="playEvent(item)"
                @contextmenu="conButtonClick(item, $event)"
              >
                <div class="card-main">
                  <div v-show="iptvConfig.ext.status" class="card-tag">
                    <span v-if="item.status && item.status < 500" class="status-item success">{{ item.status }}ms</span>
                    <span v-else class="status-item error">{{
                      item.status ? `${item.status}ms` : $t('pages.iptv.delay')
                    }}</span>
                  </div>
                  <t-image
                    class="card-main-item"
                    :src="iptvConfig.ext.thumbnail ? item.thumbnail : generateLogo(item)"
                    :style="{
                      width: '100%',
                      background: 'none',
                      overflow: 'hidden',
                      padding: iptvConfig.ext.thumbnail ? 'none' : '35px 30px',
                    }"
                    :lazy="true"
                    :loading="renderImageLoading"
                    :error="renderImageError"
                  />
                </div>
                <div class="card-footer">
                  <span class="card-footer-title text-hide">{{ item.name }}</span>
                </div>
              </t-col>
            </template>

            <context-menu
              :show="isVisible.contentMenu"
              :options="optionsComponent"
              @close="isVisible.contentMenu = false"
            >
              <context-menu-item :label="$t('pages.iptv.contextMenu.copyChannel')" @click="copyChannelEvent" />
              <context-menu-item :label="$t('pages.iptv.contextMenu.delChannel')" @click="delChannelEvent" />
            </context-menu>
          </t-row>
          <infinite-loading
            v-if="isVisible.infiniteLoading"
            class="infinite-loading-container"
            :identifier="infiniteId"
            :duration="200"
            @infinite="load"
          >
            <template #complete>{{ $t(`pages.iptv.infiniteLoading.${infiniteCompleteTip}`) }}</template>
            <template #error>{{ $t('pages.iptv.infiniteLoading.error') }}</template>
          </infinite-loading>
        </div>
      </div>
    </div>
    <t-loading
      :attach="`.${prefix}-content`"
      size="medium"
      :text="$t('pages.setting.loading')"
      :loading="isVisible.loading"
    />
    <t-back-top container="#back-top" size="small" :offset="['1.4rem', '0.5rem']" :duration="2000" />
  </div>
</template>

<script setup lang="tsx">
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css';
import 'v3-infinite-loading/lib/style.css';

import { ContextMenu, ContextMenuItem } from '@imengyu/vue3-context-menu';
import find from 'lodash/find';
import findIndex from 'lodash/findIndex';
import has from 'lodash/has';
import isEmpty from 'lodash/isEmpty';
import slice from 'lodash/slice';
import PQueue from 'p-queue';
import { MessagePlugin } from 'tdesign-vue-next';
import InfiniteLoading from 'v3-infinite-loading';
import { computed, onActivated, onMounted, onUnmounted, ref, reactive, watch } from 'vue';
import { useRouter } from 'vue-router';

import { prefix } from '@/config/global';
import { t } from '@/locales';
import { usePlayStore, useSettingStore } from '@/store';

import { fetchIptvActive, clearChannel, addChannel, fetchChannelList, delChannelItem } from '@/api/iptv';
import { setDefault, updateSetting } from '@/api/setting';
import { parseChannel, stopCheckChannel } from '@/utils/channel';
import { renderImageError, renderImageLoading } from '@/utils/common/imageState';
import emitter from '@/utils/emitter';
import { getProbe, isDeadChannel, isProbeable, mergeProbeCache, probeChannels } from '@/utils/iptvProbe';
import { checkUrlIpv6, copyToClipboardApi } from '@/utils/tool';

import CommonNav from '../components/common-nav/index.vue';
import SkeletonGrid from '../components/skeleton-grid/index.vue';
import StateView from '../components/state-view/index.vue';
import TagNav from '../components/tag-nav/index.vue';

const storePlayer = usePlayStore();
const storeSetting = useSettingStore();
const router = useRouter();

const isVisible = reactive({
  infiniteLoading: false, // 筛选
  contentMenu: false,
  loading: false,
});

// 整页状态：'' 正常，noSource 没有可用直播源，error 配置请求失败
const pageState = ref<'' | 'noSource' | 'error'>('');

const stateText = computed(() => {
  const key = pageState.value === 'error' ? 'error' : pageState.value === 'noSource' ? 'noSource' : 'error';
  return {
    title: t(`pages.iptv.state.${key}Title`),
    desc: t(`pages.iptv.state.${key}Desc`),
  };
});

const goIptvSetting = () => {
  storeSetting.updateConfig({ sysConfigSwitch: 'iptvSource' });
  router.push('/setting/index');
};

const retryLoad = async () => {
  pageState.value = '';
  isVisible.infiniteLoading = false;
  beginListWait();
  // 在途的旧请求作废
  channelGen++;
  channelData.value = { list: [], total: 0 };
  pagination.value.pageIndex = 0;
  await getSetting();
  if (!pageState.value) infiniteId.value++;
  // 又退回错误/空态时不会有新列表到达，占位要跟着撤掉
  else endListWait();
};
const searchTxt = ref('');
const infiniteId = ref(+new Date());
const infiniteCompleteTip = ref('noMore');
const pagination = ref({
  pageIndex: 0,
  pageSize: 32,
  count: 0,
});

const iptvConfig = ref({
  default: {},
  data: [],
  ext: {
    epg: 'http://diyp.112114.xyz/',
    logo: 'https://epg.112114.eu.org/logo/',
    skipIpv6: true,
    status: false,
    thumbnail: false,
    availableOnly: false,
  },
  ua: '',
});

const active = ref({
  nav: '',
  class: '全部',
});

const channelData = ref<any>({
  list: [],
  total: 0,
});

// 频道追加去重：原来用 _.unionWith(list, 新页, _.isEqual)，新页每个频道都要跟已累积的
// 全部频道做深比较。频道表可以上万条，翻到后面单页要跑几十万次深比较。频道 id 是
// 库里的唯一主键（v-for 也拿它当 key），直接按 id 去重即可，O(n+m)。
type ChannelItem = { id?: string | number };

const appendUniqueChannel = (incoming: ChannelItem[], existing: ChannelItem[]): ChannelItem[] => {
  const seen = new Set(
    existing
      .map((item) => item?.id)
      .filter((id) => id !== undefined && id !== null)
      .map(String),
  );
  const fresh: ChannelItem[] = [];
  for (const item of incoming) {
    // 没有主键的条目一律保留：宁可重复一条，也不能把一堆空 id 折叠成同一个 key 全丢掉
    if (item?.id === undefined || item?.id === null || item?.id === '') {
      fresh.push(item);
      continue;
    }
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  return fresh;
};

// 切分类/换源时数据层会把 list 清空再重拉，照着渲染就是一次白屏。
// 新请求在途时先留着上一批频道并压暗，等新数据到达再整体换掉；
// 手上没有上一批（首次进入）才退回骨架占位。
type ChannelCardItem = { id?: string | number } & Record<string, unknown>;
const lastList = ref<ChannelCardItem[]>([]);
const listPending = ref(false);
let listWaitTimer: ReturnType<typeof setTimeout> | null = null;

const displayList = computed(() =>
  listPending.value && lastList.value.length ? lastList.value : channelData.value.list,
);
// 压暗的是上一批结果：不可点，避免点开已经不在当前分类里的频道
const listStale = computed(() => listPending.value && lastList.value.length > 0 && channelData.value.list.length === 0);
const listSkeleton = computed(() => listPending.value && displayList.value.length === 0);

const beginListWait = () => {
  listPending.value = true;
  if (listWaitTimer) clearTimeout(listWaitTimer);
  // 兜底：源站挂住不回时，别让压暗的旧列表一直僵在那里
  listWaitTimer = setTimeout(() => {
    listPending.value = false;
    listWaitTimer = null;
  }, 10000);
};

const endListWait = () => {
  if (listWaitTimer) {
    clearTimeout(listWaitTimer);
    listWaitTimer = null;
  }
  listPending.value = false;
};

// infinite-loading 只在「哨兵进入视口」时才触发；旧频道垫底后哨兵被顶到视口外，
// 切分类就不会再自己发请求。首屏改为显式拉取，复用观察者交过来的 $state。
let infiniteState: { complete: () => void; loaded: () => void; error: () => void } | null = null;
let firstPageLoading = false;

const reloadList = async () => {
  if (!infiniteState) {
    pagination.value.pageIndex = 0;
    return;
  }
  firstPageLoading = true;
  pagination.value.pageIndex = 0;
  try {
    await load(infiniteState, true);
  } finally {
    firstPageLoading = false;
  }
};

watch(
  () => channelData.value.list,
  (list) => {
    if (list?.length) {
      lastList.value = list;
      endListWait();
    }
  },
);

const classConfig = ref({
  data: [{ type_id: '全部', type_name: '全部' }],
});

const mode = computed(() => {
  return storeSetting.displayMode;
});

const optionsComponent = ref({
  zIndex: 15,
  width: 160,
  x: 500,
  y: 200,
  theme: mode.value === 'light' ? 'default' : 'mac dark',
});

const channelItem = ref<any>(null);

const queue = new PQueue({ concurrency: 5 }); // 设置并发限制为5

onMounted(() => {
  getSetting();
});

onActivated(() => {
  const isListenedRefreshIptvConfig = emitter.all.get('refreshIptvConfig');
  if (!isListenedRefreshIptvConfig) emitter.on('refreshIptvConfig', refreshIptvConfig);
});

onUnmounted(() => {
  if (listWaitTimer) clearTimeout(listWaitTimer);
});

// 获取配置
const getSetting = async () => {
  try {
    const data = await fetchIptvActive();
    if (has(data, 'default') && !isEmpty(data['default'])) {
      iptvConfig.value.default = data['default'];
      active.value.nav = data['default']['id'];
    }
    if (has(data, 'ext') && !isEmpty(data['ext'])) {
      iptvConfig.value.ext = data['ext'];
    }
    if (has(data, 'data') && !isEmpty(data['data'])) {
      iptvConfig.value.data = data['data'];
    }

    // 没有任何直播源时整页给空态，而不是留一个永远空着的列表
    if (isEmpty(iptvConfig.value.data)) {
      pageState.value = 'noSource';
      isVisible.infiniteLoading = false;
      return;
    }

    pageState.value = '';
    isVisible.infiniteLoading = true;
  } catch (err) {
    // 原先这里只是把加载器关掉，页面变成一片空白且没有重试入口
    console.error('[iptv][setting]', err);
    pageState.value = 'error';
    isVisible.infiniteLoading = false;
  }
};

// 获取直播列表
// 频道请求代次：切分类/换源/搜索后递增，过期响应直接丢弃
let channelGen = 0;

const getChannel = async () => {
  const { pageIndex, pageSize } = pagination.value;
  const { skipIpv6, status, thumbnail } = iptvConfig.value.ext;
  const { list } = channelData.value;
  const gen = channelGen;

  const res = await fetchChannelList(pageIndex, pageSize, searchTxt.value, active.value.class);
  // 期间又切了分类：这一页属于上一批，不能再并进列表
  if (gen !== channelGen) {
    console.log('[iptv] stale channel response dropped');
    return 0;
  }
  pagination.value.count = res['total'];
  classConfig.value.data = res['class'];

  const sourceLength = res.data.length;

  if (skipIpv6) res.data = await checkChannelListIpv6(res.data);
  // 过滤掉已明确判死的频道；没测过的一律照常显示，随后由 probePage 补测
  const onlyPlayable = availableOnly.value;
  const probeTargets = res.data;
  if (onlyPlayable) res.data = res.data.filter((item) => !isDeadChannel(item.url));
  const restultLength = res.data.length;
  channelData.value.list = [...list, ...appendUniqueChannel(res.data, list)] as any;

  // 一个探测入口喂两个开关：可用性过滤 + 延迟数字
  if (onlyPlayable || status) void probePage(probeTargets);
  if (thumbnail) generateThumbnail(pageIndex, pageSize);

  // 判断是否开启检查；判断原数据；判断原和目的
  // 1. 开启检查：为0  1).返回原或0
  // 2. 开启检查：非0  1).相等直接返回  2).不相等[原非0:目的0再次请求；原小于pagesise:目的小于pagesise返回原]  3).
  // 3. 非开启检查     1).直接返回原
  const length = sourceLength;

  if ((skipIpv6 || onlyPlayable) && sourceLength && sourceLength !== restultLength) {
    if (res.data.length === 0) {
      pagination.value.pageIndex++;
      await getChannel();
    }
  }

  pagination.value.pageIndex++;
  console.log(`[iptv] load data length: ${length}`);
  return length;
};

const load = async ($state: { complete: () => void; loaded: () => void; error: () => void }, explicit = false) => {
  infiniteState = $state;
  // 显式首屏请求在途时，观察者若因布局变化再次触发同一页就忽略
  if (!explicit && firstPageLoading && pagination.value.pageIndex <= 1) return;
  console.log('[iptv] loading...');
  // 第一页即整页首屏：数据到达前先摆骨架，别让容器空着（后续分页不再重置占位）
  if (pagination.value.pageIndex <= 1) beginListWait();
  try {
    const resLength = await getChannel();

    if (isEmpty(active.value.nav) && isEmpty(channelData.value.list)) {
      infiniteCompleteTip.value = 'noData';
      $state.complete();
      // return;
    }

    if (resLength === 0) {
      $state.complete();
    } else $state.loaded();
  } catch (err) {
    console.log(err);
    $state.error();
  } finally {
    // 第一批频道一落地就收起占位；后续分页调用重复置 false 无副作用
    endListWait();
  }
};

// 搜索
const searchEvent = async () => {
  console.log(`[iptv] search keyword: ${searchTxt.value}`);
  beginListWait();
  channelGen++;
  channelData.value = { list: [], total: 0 };
  infiniteId.value++;
  pagination.value.pageIndex = 0;
  void reloadList();
};

// 切换分类
const changeClassEvent = async (id) => {
  clearQueue();
  infiniteCompleteTip.value = 'noMore';
  active.value.class = id;

  beginListWait();
  channelGen++;
  channelData.value = { list: [], total: 0 };
  infiniteId.value++;
  pagination.value.pageIndex = 0;
  void reloadList();
};

// 播放
const playEvent = (item) => {
  isVisible.loading = true;

  try {
    const playerMode = storePlayer.getSetting.playerMode;
    if (playerMode.type === 'custom') {
      window.electron.ipcRenderer.send('call-player', playerMode.external, item.url);
    } else {
      const { epg, skipIpv6, logo, availableOnly } = iptvConfig.value.ext;
      storePlayer.updateConfig({
        type: 'iptv',
        status: true,
        data: {
          info: item,
          ext: { epg, skipIpv6, logo, availableOnly },
        },
      });
      window.electron.ipcRenderer.send('openPlayWindow', item.name);
    }
  } catch (err) {
    console.error(`[iptv][playEvent][error]`, err);
    MessagePlugin.warning(t('pages.chase.reqError'));
  } finally {
    isVisible.loading = false;
  }
};

// 检查ipv6
const checkChannelListIpv6 = async (data) => {
  const newdata = await Promise.allSettled(
    data.map(async (item) => {
      try {
        const checkStatus = await checkUrlIpv6(item.url);
        if (checkStatus !== 'IPv6') return item;
        return false;
      } catch (err) {
        console.log(err);
        return false;
      }
    }),
  );

  const filteredData = newdata
    .filter((result) => result.status === 'fulfilled' && result.value !== false)
    .map((result) => {
      if (result.status === 'fulfilled') return result.value;
      return null;
    })
    .filter((item) => item !== null);

  return filteredData;
};

// ===== 可用性检测 =====
// 「延迟」开关走的是 checkChannel：GET 整条流、等结束再算耗时。这批源里八成是
// live.ottiptv.cc 的 FLV 转发地址，流永远不结束，每条都要卡满 60s 超时才被判死，
// 于是「检测」既慢又全错。这里换成读到首块即断（utils/iptvProbe），
// 结论记在本机，列表据此过滤，频道表本身一条不动。
const probe = reactive({ running: false, done: 0, total: 0, alive: 0, dead: 0, summary: '' });
let probeStop = false;

// 过滤条件变了必须重拉：已加载的列表是滤过的，不清空就被永久删掉了
const reloadChannelList = async () => {
  channelGen += 1;
  pagination.value.pageIndex = 0;
  channelData.value = { list: [], total: 0 };
  infiniteCompleteTip.value = 'noMore';
  isVisible.infiniteLoading = true;
  infiniteId.value++;
  await reloadList();
};

// 把已明确判死的频道就地摘掉；没测过的保留，交给后台补测
const dropDeadChannels = () => {
  const list = channelData.value.list;
  if (!Array.isArray(list) || !list.length) return 0;
  const kept = list.filter((item) => !isDeadChannel(item.url));
  if (kept.length === list.length) return 0;
  const removed = list.length - kept.length;
  channelData.value.list = kept;
  return removed;
};

// 探测只需要地址，其余字段用于回填延迟数字
type ProbeTarget = { url?: string; status?: number | false };

// 探测本页：既供「只显示可播放」过滤，也供「延迟」开关回填耗时。
// 两者共用同一份缓存，避免同一批地址被请求两遍。
const probePage = async (list: ProbeTarget[]) => {
  const pending = (list || []).filter((item) => isProbeable(item?.url) && !getProbe(item.url));
  const needStatus = !!iptvConfig.value.ext.status;
  if (!pending.length) {
    if (needStatus) applyProbeStatus(list);
    return;
  }
  // 全量检测在跑时让它独占状态，这里只默默补测
  const ownsProbe = !probe.running;
  if (ownsProbe) {
    probeStop = false;
    probe.running = true;
    probe.done = 0;
    probe.total = pending.length;
    probe.alive = 0;
  }
  try {
    const result = await probeChannels(
      pending.map((item) => item.url || ''),
      {
        concurrency: 8,
        shouldStop: () => probeStop,
        onProgress: (p) => {
          if (!ownsProbe) return;
          probe.done = p.done;
          probe.total = p.total;
          probe.alive = p.alive;
        },
      },
    );
    mergeProbeCache(result);
    if (needStatus) applyProbeStatus(list);
    if (availableOnly.value) {
      const removed = dropDeadChannels();
      console.log(`[iptv][probe][page] dropped ${removed}`);
    }
  } finally {
    if (ownsProbe) probe.running = false;
  }
};

// 「延迟」标签改用探测结果：旧实现会把无限流一直等到 60s 超时
const applyProbeStatus = (list: ProbeTarget[]) => {
  (list || []).forEach((item) => {
    const hit = getProbe(item?.url);
    if (hit) item.status = hit.ok ? Math.max(1, Math.round(hit.ms)) : false;
  });
};

const availableOnly = computed({
  get: () => !!iptvConfig.value.ext.availableOnly,
  set: (val: boolean) => {
    iptvConfig.value.ext.availableOnly = val;
    updateSetting({ iptvAvailableOnly: val }).catch((err) => console.error('[iptv][availableOnly][save]', err));
    if (!val) {
      // 关掉后要把先前滤掉的频道找回来，否则列表会一直少一截
      void reloadChannelList();
      return;
    }
    dropDeadChannels();
    void probePage(channelData.value.list);
  },
});

const stopProbe = () => {
  if (!probe.running) return;
  probeStop = true;
  MessagePlugin.info(t('pages.iptv.probe.stopping'));
};

// 检测完按新结果重拉第一页，否则当前列表还是过滤前的
const refreshAfterProbe = async () => {
  if (!availableOnly.value) {
    MessagePlugin.success(t('pages.iptv.probe.hintTurnOn'));
    return;
  }
  await reloadChannelList();
};

const probeAllEvent = async () => {
  if (probe.running) return;
  probe.running = true;
  probeStop = false;
  probe.summary = '';
  probe.done = 0;
  probe.total = 0;
  probe.alive = 0;
  probe.dead = 0;
  try {
    // 全量只拉一次：分页拉会让同一批地址被反复去重，反而更慢
    const res = await fetchChannelList(0, 100000, null, null);
    const urls = (res?.data || []).map((item) => item.url);
    if (!urls.length) {
      probe.summary = t('pages.iptv.probe.empty');
      return;
    }
    const result = await probeChannels(urls, {
      concurrency: 8,
      shouldStop: () => probeStop,
      onProgress: (p) => {
        probe.done = p.done;
        probe.total = p.total;
        probe.alive = p.alive;
        probe.dead = p.dead;
      },
    });
    mergeProbeCache(result);
    probe.summary = t('pages.iptv.probe.summary', { dead: probe.dead, total: probe.done });
    if (probeStop) MessagePlugin.info(t('pages.iptv.probe.stopped'));
    await refreshAfterProbe();
  } catch (err) {
    console.error('[iptv][probe][error]', err);
    MessagePlugin.error(t('pages.iptv.probe.fail'));
  } finally {
    probe.running = false;
  }
};

// 缩略图
const generateThumbnail = async (pageIndex: number, pageSize: number) => {
  console.log(`[channel] generateThumbnail`);
  const start = pageIndex * pageSize;
  const end = (pageIndex + 1) * pageSize;
  const dataList = slice(channelData.value.list, start, end); // 从原数组中截取需要处理的数据段

  const updateThumbnail = async (item) => {
    window.electron.ipcRenderer.invoke('ffmpeg-thumbnail', item.url, item.id).then((res) => {
      if (res) {
        const index = findIndex(channelData.value.list, { id: res.key });
        channelData.value.list[index]['thumbnail'] = res.url;
      }
    });
  };

  for (let i = 0; i < dataList.length; i++) {
    const item = dataList[i];

    queue.add(() => {
      updateThumbnail(item);
    });
  }
};

// 清空队列，并终止请求
const clearQueue = () => {
  if (queue.size > 0) {
    console.log(`[queue] clear queuectasks and cancel axios request`);
    queue.pause(); // 暂停队列，阻止新的任务加入
    stopCheckChannel(); // 中止正在执行的任务
    queue.clear(); // 清空队列中的任务
    queue.start(); // 继续接管任务加入
  }
};

// 切换源
const changeDefaultIptvEvent = async (id: string) => {
  if (isVisible.loading) return;
  const item = find(iptvConfig.value.data, { id }) as any;
  if (!item) return;

  isVisible.loading = true;
  try {
    clearQueue();
    const { url, type } = item;
    const docs = await parseChannel(type, url);
    await clearChannel();
    await addChannel(docs);
    await setDefault('defaultIptv', id);

    active.value.nav = id;
    active.value.class = '全部';
    classConfig.value.data = [{ type_id: '全部', type_name: '全部' }];
    // 换了源，上一次的体检结论不再属于这份频道表
    probe.summary = '';
    probe.done = 0;
    probe.total = 0;
    beginListWait();
    channelGen++;
    channelData.value = { list: [], total: 0 };
    infiniteCompleteTip.value = 'noMore';
    isVisible.infiniteLoading = true;
    infiniteId.value++;
    pagination.value.pageIndex = 0;
    MessagePlugin.success(t('pages.iptv.message.setSuccess'));
    void reloadList();
  } catch (err) {
    console.error('[iptv][changeSource][error]', err);
    const msg = err instanceof Error ? err.message : String(err);
    MessagePlugin.error(`${t('pages.iptv.message.setFail')}: ${msg}`);
  } finally {
    isVisible.loading = false;
  }
};

emitter.on('searchIptv', (kw) => {
  console.log('[iptv][bus][receive]', kw);
  searchTxt.value = kw as string;
  searchEvent();
});

const refreshIptvConfig = async () => {
  console.log('[iptv][bus][refresh]');
  infiniteCompleteTip.value = 'noMore';
  searchTxt.value = '';
  classConfig.value.data = [{ type_id: '全部', type_name: '全部' }];
  active.value.class = '全部';
  active.value.nav = '';
  // 配置变了，旧频道不属于新配置，不能再垫底显示
  lastList.value = [];
  beginListWait();
  // 在途的旧请求作废
  channelGen++;
  channelData.value = { list: [], total: 0 };
  await getSetting();
  infiniteId.value++;
  pagination.value.pageIndex = 0;
  if (pageState.value) endListWait();
};

// 右键
const conButtonClick = (item: any, { x, y }: any) => {
  isVisible.contentMenu = true;
  Object.assign(optionsComponent.value, { x, y });
  channelItem.value = item;
};

// 删除
const delChannelEvent = () => {
  const index = channelData.value.list.indexOf(channelItem.value);
  if (index > -1) {
    channelData.value.list.splice(index, 1);
    delChannelItem(channelItem.value.id);
  }
  isVisible.contentMenu = false;
};

// 拷贝
const copyToClipboard = async (content, successMessage, errorMessage) => {
  const res = await copyToClipboardApi(content);
  if (res) {
    MessagePlugin.info(successMessage);
  } else {
    MessagePlugin.warning(errorMessage);
  }
};
const copyChannelEvent = async () => {
  const successMessage = t('pages.iptv.message.copySuccess');
  const errorMessage = t('pages.iptv.message.copyFail');
  await copyToClipboard(channelItem.value.url, successMessage, errorMessage);

  isVisible.contentMenu = false;
};

// 生成台标
const generateLogo = (item) => {
  let url = item.logo;
  if (iptvConfig.value.ext.logo) {
    url = `${iptvConfig.value.ext.logo}${item.name}.png`;
  }
  return url;
};
</script>

<style lang="less" scoped>
.iptv {
  height: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  position: relative;
  overflow: hidden;

  .membership-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    width: 148px;
    border: 2px solid rgba(132, 133, 141, 0.16);
    transition: all 0.3s ease;
    font-size: 14px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 20px;

    .member-name {
      font-size: 12px;
      margin-left: 4px;
    }
  }

  .nav-sub-tab-member-info {
    margin-top: 16px;
  }

  .content {
    // width: calc(100% - 170px);
    min-width: 750px;
    position: relative;
    padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingTB-s);
    background-color: var(--td-bg-color-container);
    border-radius: var(--td-radius-default);
    flex: 1;
    display: flex;
    flex-direction: column;

    .header {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      justify-content: space-between;
      white-space: nowrap;
      flex-shrink: 0;
      width: 100%;
      gap: 12px;

      .header-nav {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .header-tools {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;

        .probe-progress {
          font-size: 12px;
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
        }

        .probe-btn {
          flex-shrink: 0;
        }

        .probe-only {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          cursor: pointer;
          user-select: none;
          opacity: 0.85;
        }
      }
    }

    .container {
      flex: 1;
      height: calc(100% - 58px);
      width: 100%;

      .content-wrapper {
        overflow-y: auto;
        overflow-x: hidden;
        width: 100%;
        height: 100%;
        position: relative;

        .card {
          box-sizing: border-box;
          width: inherit;
          position: relative;
          cursor: pointer;
          border-radius: var(--td-radius-medium);

          .text-hide {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: block;
          }

          .card-main {
            position: relative;
            width: 100%;
            height: 0;
            overflow: hidden;
            border-radius: 7px;
            padding-top: 62%;
            box-shadow: var(--td-shadow-1);
            border: 5px solid #211f20;
            background-color: #373536;

            .card-tag {
              z-index: 15;
              display: flex;
              align-content: center;
              flex-direction: row;
              align-items: center;
              justify-content: center;
              width: 40px;
              height: 15px;
              background-color: rgb(0 0 0 / 60%);
              border-radius: 5px;
              box-shadow: var(--td-shadow-1);
              position: absolute;
              top: 5px;
              right: 5px;

              .status-item {
                font-size: 10px;
              }

              .error {
                color: var(--td-error-color);
              }

              .success {
                color: var(--td-success-color);
              }
            }

            .card-main-item {
              position: absolute;
              top: 0;
              left: 0;
              display: block;
              width: 100%;
              height: 100%;
              border-radius: 5px;
            }
          }

          .card-footer {
            position: relative;
            padding-top: var(--td-comp-paddingTB-s);

            .card-footer-title {
              font-weight: 700;
              line-height: var(--td-line-height-title-medium);
              height: 22px;
            }
          }
        }

        .card:hover {
          .card-footer-title {
            color: var(--td-brand-color);
          }
        }

        // 切分类后新结果还没回来：压暗上一批并挡住点击，
        // 比把网格整个清空再重画少一次视觉断裂
        .card-stale {
          opacity: 0.4;
          filter: saturate(0.6);
          pointer-events: none;
          transition: opacity 0.2s ease;
        }
      }
    }
  }
}

.content-items {
  overflow: hidden;
  width: 100%;

  .content-item {
    float: left;
    box-sizing: border-box;
    width: 92px;
    padding-left: 30px;
    height: 46px;
    cursor: pointer;

    span {
      text-shadow: 0 0 0 rgba(0, 0, 0, 0.2);
      font-size: 15px;
      font-weight: 500;
      display: inline-block;
      width: 62px;
      max-width: 62px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;

      &:hover {
        color: var(--td-brand-color);
      }
    }
  }
}
</style>

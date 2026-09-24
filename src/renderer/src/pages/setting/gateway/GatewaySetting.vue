<template>
  <div class="setting-gateway-container">
    <t-form label-width="110px" label-align="left">
      <t-form-item :label="$t('pages.setting.gateway.status')" name="status">
        <t-space align="center" class="status-row">
          <t-tag :theme="statusTheme" variant="light">{{ statusText }}</t-tag>
          <span v-if="status?.healthy" class="meta">{{ status?.base }}</span>
          <span v-if="status?.jarExists === false" class="warn">
            {{ $t('pages.setting.gateway.jarMissing') }}
          </span>
        </t-space>
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.actions')" name="actions">
        <t-space align="center">
          <span
            class="title"
            :class="{ disabled: status?.running || loading.start }"
            @click="onStart"
          >
            {{ $t('pages.setting.gateway.start') }}
          </span>
          <span
            class="title"
            :class="{ disabled: !status?.running || loading.stop }"
            @click="onStop"
          >
            {{ $t('pages.setting.gateway.stop') }}
          </span>
          <span class="title" :class="{ disabled: loading.restart }" @click="onRestart">
            {{ $t('pages.setting.gateway.restart') }}
          </span>
          <span class="title" :class="{ disabled: loading.refresh }" @click="onRefresh">
            {{ $t('pages.setting.gateway.refresh') }}
          </span>
        </t-space>
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.javaHome')" name="javaHome">
        <div class="java-check">
          <t-space align="center">
            <t-input
              v-model="form.javaHome"
              :placeholder="$t('pages.setting.gateway.javaHomePlaceholder')"
              :style="{ width: '255px' }"
            />
            <span class="title" :class="{ disabled: loading.checkJava }" @click="onCheckJava">
              {{ $t('pages.setting.gateway.checkJava') }}
            </span>
          </t-space>
          <div v-if="javaResult" class="java-check-result">
            <t-tag v-if="javaResult.ok" theme="success" variant="light" class="java-version">
              {{ javaResult.version }}
            </t-tag>
            <t-tag v-else theme="danger" variant="light" class="java-version">
              {{ javaResult.message }}
            </t-tag>
          </div>
        </div>
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.port')" name="port">
        <t-input-number
          v-model="form.port"
          theme="column"
          :min="1"
          :max="65535"
          :style="{ width: '160px' }"
        />
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.host')" name="host">
        <t-input v-model="form.host" placeholder="127.0.0.1" :style="{ width: '255px' }" />
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.token')" name="token">
        <t-input
          v-model="form.token"
          type="password"
          :placeholder="$t('pages.setting.gateway.tokenPlaceholder')"
          :style="{ width: '255px' }"
        />
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.config')" name="config">
        <t-input
          v-model="form.config"
          :placeholder="$t('pages.setting.gateway.configPlaceholder')"
          :style="{ width: '420px', maxWidth: '100%' }"
        />
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.spider')" name="spider">
        <t-input
          v-model="form.spider"
          :placeholder="$t('pages.setting.gateway.spiderPlaceholder')"
          :style="{ width: '420px', maxWidth: '100%' }"
        />
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.dataDir')" name="dataDir">
        <t-input
          v-model="form.dataDir"
          :placeholder="$t('pages.setting.gateway.dataDirPlaceholder')"
          :style="{ width: '420px', maxWidth: '100%' }"
        />
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.autoStart')" name="autoStart">
        <t-radio v-model="form.autoStart" allow-uncheck>
          {{ $t('pages.setting.gateway.autoStartTip') }}
        </t-radio>
      </t-form-item>

      <t-form-item :label="$t('pages.setting.gateway.saveLabel')" name="save">
        <t-space align="center">
          <span class="title" :class="{ disabled: loading.save }" @click="onSave">
            {{ $t('pages.setting.gateway.save') }}
          </span>
          <span class="title" :class="{ disabled: loading.save || loading.restart }" @click="onSaveRestart">
            {{ $t('pages.setting.gateway.saveRestart') }}
          </span>
        </t-space>
      </t-form-item>
    </t-form>

    <t-divider align="left">{{ $t('pages.setting.gateway.logTitle') }}</t-divider>
    <pre class="gateway-log">{{ status?.lastLog || $t('pages.setting.gateway.logEmpty') }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';

import { t } from '@/locales';
import {
  checkGatewayJava,
  fetchGatewayStatus,
  restartGateway,
  saveGatewaySettings,
  startGateway,
  stopGateway,
} from '@/api/gateway';

const form = reactive({
  javaHome: '',
  host: '127.0.0.1',
  port: 9979,
  config: '',
  spider: '',
  dataDir: '',
  autoStart: false,
  token: '',
});

const status = ref<any>(null);
const javaResult = ref<{ ok: boolean; version?: string; message?: string } | null>(null);
const loading = reactive({
  start: false,
  stop: false,
  restart: false,
  refresh: false,
  save: false,
  checkJava: false,
});

let timer: any = null;

const statusTheme = computed(() => {
  if (status.value?.running && status.value?.healthy) return 'success';
  if (status.value?.running) return 'warning';
  return 'default';
});

const statusText = computed(() => {
  if (status.value?.running && status.value?.healthy) return t('pages.setting.gateway.running');
  if (status.value?.running) return t('pages.setting.gateway.starting');
  return t('pages.setting.gateway.stopped');
});

const applySettings = (s: any) => {
  if (!s) return;
  form.javaHome = s.javaHome || '';
  form.host = s.host || '127.0.0.1';
  form.port = Number(s.port) || 9979;
  form.config = s.config || '';
  form.spider = s.spider || '';
  form.dataDir = s.dataDir || '';
  form.autoStart = !!s.autoStart;
  form.token = s.token || '';
};

const refresh = async (applyForm = false) => {
  try {
    status.value = await fetchGatewayStatus();
    if (applyForm && status.value?.settings) applySettings(status.value.settings);
  } catch (e: any) {
    // ignore polling errors
  }
};

const onStart = async () => {
  if (status.value?.running || loading.start) return;
  loading.start = true;
  try {
    status.value = await startGateway();
    await MessagePlugin.success(t('pages.setting.gateway.startOk'));
  } catch (e: any) {
    await MessagePlugin.error(e?.message || t('pages.setting.gateway.startFail'));
  } finally {
    loading.start = false;
    refresh();
  }
};

const onStop = async () => {
  if (!status.value?.running || loading.stop) return;
  loading.stop = true;
  try {
    status.value = await stopGateway();
    await MessagePlugin.success(t('pages.setting.gateway.stopOk'));
  } catch (e: any) {
    await MessagePlugin.error(e?.message || t('pages.setting.gateway.stopFail'));
  } finally {
    loading.stop = false;
    refresh();
  }
};

const onRestart = async () => {
  if (loading.restart) return;
  loading.restart = true;
  try {
    status.value = await restartGateway();
    await MessagePlugin.success(t('pages.setting.gateway.restartOk'));
  } catch (e: any) {
    await MessagePlugin.error(e?.message || t('pages.setting.gateway.restartFail'));
  } finally {
    loading.restart = false;
    refresh();
  }
};

const onRefresh = async () => {
  if (loading.refresh) return;
  loading.refresh = true;
  try {
    await refresh(true);
  } finally {
    loading.refresh = false;
  }
};

const onCheckJava = async () => {
  if (loading.checkJava) return;
  loading.checkJava = true;
  javaResult.value = null;
  try {
    javaResult.value = await checkGatewayJava(form.javaHome);
  } catch (e: any) {
    javaResult.value = { ok: false, message: e?.message || String(e) };
  } finally {
    loading.checkJava = false;
  }
};

const onSave = async () => {
  if (loading.save) return;
  loading.save = true;
  try {
    const saved = await saveGatewaySettings({ ...form, port: Number(form.port) || 9979 });
    applySettings(saved);
    await MessagePlugin.success(t('pages.setting.gateway.saveOk'));
  } catch (e: any) {
    await MessagePlugin.error(e?.message || t('pages.setting.gateway.saveFail'));
  } finally {
    loading.save = false;
  }
};

const onSaveRestart = async () => {
  if (loading.save || loading.restart) return;
  loading.save = true;
  try {
    const saved = await saveGatewaySettings({ ...form, port: Number(form.port) || 9979 });
    applySettings(saved);
    await MessagePlugin.success(t('pages.setting.gateway.saveOk'));
  } catch (e: any) {
    await MessagePlugin.error(e?.message || t('pages.setting.gateway.saveFail'));
    loading.save = false;
    return;
  }
  loading.save = false;
  await onRestart();
};

onMounted(() => {
  refresh(true);
  timer = setInterval(() => refresh(false), 5000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  timer = null;
});
</script>

<style lang="less" scoped>
.setting-gateway-container {
  height: 100%;
  padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingTB-xxl);
  overflow-y: auto;

  :deep(.t-form__label) {
    label {
      font-weight: 500;
    }
  }

  .title {
    color: var(--td-brand-color);
    cursor: pointer;
    font-weight: 500;
  }

  .title.disabled {
    color: var(--td-text-color-disabled);
    cursor: not-allowed;
    pointer-events: none;
  }

  .java-check {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .java-check-result {
    display: flex;
    align-items: center;
    min-height: 24px;
  }

  .java-version {
    max-width: 100%;
    white-space: normal;
    word-break: break-all;
    height: auto;
    min-height: 24px;
    line-height: 1.4;
  }

  .status-row {
    gap: 8px;
  }

  .meta {
    color: var(--td-text-color-secondary);
    font-size: 12px;
  }

  .warn {
    color: var(--td-error-color);
  }

  .gateway-log {
    margin: 0;
    padding: 12px;
    max-height: 220px;
    overflow: auto;
    background: var(--td-bg-color-container-secondary, rgba(0, 0, 0, 0.04));
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
}
</style>

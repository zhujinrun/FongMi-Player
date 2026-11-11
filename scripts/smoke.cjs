/* eslint-env node */
/**
 * 打包产物冒烟测试。
 *
 * 背景：CSP、图标 sprite、i18n 这类问题只在「生产构建 + 打包后」才会暴露，
 * dev 模式永远复现不了。这个脚本直接跑 dist/*-unpacked 里的真实可执行文件，
 * 通过 CDP 读取渲染结果，检查：有没有挂上、有没有空白、图标是否真空、路由是否可用。
 *
 * 用法：
 *   node scripts/smoke.cjs                    # 自动找 dist 下的解包目录
 *   node scripts/smoke.cjs --app=dist/linux-unpacked/fmplayer
 *   node scripts/smoke.cjs --use-user-data    # 复用本机已有配置（默认用临时干净配置）
 *
 * 退出码：0 通过；1 有断言失败；2 启动/连接失败。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'smoke-artifacts');

const argv = process.argv.slice(2);
const argValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const PORT = Number(argValue('port') || process.env.SMOKE_PORT || 9411);
const BOOT_TIMEOUT = Number(argValue('timeout') || 90000);
const KEEP_USER_DATA = hasFlag('use-user-data');

// 首屏 + 主要路由。npm run build 出来的 hash 路由，改 hash 就能切页。
// 只列菜单里能点到的页面。/play/index 虽然在路由表里，但 meta.hidden 且必须带
// ?url=&name= 才有内容，无参打开只是个空播放器壳（约 140 个节点），拿它当独立页面
// 断言必然踩 MIN_NODES —— 那不是白屏，是测法不对，所以单独排除。
const ROUTES = [
  { hash: '/film/index', label: '影视' },
  { hash: '/iptv/index', label: '电视' },
  { hash: '/drive/index', label: '网盘' },
  { hash: '/chase/index', label: '追更' },
  { hash: '/analyze/index', label: '解析' },
  { hash: '/setting/index', label: '设置' },
];

// 页面至少要有这么多 DOM 节点才算渲染成功（空白页约 100 个）
const MIN_NODES = 150;

const log = (...args) => console.log('[smoke]', ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 启动 */

function findExecutable() {
  const explicit = argValue('app');
  if (explicit) {
    const abs = path.resolve(ROOT, explicit);
    if (!fs.existsSync(abs)) throw new Error(`--app 指向的文件不存在: ${abs}`);
    return abs;
  }

  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) throw new Error('dist 目录不存在，请先执行 electron-builder --dir');

  const direct = [
    'win-unpacked/fmplayer.exe',
    'linux-unpacked/fmplayer',
    'mac/fmplayer.app/Contents/MacOS/fmplayer',
    'mac-arm64/fmplayer.app/Contents/MacOS/fmplayer',
    'mac-universal/fmplayer.app/Contents/MacOS/fmplayer',
  ].map((p) => path.join(distDir, p));
  for (const c of direct) if (fs.existsSync(c)) return c;

  // 兜底：任意 *-unpacked 目录下的可执行文件
  for (const dir of fs.readdirSync(distDir)) {
    const full = path.join(distDir, dir);
    if (!fs.statSync(full).isDirectory() || !dir.endsWith('-unpacked')) continue;
    for (const f of fs.readdirSync(full)) {
      const stat = fs.statSync(path.join(full, f));
      if (stat.isFile() && (f.endsWith('.exe') || stat.mode & 0o111)) return path.join(full, f);
    }
  }
  throw new Error('在 dist 下找不到解包后的可执行文件');
}

function prepareUserData() {
  if (KEEP_USER_DATA) return {};
  // 干净的配置目录：避免本机已有源/主题影响节点数与首次启动行为
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmplayer-smoke-'));
  const env = {};
  if (process.platform === 'win32') {
    env.APPDATA = dir;
    env.LOCALAPPDATA = path.join(dir, 'local');
  } else if (process.platform === 'darwin') {
    env.HOME = dir;
  } else {
    env.XDG_CONFIG_HOME = dir;
    env.XDG_CACHE_HOME = path.join(dir, 'cache');
    env.HOME = dir;
  }
  return { dir, env };
}

function launch(exe) {
  const { dir, env } = prepareUserData();
  const args = [
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--disable-software-rasterizer',
  ];
  const child = spawn(exe, args, {
    cwd: path.dirname(exe),
    // ELECTRON_RUN_AS_NODE 会把它变成 node 进程，GUI 根本不会启动
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const out = [];
  const push = (chunk) => {
    out.push(chunk.toString());
    if (out.length > 200) out.shift();
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);

  return { child, dataDir: dir, tail: () => out.join('').slice(-4000) };
}

/* -------------------------------------------------------------- CDP 客户端 */

const consoleLog = [];

function classify(text) {
  const t = String(text || '');
  // 离线/无源的请求失败属于预期噪声，不算渲染失败
  if (
    /Failed to fetch|net::ERR_|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_FAILED|NetworkError|AbortError|Failed to load resource|请求超时|timeout of/i.test(
      t,
    )
  ) {
    return 'ignore';
  }
  if (
    /Content Security Policy|Refused to evaluate|EvalError|Maximum call stack|Failed to resolve component|is not defined|Cannot read propert|Cannot read properties|is not a function|Unable to load preload script|Cannot find module|Failed to mount/i.test(
      t,
    )
  ) {
    return 'fail';
  }
  return 'warn';
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('CDP 连接已关闭'));
      this.pending.clear();
    });
  }

  static open(url) {
    return new Promise((resolve, reject) => {
      const Ws = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
      const ws = new Ws(url);
      const timer = setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), 15000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`CDP WebSocket 连接失败: ${e.message || e.type}`));
      });
    });
  }

  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails || {};
      consoleLog.push({ kind: 'exception', text: d.exception?.description || d.text || 'unknown exception' });
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
        .join(' ');
      consoleLog.push({ kind: 'console.error', text });
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleLog.push({ kind: `log.${msg.params.entry.source}`, text: msg.params.entry.text });
    }
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('CDP 连接已关闭'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, 20000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`页面执行异常: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res.result?.value;
  }
}

async function waitForTarget() {
  const deadline = Date.now() + BOOT_TIMEOUT;
  let lastList = [];
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { cache: 'no-store' });
      lastList = await res.json();
    } catch {
      lastList = [];
    }
    const target = lastList.find(
      (t) => t.type === 'page' && t.webSocketDebuggerUrl && /out[\\/]renderer[\\/]index\.html/.test(t.url || ''),
    );
    if (target) return target;
    await sleep(1000);
  }
  const seen = lastList.map((t) => `${t.type}:${t.url}`).join('\n  ') || '(无调试目标)';
  throw new Error(`等待主窗口超时（${BOOT_TIMEOUT}ms）。当前调试目标:\n  ${seen}`);
}

/* ------------------------------------------------------------ 页面探针 */

const PROBE = `(() => {
  const app = document.getElementById('app');
  const rect = app ? app.getBoundingClientRect() : { width: 0, height: 0 };
  const icons = [...document.querySelectorAll('svg.t-icon')];
  const emptyIcons = icons.filter((s) => s.children.length === 0 && !s.innerHTML.trim()).length;
  const images = [...document.querySelectorAll('img')];
  const brokenLocal = images.filter((i) => {
    const src = i.currentSrc || i.getAttribute('src') || '';
    return /^(file:|data:)/.test(src) && i.complete && i.naturalWidth === 0;
  }).length;
  const menu = [...document.querySelectorAll('.t-menu__item')];
  const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim();
  // i18n 失效时页面上会直接出现消息 key（如 pages.film.index.title），这是最直接的信号
  const rawKeys = text.match(/\\b(?:pages|componentsLocale)\\.[A-Za-z0-9_.]+/g) || [];
  return {
    hash: location.hash,
    href: location.href.replace(/^.*index\\.html/, 'index.html'),
    appWidth: Math.round(rect.width),
    appHeight: Math.round(rect.height),
    nodes: document.querySelectorAll('*').length,
    textLength: text.length,
    textHead: text.slice(0, 60),
    icons: icons.length,
    emptyIcons,
    brokenLocal,
    menuItems: menu.length,
    rawKeys: rawKeys.slice(0, 3),
    rawKeyCount: rawKeys.length,
  };
})()`;

async function waitForMount(cdp) {
  const deadline = Date.now() + 45000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await cdp.evaluate(PROBE);
      if (last.nodes >= MIN_NODES && last.appWidth > 0 && last.appHeight > 0) return last;
    } catch {
      /* 页面还在导航，继续等 */
    }
    await sleep(700);
  }
  return last;
}

async function waitForRoute(cdp, hash) {
  const deadline = Date.now() + 15000;
  const want = `#${hash}`;
  let last = null;
  // 先等 hash 真的切过去：只判节点数会读到「上一页」的状态，等于没测
  while (Date.now() < deadline) {
    try {
      last = await cdp.evaluate(PROBE);
      if (last.hash === want || last.hash.startsWith(`${want}?`)) break;
    } catch {
      /* 页面切换中，重试 */
    }
    await sleep(300);
  }
  // 再给列表/异步 chunk 一点渲染时间
  await sleep(700);
  try {
    last = await cdp.evaluate(PROBE);
  } catch {
    /* 保留上一次结果 */
  }
  return last;
}

async function screenshot(cdp, name) {
  try {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (!res?.data) return null;
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const file = path.join(ARTIFACT_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    return file;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const exe = findExecutable();
  log(`目标: ${path.relative(ROOT, exe)}`);
  log(`调试端口: ${PORT}`);

  const app = launch(exe);
  let cdp = null;
  let exitCode = 1;

  try {
    const target = await waitForTarget();
    log(`已连接: ${target.url.replace(/^.*index\.html/, 'index.html')}`);

    cdp = await Cdp.open(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');

    const mounted = await waitForMount(cdp);
    if (!mounted) throw new Error('页面始终没有挂载（#app 为空）');

    const problems = [];
    const push = (msg) => problems.push(msg);

    // 首屏
    const initial = mounted;
    log(`首屏: ${initial.nodes} 节点, #app ${initial.appWidth}x${initial.appHeight}, hash=${initial.hash || '(空)'}`);

    if (initial.nodes < MIN_NODES) push(`首屏 DOM 节点过少 (${initial.nodes} < ${MIN_NODES})，疑似白屏`);
    if (initial.appWidth === 0 || initial.appHeight === 0) push('首屏 #app 尺寸为 0');
    if (initial.emptyIcons > 0) push(`首屏有 ${initial.emptyIcons}/${initial.icons} 个空图标`);
    if (initial.brokenLocal > 0) push(`首屏有 ${initial.brokenLocal} 张本地图片加载失败`);
    if (initial.menuItems === 0) push('首屏左侧菜单没有渲染出来');
    if (initial.rawKeyCount > 0) push(`首屏出现未翻译的消息 key: ${initial.rawKeys.join(', ')}`);
    // 启动阶段（i18n 编译、首屏渲染）的报错单独收一遍
    for (const e of consoleLog.filter((x) => classify(x.text) === 'fail')) {
      push(`首屏: ${e.kind} — ${e.text.split('\n')[0].slice(0, 220)}`);
    }
    await screenshot(cdp, '00-initial');

    const seen = new Set();
    for (let i = 0; i < ROUTES.length; i++) {
      const route = ROUTES[i];
      consoleLog.length = 0;
      await cdp.evaluate(`location.hash = '#${route.hash}'`);
      const probe = await waitForRoute(cdp, route.hash);
      const name = `${String(i + 1).padStart(2, '0')}-${route.hash.replace(/[/]/g, '-').replace(/^-/, '')}`;

      if (!probe) {
        push(`${route.label} (${route.hash}): 切换后没有拿到页面状态`);
        continue;
      }

      const errors = consoleLog.filter((e) => classify(e.text) === 'fail');
      const warns = consoleLog.filter((e) => classify(e.text) === 'warn');

      log(
        `${route.label.padEnd(4, ' ')} ${route.hash.padEnd(16, ' ')} 节点=${String(probe.nodes).padStart(4, ' ')} ` +
          `图标=${probe.icons} 空图标=${probe.emptyIcons} 本地破图=${probe.brokenLocal} 报错=${errors.length}`,
      );

      if (!probe.hash.startsWith(`#${route.hash}`)) {
        push(`${route.label}: 切换后仍停在 ${probe.hash || '(空 hash)'}，路由未生效`);
      }
      if (probe.nodes < MIN_NODES) push(`${route.label}: DOM 只有 ${probe.nodes} 个节点，页面没渲染`);
      if (probe.appWidth === 0 || probe.appHeight === 0) push(`${route.label}: #app 尺寸为 0`);
      if (probe.emptyIcons > 0)
        push(`${route.label}: ${probe.emptyIcons}/${probe.icons} 个图标是空的（sprite 未加载）`);
      if (probe.brokenLocal > 0) push(`${route.label}: ${probe.brokenLocal} 张本地图片加载失败`);
      if (probe.textLength < 5) push(`${route.label}: 页面文本为空`);
      if (probe.rawKeyCount > 0) push(`${route.label}: 出现未翻译的消息 key: ${probe.rawKeys.join(', ')}`);
      for (const e of errors) push(`${route.label}: ${e.kind} — ${e.text.split('\n')[0].slice(0, 220)}`);
      for (const w of warns) log(`  (warn) ${w.text.split('\n')[0].slice(0, 160)}`);

      if (seen.has(probe.hash)) {
        // 同一路由重复出现不一定是问题（部分路由会重定向），仅提示
        log(`  (info) ${route.hash} 最终落在 ${probe.hash}`);
      }
      seen.add(probe.hash);

      if (hasFlag('shots')) await screenshot(cdp, name);
    }

    // 坏 hash 兜底：不允许无限重定向 / 卡在空白
    consoleLog.length = 0;
    await cdp.evaluate(`location.hash = '#/smoke/broken/deep/link'`);
    // 等兜底重定向真的发生，而不是死等固定时间后读到旧页面
    let fallback = null;
    const redirectDeadline = Date.now() + 8000;
    while (Date.now() < redirectDeadline) {
      fallback = await cdp.evaluate(PROBE);
      if (fallback.hash && fallback.hash !== '#/smoke/broken/deep/link') break;
      await sleep(300);
    }
    await sleep(500);
    fallback = await cdp.evaluate(PROBE);
    if (fallback.nodes < MIN_NODES) push(`坏 hash 兜底失败：只剩 ${fallback.nodes} 个节点`);
    if (!fallback.hash || fallback.hash === '#/smoke/broken/deep/link') {
      push('坏 hash 没有触发兜底重定向，页面停在不存在的路由上');
    }
    if (fallback.rawKeyCount > 0) push(`坏 hash 兜底后出现未翻译的消息 key: ${fallback.rawKeys.join(', ')}`);
    const fallbackErrors = consoleLog.filter((e) => classify(e.text) === 'fail');
    for (const e of fallbackErrors) push(`坏 hash 兜底: ${e.kind} — ${e.text.split('\n')[0].slice(0, 220)}`);
    log(`坏 hash 兜底 → ${fallback.hash || '(空)'} (${fallback.nodes} 节点)`);

    if (problems.length) {
      console.error(`\n[smoke] FAIL — ${problems.length} 个问题:`);
      for (const p of problems) console.error(`  ✗ ${p}`);
      await screenshot(cdp, '99-failure');
      if (!hasFlag('shots')) await screenshot(cdp, '99-failure-state');
      exitCode = 1;
    } else {
      console.log('\n[smoke] PASS — 打包产物渲染正常，所有路由无空图标/白屏/致命报错');
      exitCode = 0;
    }
  } catch (err) {
    console.error(`\n[smoke] ERROR — ${err.message}`);
    exitCode = 2;
  } finally {
    if (cdp) cdp.close();
    try {
      app.child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    const tail = app.tail();
    if (exitCode !== 0 && tail.trim()) {
      console.error('\n--- 应用输出（尾部）---');
      console.error(tail.trim().split('\n').slice(-25).join('\n'));
    }
    if (!KEEP_USER_DATA) {
      try {
        fs.rmSync(app.dataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  // 应用可能留下子进程，强制退出避免 CI 挂住
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('[smoke] 未捕获异常:', e);
  process.exit(2);
});

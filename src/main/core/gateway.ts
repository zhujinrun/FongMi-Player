import { app } from 'electron';
import { spawn, ChildProcess, execFile, exec, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import { join, isAbsolute, delimiter } from 'path';

import logger from './logger';
import { setting } from './db/service';

export type GatewayConfigSource = {
  name: string;
  url: string;
};

export type GatewaySettings = {
  javaHome: string;
  host: string;
  port: number;
  config: string;
  configHistory: GatewayConfigSource[];
  spider: string;
  dataDir: string;
  autoStart: boolean;
  token: string;
};

const DEFAULT_CONFIG_HISTORY: GatewayConfigSource[] = [
  { name: '饭太硬', url: 'http://www.饭太硬.cc/tv' },
  { name: '王二小', url: 'https://9280.kstore.vip/newwex.json' },
];

/**
 * The 牛二 vanity hosts now 302 to an HTML landing page instead of a TVBox JSON.
 * The only endpoints that still return the config are the direct links on 9280.kstore.vip
 * (the landing page itself lists them as "牛二(新接口防屏蔽)" / "牛二(凯速)").
 * Rewrite the dead hosts on read so existing installs pick up the fix without a DB migration.
 */
const STALE_CONFIG_HOSTS = new Set([
  'tvbox.王二小放牛娃.top',
  'tvbox.xn--4kq62z5rby2qupq9ub.top',
  'tv.999888987.xyz',
  'tv.999888123.xyz',
  'new.王二小放牛娃.top',
  'new.xn--4kq62z5rby2qupq9ub.top',
  'ai.王二小放牛娃.top',
  'ai.xn--4kq62z5rby2qupq9ub.top',
]);
const STALE_CONFIG_FALLBACK = 'https://9280.kstore.vip/newwex.json';

export function rewriteStaleConfigUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return raw;
  }
  return STALE_CONFIG_HOSTS.has(host) ? STALE_CONFIG_FALLBACK : raw;
}

const DEFAULTS: GatewaySettings = {
  javaHome: '',
  host: '0.0.0.0',
  port: 9979,
  config: '',
  configHistory: DEFAULT_CONFIG_HISTORY,
  spider: '',
  dataDir: '',
  autoStart: false,
  token: '',
};

export function configNameOf(url: string): string {
  const raw = String(url || '').trim();
  const m = raw.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
  return m ? m[1] : raw;
}

export function mergeConfigHistory(history: unknown, config?: string): GatewayConfigSource[] {
  const list: GatewayConfigSource[] = [];
  const push = (h: unknown) => {
    const rec = (h || {}) as { url?: unknown; name?: unknown };
    const url = rewriteStaleConfigUrl(String(rec.url || '').trim());
    if (!url) return;
    const given = String(rec.name || '').trim();
    const idx = list.findIndex((x) => x.url === url);
    if (idx >= 0) {
      // Prefer an explicit name over a hostname-derived one ("王二小" beats "9280.kstore.vip").
      const cur = list[idx].name;
      if (given && (!cur || cur === configNameOf(list[idx].url))) list[idx].name = given;
      return;
    }
    list.push({ name: given || configNameOf(url), url });
  };
  // Built-in presets first so they always appear with their canonical names/URLs,
  // then whatever the user has accumulated on top of them.
  DEFAULT_CONFIG_HISTORY.forEach(push);
  if (Array.isArray(history)) history.forEach(push);
  const cur = rewriteStaleConfigUrl(String(config || '').trim());
  if (cur) {
    const idx = list.findIndex((x) => x.url === cur);
    if (idx > 0) {
      const [hit] = list.splice(idx, 1);
      list.unshift(hit);
    } else if (idx < 0) {
      list.unshift({ name: configNameOf(cur), url: cur });
    }
  }
  return list.slice(0, 50);
}

let child: ChildProcess | null = null;
let stopping = false;
let lastLog = '';

export function getGatewaySettings(): GatewaySettings {
  const raw = setting.find({ key: 'gateway' }).value;
  const base: GatewaySettings =
    raw && typeof raw === 'object'
      ? { ...DEFAULTS, ...(raw as Partial<GatewaySettings>) }
      : { ...DEFAULTS };
  // Self-heal stale 牛二 vanity URLs on read so the config dropdown and the
  // active config both move to the working endpoint without a one-shot migration.
  return {
    ...base,
    config: rewriteStaleConfigUrl(base.config),
    configHistory: mergeConfigHistory(base.configHistory, rewriteStaleConfigUrl(base.config)),
  };
}

export function saveGatewaySettings(patch: Partial<GatewaySettings>): GatewaySettings {
  const next = { ...getGatewaySettings(), ...patch };
  if (typeof next.port === 'string') next.port = Number(next.port) || 9979;
  next.configHistory = mergeConfigHistory(next.configHistory, next.config);
  const existing = setting.find({ key: 'gateway' });
  if (existing?.key === 'gateway') {
    setting.update_data('gateway', { value: next });
  } else {
    setting.add({ key: 'gateway', value: next });
  }
  return next;
}

export function getGatewayToken(): string {
  return String(getGatewaySettings().token || '');
}

// 首次启动若 token 为空则自动生成随机 token 并持久化（网关对局域网开放，token 是唯一凭据）
function ensureGatewayToken(): string {
  const current = getGatewayToken();
  if (current) return current;
  const token = crypto.randomBytes(16).toString('hex');
  saveGatewaySettings({ token });
  logger.info('[gateway] generated random token for gateway api');
  return token;
}

function resolveJarPath(): string {
  const name = process.platform === 'win32' ? 'gateway.jar' : 'gateway.jar';
  const candidates = [
    join(process.resourcesPath || '', 'gateway', name),
    join(process.resourcesPath || '', 'resources', 'gateway', name),
    join(app.getAppPath(), 'resources', 'gateway', name),
    join(process.cwd(), 'resources', 'gateway', name),
    join(__dirname, '../../resources/gateway/gateway.jar'),
    join(__dirname, '../../../resources/gateway/gateway.jar'),
  ];
  for (const p of candidates) {
    if (!p) continue;
    const real = p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
    try {
      if (real && fs.pathExistsSync(real)) return real;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function findJavaInDir(dir: string): string {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  try {
    if (dir && fs.pathExistsSync(join(dir, 'bin', exe))) return join(dir, 'bin', exe);
    if (dir && fs.pathExistsSync(join(dir, exe))) return join(dir, exe);
  } catch {
    /* ignore */
  }
  return '';
}

function findJavaOnPath(): string {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const pathEnv = process.env.PATH || process.env.Path || '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      // macOS 的 /usr/bin/java 只是 stub：没装 JDK 时它也存在，执行只会弹「需要安装 Java」，
      // 拿它去 spawn 网关等于拿到一个静默失败的进程
      if (process.platform === 'darwin' && dir.trim() === '/usr/bin') continue;
      const p = join(dir.trim(), exe);
      if (fs.pathExistsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function findJavaInCommon(): string {
  if (process.platform !== 'win32') return '';
  const roots = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'D:\\Program Files',
    'D:\\Program Files (x86)',
  ].filter(Boolean) as string[];
  const subdirs = ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru'];
  const hits: string[] = [];
  for (const root of roots) {
    for (const sub of subdirs) {
      try {
        const base = join(root, sub);
        if (!fs.pathExistsSync(base)) continue;
        for (const ent of fs.readdirSync(base)) {
          hits.push(join(base, ent));
        }
      } catch {
        /* ignore */
      }
    }
  }
  // 较新版本优先
  hits.sort().reverse();
  for (const h of hits) {
    const bin = findJavaInDir(h);
    if (bin) return bin;
  }
  return '';
}

// macOS 上 JDK 的落点和 Windows 完全不同，也不保证在 PATH 上（Finder 启动的 app 只有
// fixPath 补过的最小 PATH）。按可信度收集候选：
// 1) /usr/libexec/java_home —— 系统的 JVM 注册表，装了任一发行版都能问到
// 2) /Library/Java/JavaVirtualMachines 与 ~/Library/.../JavaVirtualMachines —— .pkg 安装位置
// 3) Homebrew（Apple Silicon 在 /opt/homebrew，Intel 在 /usr/local）与 SDKMAN
function findJavaOnMac(): string[] {
  const homes: string[] = [];
  const addHome = (home: string) => {
    if (home && !homes.includes(home)) homes.push(home);
  };
  const listDir = (dir: string): string[] => {
    try {
      return dir && fs.pathExistsSync(dir) ? fs.readdirSync(dir) : [];
    } catch {
      return [];
    }
  };

  const javaHomeTool = '/usr/libexec/java_home';
  if (fs.pathExistsSync(javaHomeTool)) {
    // 不带 -v 即返回已注册的最高版本；只问一次，避免轮询时反复拉起子进程
    try {
      const out = execFileSync(javaHomeTool, [], { timeout: 5000, encoding: 'utf8' }).trim();
      addHome(out);
    } catch {
      /* 未安装或未注册，交给下面的目录扫描兜底 */
    }
  }

  const home = process.env.HOME || '';
  for (const base of ['/Library/Java/JavaVirtualMachines', join(home, 'Library/Java/JavaVirtualMachines')]) {
    for (const ent of listDir(base)) addHome(join(base, ent, 'Contents', 'Home'));
  }
  for (const prefix of ['/opt/homebrew/opt', '/usr/local/opt']) {
    for (const ent of listDir(prefix)) {
      if (/^openjdk/i.test(ent)) addHome(join(prefix, ent, 'libexec', 'openjdk.jdk', 'Contents', 'Home'));
    }
  }
  const sdkman = join(home, '.sdkman', 'candidates', 'java');
  for (const ent of listDir(sdkman)) addHome(join(sdkman, ent));

  return homes.map((h) => findJavaInDir(h)).filter(Boolean);
}

// 候选必须真的能跑 -version 才算数：stub、残留下载的损坏目录都会在这里被筛掉
function javaUsable(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { timeout: 6000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// gatewayStatus() 会随前端轮询反复调用探测，macOS 上每次探测要拉起 java_home 和一次
// `java -version` 验证，代价不低。这里做 10 秒短缓存；用户主动点「检测」时走 fresh 跳过缓存
const JAVA_BIN_TTL = 10_000;
let javaBinCache: { key: string; bin: string; at: number } | null = null;

function resolveJavaBin(javaHome: string, fresh = false): string {
  const key = `${javaHome}|${process.env.JAVA_HOME || ''}|${process.env.PATH || process.env.Path || ''}`;
  if (!fresh && javaBinCache && javaBinCache.key === key && Date.now() - javaBinCache.at < JAVA_BIN_TTL) {
    return javaBinCache.bin;
  }
  const bin = resolveJavaBinUncached(javaHome);
  javaBinCache = { key, bin, at: Date.now() };
  return bin;
}

function resolveJavaBinUncached(javaHome: string): string {
  const fromHome = [(javaHome || '').trim(), (process.env.JAVA_HOME || '').trim()]
    .filter(Boolean)
    .map((h) => findJavaInDir(h))
    .find(Boolean);

  if (process.platform === 'darwin') {
    // 显式配置优先，其次是 JDK 常见安装位置（比 PATH 可靠），最后才是 PATH
    const candidates = [fromHome, ...findJavaOnMac(), findJavaOnPath()].filter(Boolean) as string[];
    const usable = candidates.find(javaUsable);
    return usable || 'java';
  }

  if (fromHome) return fromHome;
  const fromPath = findJavaOnPath();
  if (fromPath) return fromPath;
  const fromCommon = findJavaInCommon();
  if (fromCommon) return fromCommon;
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function resolveDataDir(dataDir: string): string {
  const d = (dataDir || '').trim();
  if (!d) return join(app.getPath('userData'), 'gateway-data');
  return isAbsolute(d) ? d : join(app.getPath('userData'), d);
}

export function isRunning(): boolean {
  return !!(child && !child.killed && child.exitCode === null);
}

export function gatewayBase(): string {
  const s = getGatewaySettings();
  const host = s.host === '0.0.0.0' ? '127.0.0.1' : s.host || '127.0.0.1';
  return `http://${host}:${s.port || 9979}`;
}

// 判定 URL 是否指向本网关（loopback + 同端口，兼容 jar 生成的 127.0.0.1/localhost URL）
export function isGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:') return false;
    const base = new URL(gatewayBase());
    if (parsed.origin === base.origin) return true;
    return parsed.port === base.port && ['127.0.0.1', 'localhost', '0.0.0.0'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

// 网关启用 token 后所有端点强制 ?token= 校验：仅对本网关 origin 追加，外网/外部网关 URL 不受影响
export function withGatewayToken(url: string): string {
  try {
    const token = getGatewayToken();
    if (!token) return url;
    const parsed = new URL(url);
    const base = new URL(gatewayBase());
    if (parsed.origin !== base.origin) return url;
    if (parsed.searchParams.has('token')) return url;
    parsed.searchParams.set('token', token);
    return parsed.toString();
  } catch {
    return url;
  }
}

async function probeHealth(timeoutMs = 3000): Promise<any | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(withGatewayToken(`${gatewayBase()}/health`), { signal: ac.signal });
      const body: any = await res.json();
      return body?.data ?? body;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

function pidListening(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === 'win32'
        ? `netstat -ano -p tcp`
        : `sh -c "netstat -tlnp 2>/dev/null | grep ':${port} ' || true"`;
    exec(cmd, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const lines = String(stdout).split(/\r?\n/);
      for (const line of lines) {
        if (!line.includes(`:${port}`)) continue;
        if (!/LISTENING|LISTEN/i.test(line)) continue;
        if (process.platform === 'win32') {
          const parts = line.trim().split(/\s+/);
          const pid = Number(parts[parts.length - 1]);
          if (Number.isFinite(pid) && pid > 0) {
            resolve(pid);
            return;
          }
        } else {
          const m = line.match(/\/(\d+)(?:\/\w+)?\s*$/);
          if (m) {
            resolve(Number(m[1]));
            return;
          }
        }
      }
      resolve(null);
    });
  });
}

async function killPid(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    if (process.platform === 'win32') {
      exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true, timeout: 5000 }, () => resolve());
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

export async function gatewayStatus() {
  const s = getGatewaySettings();
  const jar = resolveJarPath();
  const health = await probeHealth();
  const managed = isRunning();
  const healthy = !!health?.ok;
  return {
    // 端口在听且 /health 正常即视为运行（含外部启动/主进程重载后失去 child 句柄）
    running: managed || healthy,
    managed,
    healthy,
    pid: child?.pid ?? null,
    jarPath: jar,
    jarExists: !!jar,
    base: gatewayBase(),
    settings: s,
    health,
    lastLog: lastLog.slice(-4000),
    javaBin: resolveJavaBin(s.javaHome),
  };
}

function appendLog(chunk: Buffer | string) {
  lastLog = `${lastLog}${chunk}`;
  if (lastLog.length > 32000) lastLog = lastLog.slice(-16000);
}

export async function startGateway(override?: Partial<GatewaySettings>): Promise<any> {
  if (isRunning()) {
    return gatewayStatus();
  }
  const existing = await probeHealth(1500);
  if (existing?.ok) {
    return gatewayStatus();
  }
  const base = getGatewaySettings();
  const s: GatewaySettings = { ...base, ...(override || {}) };
  if (typeof s.port === 'string') s.port = Number(s.port) || 9979;
  if (!String(s.token || '').trim()) s.token = ensureGatewayToken();
  const jar = resolveJarPath();
  if (!jar) throw new Error('gateway.jar not found under resources/gateway');
  const javaBin = resolveJavaBin(s.javaHome);
  const javaResolved = javaBin.includes('/') || javaBin.includes('\\');
  if (!javaResolved) {
    // 之前只对 Windows 报错，mac/linux 会带着一个裸 'java' 去 spawn，ENOENT 之后
    // 网关静默起不来，用户只看到「源无数据」，找不到原因
    throw new Error(
      process.platform === 'darwin'
        ? 'java not found. 请先安装 JRE/JDK（推荐 Temurin 21: brew install --cask temurin），或在网关设置里填写 Java Home（例如 /Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home）'
        : 'java.exe not found. Install JRE/JDK and set Java Home in gateway settings (e.g. C:\\Program Files\\Eclipse Adoptium\\jdk-21.x.x)',
    );
  }
  const dataDir = resolveDataDir(s.dataDir);
  await fs.ensureDir(dataDir);

  const args = [
    '-Dstdout.encoding=UTF-8',
    '-Dstderr.encoding=UTF-8',
    '-jar',
    jar,
    '--host',
    String(s.host || '0.0.0.0'),
    '--port',
    String(s.port || 9979),
    '--data',
    dataDir,
  ];
  if (s.config) args.push('--config', s.config);
  if (s.spider) args.push('--spider', s.spider);
  if (s.token) args.push('--token', s.token);

  logger.info(`[gateway] start ${javaBin} ${args.join(' ')}`);
  stopping = false;
  const spawned = spawn(javaBin, args, {
    cwd: process.resourcesPath || app.getAppPath(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(s.javaHome ? { JAVA_HOME: s.javaHome } : {}),
    },
  });
  child = spawned;

  spawned.stdout?.on('data', (d) => {
    appendLog(d);
    logger.info(`[gateway] ${String(d).trimEnd()}`);
  });
  spawned.stderr?.on('data', (d) => {
    appendLog(d);
    logger.info(`[gateway] ${String(d).trimEnd()}`);
  });
  spawned.on('error', (err) => {
    const msg = `spawn ${javaBin} failed: ${err.message}`;
    appendLog(`${msg}\n`);
    logger.error(`[gateway] ${msg}`);
    // 只清理仍指向本进程的句柄：stopGateway 超时后可能已换新实例，旧进程迟到的事件不能抹掉它
    if (child === spawned) child = null;
  });
  spawned.on('exit', (code, signal) => {
    appendLog(`exit code=${code} signal=${signal}\n`);
    logger.info(`[gateway] exit code=${code} signal=${signal}`);
    if (child === spawned) child = null;
  });

  // wait briefly for /health
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (!isRunning()) break;
    const h = await probeHealth(500);
    if (h?.ok) break;
  }
  return gatewayStatus();
}

export async function stopGateway(): Promise<any> {
  if (child) {
    stopping = true;
    const pid = child.pid;
    logger.info(`[gateway] stop pid=${pid}`);
    child.kill();
    for (let i = 0; i < 20; i++) {
      if (!isRunning()) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (isRunning() && pid) {
      try {
        process.kill(pid as number);
      } catch {
        /* ignore */
      }
    }
    child = null;
    stopping = false;
    return gatewayStatus();
  }

  // 未托管但端口仍在听（外部启动/句柄丢失）→ 按端口杀
  const s = getGatewaySettings();
  const port = s.port || 9979;
  const pid = await pidListening(port);
  if (pid) {
    logger.info(`[gateway] stop unmanaged pid=${pid} port=${port}`);
    await killPid(pid);
    for (let i = 0; i < 20; i++) {
      const h = await probeHealth(400);
      if (!h?.ok) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return gatewayStatus();
}

export async function restartGateway(override?: Partial<GatewaySettings>): Promise<any> {
  if (isRunning()) await stopGateway();
  return startGateway(override);
}

export async function checkJava(javaHome: string): Promise<{ ok: boolean; version?: string; message?: string }> {
  const bin = resolveJavaBin(javaHome, true);
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 8000 }, (err, _stdout, stderr) => {
      if (err) {
        resolve({ ok: false, message: err.message });
        return;
      }
      const text = String(stderr || _stdout || '');
      const m = text.match(/version\s+"([^"]+)"/i);
      resolve({ ok: true, version: m ? m[1] : text.split('\n')[0] });
    });
  });
}

export function disposeGateway() {
  stopping = true;
  try {
    child?.kill();
  } catch {
    /* ignore */
  }
  child = null;
}

export function isStopping() {
  return stopping;
}

import { app } from 'electron';
import { spawn, ChildProcess, execFile, exec } from 'child_process';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import { join, isAbsolute } from 'path';

import logger from './logger';
import { setting } from './db/service';

export type GatewaySettings = {
  javaHome: string;
  host: string;
  port: number;
  config: string;
  spider: string;
  dataDir: string;
  autoStart: boolean;
  token: string;
};

const DEFAULTS: GatewaySettings = {
  javaHome: '',
  host: '127.0.0.1',
  port: 9979,
  config: '',
  spider: '',
  dataDir: '',
  autoStart: false,
  token: '',
};

let child: ChildProcess | null = null;
let stopping = false;
let lastLog = '';

export function getGatewaySettings(): GatewaySettings {
  const raw = setting.find({ key: 'gateway' }).value;
  if (raw && typeof raw === 'object') {
    return { ...DEFAULTS, ...(raw as Partial<GatewaySettings>) };
  }
  return { ...DEFAULTS };
}

export function saveGatewaySettings(patch: Partial<GatewaySettings>): GatewaySettings {
  const next = { ...getGatewaySettings(), ...patch };
  if (typeof next.port === 'string') next.port = Number(next.port) || 9979;
  const existing = setting.find({ key: 'gateway' });
  if (existing?.key === 'gateway') {
    setting.update_data('gateway', { value: next });
  } else {
    setting.add({ key: 'gateway', value: next });
  }
  return next;
}

function resolveJarPath(): string {
  const candidates = [
    join(app.getAppPath(), 'resources', 'gateway', 'gateway.jar'),
    join(process.cwd(), 'resources', 'gateway', 'gateway.jar'),
    join(__dirname, '../../resources/gateway/gateway.jar'),
  ];
  for (const p of candidates) {
    const real = p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
    try {
      if (fs.pathExistsSync(real)) return real;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function resolveJavaBin(javaHome: string): string {
  const home = (javaHome || '').trim();
  if (home) {
    const bin = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.pathExistsSync(bin)) return bin;
  }
  return 'java';
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

async function probeHealth(timeoutMs = 3000): Promise<any | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(`${gatewayBase()}/health`, { signal: ac.signal });
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
  return new Promise(resolve => {
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
  await new Promise<void>(resolve => {
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

export async function startGateway(): Promise<any> {
  if (isRunning()) {
    return gatewayStatus();
  }
  const existing = await probeHealth(1500);
  if (existing?.ok) {
    return gatewayStatus();
  }
  const s = getGatewaySettings();
  const jar = resolveJarPath();
  if (!jar) throw new Error('gateway.jar not found under resources/gateway');
  const javaBin = resolveJavaBin(s.javaHome);
  const dataDir = resolveDataDir(s.dataDir);
  await fs.ensureDir(dataDir);

  const args = ['-jar', jar, '--host', String(s.host || '127.0.0.1'), '--port', String(s.port || 9979), '--data', dataDir];
  if (s.config) args.push('--config', s.config);
  if (s.spider) args.push('--spider', s.spider);
  if (s.token) args.push('--token', s.token);

  logger.info(`[gateway] start ${javaBin} ${args.join(' ')}`);
  stopping = false;
  child = spawn(javaBin, args, {
    cwd: app.getAppPath(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(s.javaHome ? { JAVA_HOME: s.javaHome } : {}),
    },
  });

  child.stdout?.on('data', d => {
    appendLog(d);
    logger.info(`[gateway] ${String(d).trimEnd()}`);
  });
  child.stderr?.on('data', d => {
    appendLog(d);
    logger.info(`[gateway] ${String(d).trimEnd()}`);
  });
  child.on('error', err => {
    appendLog(`spawn error: ${err.message}\n`);
    logger.error(`[gateway] spawn error: ${err.message}`);
    child = null;
  });
  child.on('exit', (code, signal) => {
    appendLog(`exit code=${code} signal=${signal}\n`);
    logger.info(`[gateway] exit code=${code} signal=${signal}`);
    child = null;
  });

  // wait briefly for /health
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 300));
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
      await new Promise(r => setTimeout(r, 150));
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
      await new Promise(r => setTimeout(r, 150));
    }
  }
  return gatewayStatus();
}

export async function restartGateway(): Promise<any> {
  if (isRunning()) await stopGateway();
  return startGateway();
}

export async function checkJava(javaHome: string): Promise<{ ok: boolean; version?: string; message?: string }> {
  const bin = resolveJavaBin(javaHome);
  return new Promise(resolve => {
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

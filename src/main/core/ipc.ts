import { electronApp, is, platform } from '@electron-toolkit/utils';
import { exec, execFile } from 'child_process';
import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, shell } from 'electron';
import fs from 'fs-extra';
import { get as httpGet, RequestOptions } from 'http';
import { get as httpsGet } from 'https';
import { join, resolve, relative, isAbsolute } from 'path';

import logger from './logger';
import { setting } from './db/service';
import { withGatewayToken } from './gateway';
import puppeteerInElectron from '../utils/pie';
import { toggleWindowVisibility } from '../utils/tool';
import { createMain, createPlay, getWin } from './winManger';

const tmpDir = async (path: string) => {
  try {
    const pathExists = await fs.pathExistsSync(path);
    logger.info(`[ipcMain] tmpDir: ${path}-exists-${pathExists}`);
    if (pathExists) {
      await fs.removeSync(path); // 删除文件, 不存在不会报错
    }
    await fs.emptyDirSync(path); // 清空目录, 不存在自动创建
    logger.info(`[ipcMain] tmpDir: ${path}-created-success`);
  } catch (err) {
    logger.error(err);
  }
};

/**
 * 主进程侧的轻量 HTTP GET：强制 IPv4 并按需带 UA，返回原始字节。
 * 只给直播源拉取用，跟随最多 3 次重定向。
 */
const fetchRemote = (url: string, ua = '', redirects = 3): Promise<{ status: number; body: Buffer }> =>
  new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`bad url: ${url}`));
      return;
    }
    if (!/^https?:$/.test(target.protocol)) {
      reject(new Error(`unsupported protocol: ${target.protocol}`));
      return;
    }
    const options: RequestOptions = {
      family: 4,
      timeout: 20000,
      headers: {
        'User-Agent': ua || 'okhttp/3.12.0',
        Accept: '*/*',
      },
    };
    const getter = target.protocol === 'https:' ? httpsGet : httpGet;
    const req = getter(target, options, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && redirects > 0) {
        res.resume();
        resolve(fetchRemote(new URL(location, target).toString(), ua, redirects - 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk as Buffer));
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${url}`)));
    req.on('error', reject);
  });

const ipcListen = () => {
  ipcMain.on('uninstallShortcut', () => {
    logger.info(`[ipcMain] globalShortcut unregisterAll`);
    globalShortcut.unregisterAll();
  });

  ipcMain.on('toggle-selfBoot', (_, status) => {
    logger.info(`[ipcMain] set-selfBoot: ${status}`);
    electronApp.setAutoLaunch(status);
  });

  ipcMain.on('open-proxy-setting', () => {
    logger.info(`[ipcMain] open-proxy-setting`);
    if (platform.isWindows) shell.openPath('ms-settings:network-proxy');
    if (platform.isMacOS) shell.openExternal('x-apple.systempreferences:com.apple.preference.network?Proxies');
    if (platform.isLinux) shell.openPath('gnome-control-center network');
  });

  ipcMain.on('call-player', (_, path: string, url: string) => {
    if (url && path) {
      // 网关媒体 URL 外部播放器不带 header：补 ?token=（非网关 URL 原样返回）
      const finalUrl = withGatewayToken(String(url));
      // execFile 参数数组传递，外部 URL 不进 shell，杜绝命令注入
      execFile(path, [finalUrl], (err) => {
        if (err) logger.error(`[ipcMain] call-player error: ${err}`);
      });
      logger.info(`[ipcMain] call-player: path:${path} url:${finalUrl}`);
    }
  });

  const getFolderSize = (folderPath: string): number => {
    let totalSize = 0;

    if (fs.existsSync(folderPath)) {
      const entries = fs.readdirSync(folderPath);

      for (const entry of entries) {
        const entryPath = join(folderPath, entry);
        const entryStats = fs.statSync(entryPath);

        if (entryStats.isFile()) {
          totalSize += entryStats.size;
        } else if (entryStats.isDirectory()) {
          totalSize += getFolderSize(entryPath);
        }
      }
    }

    return totalSize;
  };

  ipcMain.on('tmpdir-manage', (event, action, trails) => {
    const formatPath = join(app.getPath('userData'), trails);
    if (action === 'rmdir' || action === 'mkdir' || action === 'init') tmpDir(formatPath);
    if (action === 'make') fs.ensureDirSync(formatPath);
    if (action === 'size') event.reply('tmpdir-manage-size', getFolderSize(formatPath));
  });

  ipcMain.handle('ffmpeg-thumbnail', async (_, url, key) => {
    const uaState = String(setting.find({ key: 'ua' }).value ?? '');
    const formatPath = is.dev
      ? join(process.cwd(), 'thumbnail', `${key}.jpg`)
      : join(app.getPath('userData'), 'thumbnail', `${key}.jpg`);

    // 参数数组传递给 execFile，URL/UA 不进 shell，保持原有参数顺序（网关缩略图 URL 补 token）
    const args = [
      '-y',
      '-frames:v',
      '1',
      '-q:v',
      '20',
      '-user_agent',
      uaState,
      formatPath,
      '-i',
      withGatewayToken(String(url ?? '')),
    ];

    try {
      await execFile('ffmpeg', args);
      const isGenerat = fs.existsSync(formatPath);
      logger.info(`[ipcMain] ffmpeg-thumbnail status:${isGenerat} key:${key}`);
      return {
        key,
        url: `file://${formatPath}`,
      };
    } catch (err) {
      logger.error(`[ipcMain] Error generating thumbnail: ${err}`);
      return {
        key,
        url: '',
      };
    }
  });

  ipcMain.handle('ffmpeg-installed-check', async () => {
    try {
      const { stdout } = await exec('ffmpeg -version');
      logger.info(`[ipcMain] FFmpeg is installed. ${stdout}`);
      return true;
    } catch (err) {
      logger.error(`[ipcMain] Error Ffmpeg Installed Check: ${err}`);
      return false;
    }
  });

  ipcMain.handle('sniffer-media', async (_, url, run_script, init_script, customRegex) => {
    const ua = setting.find({ key: 'ua' }).value;
    const res = await puppeteerInElectron(url, run_script, init_script, customRegex, ua);
    return res;
  });

  ipcMain.handle('read-file', async (_, path) => {
    const fileContent = await fs.readFileSync(path, 'utf8').toString();
    const res = fileContent ? fileContent : '';
    logger.info(res);

    return res;
  });

  /**
   * 直播源拉取放在主进程：渲染进程的 XHR 改不了 User-Agent（forbidden header），而 TVBox
   * 源常按 UA 决定返回配置还是网页（饭太硬只有 okhttp 才给配置）；另外部分源站只有 IPv4，
   * 默认的 Happy Eyeballs 会先卡在 IPv6 上超时（肥猫就是这样）。返回 base64 以保住二进制。
   */
  ipcMain.handle('iptv-fetch', async (_, url, ua) => {
    const { status, body } = await fetchRemote(String(url), ua ? String(ua) : '');
    return { status, body: body.toString('base64') };
  });

  ipcMain.on('open-url', async (_, url) => {
    // scheme 白名单：仅允许 http/https，防止 file:// 或自定义协议被滥用
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(withGatewayToken(parsed.toString()));
      } else {
        logger.warn(`[ipcMain] open-url blocked non-http scheme: ${parsed.protocol}`);
      }
    } catch (err) {
      logger.error(`[ipcMain] open-url invalid url: ${err}`);
    }
  });

  ipcMain.on('open-path', async (_, file, create) => {
    const path = resolve(app.getPath('userData'), String(file ?? ''));
    // 防目录穿越：解析后必须仍在 userData 内
    const rel = relative(app.getPath('userData'), path);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      logger.warn(`[ipcMain] open-path blocked path escape: ${file}`);
      return;
    }
    // 查看目录是否存在，如果不存在，就创建一个
    if (create) fs.ensureDirSync(path);
    shell.openPath(path);
  });

  ipcMain.handle('read-path', async (_, type) => {
    const path = app.getPath(type);
    return path;
  });

  ipcMain.handle('path-join', (_, fromPath, toPath) => {
    return join(fromPath, toPath);
  });

  // 重启app
  ipcMain.on('reboot-app', () => {
    logger.info(`[ipcMain] reboot-app`);
    app.relaunch();
    app.exit(); // 直接强制关闭
    // app.quit(); // 生命周期, 有回调函数
  });

  // 关闭app
  ipcMain.on('quit-app', () => {
    app.quit();
  });

  ipcMain.on('openPlayWindow', (_, _arg) => {
    createPlay();
  });

  ipcMain.on('showMainWin', () => {
    logger.info(`[ipcMain] show main windows`);
    const win = getWin('main');
    if (!win || win.isDestroyed()) {
      createMain();
    } else {
      win.show();
    }
  });

  ipcMain.on('updateShortcut', (_, { shortcut }) => {
    logger.info(`[ipcMain] storage-shortcuts: ${shortcut}`);
    globalShortcut.unregisterAll();
    logger.info(`[ipcMain] globalShortcut-install: ${shortcut}`);
    globalShortcut.register(shortcut, () => {
      toggleWindowVisibility();
    });
  });

  ipcMain.on('manage-playerWindow', (_, action) => {
    logger.info(`[ipcMain] playerWindow: action is ${action}`);
    const win = getWin('play');
    if (action === 'destroy') {
      win?.destroy();
    } else if (action === 'focus') {
      win?.focus();
    }
  });

  ipcMain.on('updateDns', (_, item) => {
    logger.info(`[ipcMain] new dns: ${item}`);
    if (item) {
      app.configureHostResolver({
        secureDnsMode: 'secure',
        secureDnsServers: [item],
      });
    } else {
      app.configureHostResolver({
        secureDnsMode: 'off',
      });
    }
  });

  // 事件广播通知
  ipcMain.handle('event-broadcast', (event, eventInfo) => {
    // 遍历window执行
    for (const currentWin of BrowserWindow.getAllWindows()) {
      // 注意，这里控制了发送广播的窗口，不触发对应事件，如果需要自身也触发的话，删除if内的逻辑即可
      if (event) {
        const webContentsId = currentWin.webContents.id;
        if (webContentsId === event.sender.id) {
          continue;
        }
      }
      currentWin.webContents.send(eventInfo.channel, eventInfo.body);
    }
  });

  // 主题更新事件
  nativeTheme.on('updated', () => {
    const isDarkMode = nativeTheme.shouldUseDarkColors;
    const mainWin = getWin('main');
    const playWin = getWin('play');
    if (mainWin) mainWin.webContents.send('system-theme-updated', `${isDarkMode ? 'dark' : 'light'}`);
    if (playWin) playWin.webContents.send('system-theme-updated', `${isDarkMode ? 'dark' : 'light'}`);
    logger.info(`[nativeTheme] System-theme-updated: ${isDarkMode ? 'dark' : 'light'} ; send to vue app`);
  });
};

export { ipcListen, tmpDir };

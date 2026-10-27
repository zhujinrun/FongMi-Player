export default {
  name: 'IPTV',
  delay: 'Delay',
  infiniteLoading: {
    complete: 'Load Complete',
    error: 'Load Error',
    noMore: 'Nothing More',
    noData: 'No data, Please go Setting-IptvSetting set default source'
  },
  contextMenu: {
    copyChannel: 'Copy Channel',
    delChannel: 'Delete Channel'
  },
  probe: {
    start: 'Check',
    stop: 'Stop',
    stopping: 'Stopping...',
    alive: 'playable',
    onlyPlayable: 'Playable only',
    summary: 'Checked {total}, {dead} unavailable',
    hintTurnOn: 'Done. Turn on "Playable only" to hide the unavailable channels',
    stopped: 'Check stopped',
    empty: 'No channel to check in the current source',
    fail: 'Check failed'
  },
  state: {
    noSourceTitle: 'No live source yet',
    noSourceDesc: 'Add a live source and set it as default, then channels will show up here',
    errorTitle: 'Failed to load the live source config',
    errorDesc: 'Reading the config failed, retry or check the live source in settings'
  },
  message: {
    setSuccess: 'Setup success',
    setFail: 'Setup failure, error message',
    copySuccess: 'Copy success, quickly share to friends',
    copyFail: "Current environment does't support copy. Please copy link manually"
  }
}

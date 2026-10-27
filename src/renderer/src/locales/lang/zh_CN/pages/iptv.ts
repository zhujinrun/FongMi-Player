export default {
  name: '电视',
  delay: '超时',
  infiniteLoading: {
    complete: '人家是有底线的',
    error: '哎呀，出了点差错',
    noMore: '没有更多内容了',
    noData: '暂无数据, 请前往设置-直播源设置默认源'
  },
  contextMenu: {
    copyChannel: '复制频道',
    delChannel: '删除频道'
  },
  probe: {
    start: '检测',
    stop: '停止',
    stopping: '正在停止检测…',
    alive: '可用',
    onlyPlayable: '只显示可播放',
    summary: '检测 {total} 个，{dead} 个不可用',
    hintTurnOn: '检测完成，打开「只显示可播放」才会隐藏失效频道',
    stopped: '已停止检测',
    empty: '当前源没有可检测的频道',
    fail: '检测失败'
  },
  state: {
    noSourceTitle: '还没有可用的直播源',
    noSourceDesc: '添加一个直播源并设为默认后, 频道列表才会显示',
    errorTitle: '直播源配置加载失败',
    errorDesc: '读取配置时出错了, 可以重试, 或去设置里检查直播源'
  },
  message: {
    setSuccess: '设置成功',
    setFail: '设置失败, 错误信息',
    copySuccess: '复制成功，快分享给好友吧',
    copyFail: '当前环境不支持一键复制，请手动复制链接'
  }
}

export function createRecordPanel(options) {
  var $ = options.$
  var recordFileName = options.recordFileName || function (file) { return String(file && file.startTime || '') }
  var onPlayFile = options.onPlayFile || function () {}
  var onDownloadFile = options.onDownloadFile || function () {}
  var onPlayerChange = options.onPlayerChange || function () {}
  var state = {
    files: [],
    segments: [],
    timelineStart: 0,
    timelineEnd: 0,
    currentTime: 0,
    activeFileIndex: -1,
    playerList: [
      { key: 'jessibuca', label: 'Jessibuca' },
      { key: 'webRTC', label: 'WebRTC' },
      { key: 'h265web', label: 'H265web' }
    ],
    activePlayer: 'jessibuca',
    fullscreen: false
  }

  function element(id) { return document.getElementById(id) }
  function formatDateTime(value) {
    var date = new Date(value)
    if (isNaN(date.getTime())) return String(value || '')
    var pad = function (number) { return String(number).padStart(2, '0') }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  }
  function formatClock(value) {
    var date = new Date(value)
    if (isNaN(date.getTime())) return '--:--:--'
    return formatDateTime(date).slice(11)
  }
  function setState(message, type) {
    var node = element('recordState')
    if (!node) return
    $(node).removeClass('success error loading').addClass(type || '').text(message)
  }
  function setPlaceholder(message, isError) {
    var node = element('recordPlaceholder')
    if (!node) return
    $(node).text(message).toggleClass('error', Boolean(isError)).show()
  }
  function hidePlaceholder() { $('#recordPlaceholder').hide() }
  function setLoading(loading) { $('#recordLoading').toggleClass('visible', Boolean(loading)) }
  function setControls(enabled) {
    $('#recordPrev, #recordSeekBackward, #recordPause, #recordStop, #recordSeekForward, #recordNext, #recordScreenshot, #recordDownloadCurrent').prop('disabled', !enabled)
    if (!enabled) setPauseLabel('播放', true)
  }
  function getPauseCommand() { return $('#recordPause').attr('data-command') === 'pause' ? 'pause' : 'resume' }
  function setPauseLabel(label, paused) {
    var node = element('recordPause')
    if (!node) return
    if (paused === undefined) paused = label === '继续' || label === '播放'
    $(node).attr('data-command', paused ? 'resume' : 'pause')
      .find('.record-control-label').text(label)
      .end().find('.iconfont').attr('class', 'iconfont ' + (paused ? 'icon-kaishi' : 'icon-zanting'))
  }
  function setPlaying(playing) {
    setPauseLabel(playing ? '暂停' : '播放', !playing)
  }
  function setPlayerLabel(label) { $('#recordPlayerLabel').text(label || 'Jessibuca') }
  function setPlayerList(list) {
    state.playerList = Array.isArray(list) && list.length ? list : state.playerList
    var menu = $('#recordPlayerMenu').empty()
    $.each(state.playerList, function (_, player) {
      $('<button>', { type: 'button', class: 'record-menu-item', 'data-player': player.key, text: player.label })
        .on('click', function () {
          state.activePlayer = player.key
          setPlayerLabel(player.label)
          menu.removeClass('visible')
          onPlayerChange(player.key)
        }).appendTo(menu)
    })
    var active = state.playerList.filter(function (player) { return player.key === state.activePlayer })[0] || state.playerList[0]
    state.activePlayer = active.key
    setPlayerLabel(active.label)
  }
  function setFullscreen(fullscreen) {
    state.fullscreen = Boolean(fullscreen)
    $('#recordPlayerBox').toggleClass('record-player-box-fullscreen', state.fullscreen)
    $('#recordFullscreen .iconfont').attr('class', 'iconfont ' + (state.fullscreen ? 'icon-suoxiao1' : 'icon-fangdazhanshi'))
    $('#recordFullscreen .record-control-label').text(state.fullscreen ? '退出全屏' : '全屏')
  }
  function getTimeValue(value) {
    if (value && typeof value === 'object') {
      var candidate = value.currentTime
      if (candidate === undefined) candidate = value.time
      if (candidate === undefined) candidate = value.videoPTS
      if (candidate === undefined) candidate = value.seconds
      return Number(candidate)
    }
    return Number(value)
  }
  function setCurrentTime(value, baseTime) {
    var seconds = getTimeValue(value)
    if (!isFinite(seconds)) return
    state.currentTime = seconds
    var seek = element('recordSeek')
    if (seek && !seek.matches(':active')) seek.value = Math.max(Number(seek.min || 0), Math.min(Number(seek.max || seconds), seconds))
    if (state.timelineStart) {
      var start = baseTime === undefined || baseTime === null ? state.timelineStart : new Date(baseTime).getTime()
      if (!isFinite(start)) start = state.timelineStart
      var timestamp = start + seconds * 1000
      $('#recordTimelineCurrent').css('left', timelinePosition(timestamp) + '%')
      $('#recordTimeLabel').text(formatDateTime(timestamp))
    }
  }
  function setTimeline(initTime, segments) {
    state.segments = Array.isArray(segments) ? segments : []
    state.timelineStart = Number(initTime) || 0
    if (!state.timelineStart && state.segments.length) state.timelineStart = state.segments[0].beginTime
    state.timelineEnd = state.segments.reduce(function (end, item) { return Math.max(end, Number(item.endTime) || 0) }, state.timelineStart)
    if (state.timelineEnd <= state.timelineStart) state.timelineEnd = state.timelineStart + 86400000
    state.currentTime = 0
    state.activeFileIndex = -1
    drawTimeline()
  }
  function timelinePosition(timestamp) {
    return Math.max(0, Math.min(100, (timestamp - state.timelineStart) / Math.max(1, state.timelineEnd - state.timelineStart) * 100))
  }
  function timelinePayload(clientX) {
    var canvas = element('recordTimelineCanvas')
    if (!canvas) return null
    var rect = canvas.getBoundingClientRect()
    var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
    var timestamp = state.timelineStart + ratio * (state.timelineEnd - state.timelineStart)
    var index = -1
    $.each(state.segments, function (segmentIndex, segment) {
      if (timestamp >= segment.beginTime && timestamp <= segment.endTime) index = segment.index === undefined ? segmentIndex : segment.index
    })
    return { timestamp: timestamp, seconds: Math.max(0, (timestamp - state.timelineStart) / 1000), index: index }
  }
  function drawTimeline() {
    var canvas = element('recordTimelineCanvas')
    var wrapper = element('recordTimeline')
    if (!canvas || !wrapper) return
    var rect = wrapper.getBoundingClientRect()
    var width = Math.max(1, Math.floor(rect.width))
    var height = Math.max(1, Math.floor(rect.height))
    var ratio = window.devicePixelRatio || 1
    canvas.width = width * ratio
    canvas.height = height * ratio
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    var context = canvas.getContext('2d')
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#262626'
    context.fillRect(0, 0, width, height)
    var duration = Math.max(1, state.timelineEnd - state.timelineStart)
    var tickCount = Math.max(4, Math.min(12, Math.round(width / 90)))
    context.font = '11px Microsoft YaHei, sans-serif'
    context.textBaseline = 'top'
    for (var tick = 0; tick <= tickCount; tick += 1) {
      var x = Math.round(width * tick / tickCount) + 0.5
      context.strokeStyle = tick === Math.round(tickCount / 2) ? '#e6edf5' : '#475569'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
      context.fillStyle = '#aeb8c6'
      context.fillText(formatClock(state.timelineStart + duration * tick / tickCount), Math.min(width - 55, Math.max(2, x + 3)), 4)
    }
    $.each(state.segments, function (index, segment) {
      var left = (Number(segment.beginTime) - state.timelineStart) / duration * width
      var segmentWidth = (Number(segment.endTime) - Number(segment.beginTime)) / duration * width
      context.fillStyle = segment.color || '#017690'
      context.fillRect(Math.max(0, left), Math.round(height * 0.58), Math.max(2, segmentWidth), Math.round(height * 0.26))
      if (segment.index === state.activeFileIndex || (segment.index === undefined && index === state.activeFileIndex)) {
        context.fillStyle = '#f56c6c'
        context.fillRect(Math.max(0, left), Math.round(height * 0.53), Math.max(2, segmentWidth), Math.round(height * 0.36))
      }
    })
    $('#recordTimelineCurrent').css('left', state.currentTime ? timelinePosition(state.timelineStart + state.currentTime * 1000) + '%' : '50%')
    if (!state.segments.length) {
      $('#recordTimelineEmpty').show()
    } else {
      $('#recordTimelineEmpty').hide()
    }
  }
  function renderTimeline(files) {
    state.files = files || []
    var segments = state.files.map(function (file, index) {
      return { beginTime: new Date(file.startTime).getTime(), endTime: new Date(file.endTime).getTime(), color: '#017690', startRatio: 0.7, endRatio: 0.85, index: index }
    }).filter(function (item) { return isFinite(item.beginTime) && isFinite(item.endTime) })
    setTimeline(segments.length ? segments[0].beginTime : 0, segments)
  }
  function setActiveFile(index) {
    state.activeFileIndex = index
    $('#recordList .record-file-tag').removeClass('active')
    $('#recordList li').eq(index).find('.record-file-tag').addClass('active')
    drawTimeline()
  }
  function renderFiles(files) {
    state.files = files || []
    var list = $('#recordList').empty()
    $('#recordListTitle').text('录像文件（' + state.files.length + '）')
    if (!state.files.length) list.append($('<li>', { class: 'record-list-no-val', text: '暂无数据' }))
    $.each(state.files, function (index, file) {
      var item = $('<li>', { class: 'record-list-item' })
      var tag = $('<button>', { type: 'button', class: 'record-file-tag', title: recordFileName(file) })
      $('<span>', { class: 'iconfont icon-shipin' }).appendTo(tag)
      $('<span>', { class: 'record-file-name', text: recordFileName(file) }).appendTo(tag)
      tag.on('click', function () { onPlayFile(index) }).appendTo(item)
      $('<button>', { type: 'button', class: 'record-file-download iconfont icon-xiazai1', title: '下载录像' })
        .on('click', function (event) { event.stopPropagation(); onDownloadFile(file) }).appendTo(item)
      item.appendTo(list)
    })
    renderTimeline(state.files)
  }
  function showError(message) { $('#recordList').empty().append($('<li>', { class: 'record-list-no-val record-error', text: message })) }
  function openDownloadRange(startTime, endTime) {
    var start = startTime ? new Date(startTime) : new Date()
    var end = endTime ? new Date(endTime) : new Date(start.getTime() + 3600000)
    $('#recordRangeStart').val(toDateTimeLocal(start))
    $('#recordRangeEnd').val(toDateTimeLocal(end))
    $('#recordRangeDialog').addClass('visible')
  }
  function toDateTimeLocal(value) {
    var date = new Date(value)
    if (isNaN(date.getTime())) return ''
    var pad = function (number) { return String(number).padStart(2, '0') }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  }
  function closeDownloadRange() { $('#recordRangeDialog').removeClass('visible') }
  function show() {
    $('#recordSidebar, .record-dialog').removeClass('collapsed sidebar-collapsed')
    $('#recordSidebarToggle').attr('aria-expanded', 'true').attr('title', '收起录像列表').text('‹')
    $('#recordModal').addClass('visible')
  }
  function hide() {
    $('#recordModal').removeClass('visible')
    closeDownloadRange()
    $('#recordDownloadDialog').removeClass('visible')
    $('#recordSpeedMenu, #recordPlayerMenu').removeClass('visible')
    $('#recordSidebar, .record-dialog').removeClass('collapsed sidebar-collapsed')
    $('#recordSidebarToggle').attr('aria-expanded', 'true').attr('title', '收起录像列表').text('‹')
    setLoading(false)
    setFullscreen(false)
  }
  function setDownloadState(message) { $('#recordDownloadState, #recordDownloadProgressText').text(message || '') }
  function openDownloadDialog(message) {
    setDownloadState(message || '正在请求录像…')
    $('#recordDownloadDialog').addClass('visible')
  }
  function closeDownloadDialog() { $('#recordDownloadDialog').removeClass('visible') }
  return {
    setState: setState, setPlaceholder: setPlaceholder, hidePlaceholder: hidePlaceholder, setLoading: setLoading,
    setControls: setControls, getPauseCommand: getPauseCommand, setPauseLabel: setPauseLabel, setPlaying: setPlaying,
    setPlayerList: setPlayerList, setPlayerLabel: setPlayerLabel, setFullscreen: setFullscreen, setCurrentTime: setCurrentTime,
    setTimeline: setTimeline, renderTimeline: renderTimeline, renderFiles: renderFiles, markFile: setActiveFile, showError: showError,
    openDownloadRange: openDownloadRange, closeDownloadRange: closeDownloadRange, setDownloadState: setDownloadState,
    openDownloadDialog: openDownloadDialog, closeDownloadDialog: closeDownloadDialog,
    show: show, hide: hide, getTimelinePayload: timelinePayload, getFiles: function () { return state.files }
  }
}

export function mountRecordPanel(options) {
  var $ = options.$
  var controller = options.controller
  var handlers = []
  function bind(selector, event, handler) {
    $(selector).on(event, handler)
    handlers.push(function () { $(selector).off(event, handler) })
  }
  function toggleSidebar() {
    var collapsed = $('#recordSidebar').toggleClass('collapsed').hasClass('collapsed')
    $('.record-dialog').toggleClass('sidebar-collapsed', collapsed)
    $('#recordSidebarToggle').attr('aria-expanded', String(!collapsed)).attr('title', collapsed ? '展开录像列表' : '收起录像列表').text(collapsed ? '›' : '‹')
  }
  bind('#recordClose', 'click', function () { controller.close() })
  bind('#recordSidebarClose', 'click', function () { controller.close() })
  bind('#recordQueryButton', 'click', function () { controller.query() })
  bind('#recordDate', 'change', function () { controller.query() })
  bind('#recordPrev', 'click', function () { controller.previous() })
  bind('#recordSeekBackward', 'click', function () { controller.seekRelative(-5) })
  bind('#recordNext', 'click', function () { controller.next() })
  bind('#recordPause', 'click', function () { controller.togglePause() })
  bind('#recordStop', 'click', function () { controller.stopPlayback() })
  bind('#recordSeekForward', 'click', function () { controller.seekRelative(5) })
  bind('#recordScreenshot', 'click', function () { controller.screenshot() })
  bind('#recordSeek', 'change', function () { controller.seek($(this).val()) })
  bind('#recordDownloadCurrent', 'click', function () { controller.downloadCurrent() })
  bind('#recordDownloadRange', 'click', function () { controller.downloadRange() })
  bind('#recordSpeedMenu .record-menu-item', 'click', function () {
    $('#recordSpeedMenu').removeClass('visible')
    $('#recordSpeedButton').text($(this).text())
    controller.changeSpeed($(this).attr('data-speed'))
  })
  bind('#recordSidebarButton, #recordSidebarToggle', 'click', function () { toggleSidebar() })
  bind('#recordSpeedButton', 'click', function () { $('#recordSpeedMenu').toggleClass('visible') })
  bind('#recordPlayerButton', 'click', function () { $('#recordPlayerMenu').toggleClass('visible') })
  bind('#recordFullscreen', 'click', function () { controller.fullscreen() })
  bind('#recordRangeCancel', 'click', function () { controller.closeRange() })
  bind('#recordRangeConfirm', 'click', function () {
    var start = $('#recordRangeStart').val()
    var end = $('#recordRangeEnd').val()
    if (!start || !end || new Date(start).getTime() >= new Date(end).getTime()) return controller.rangeError('开始时间必须早于结束时间')
    controller.confirmRange(start.replace('T', ' '), end.replace('T', ' '))
  })
  bind('#recordDownloadCancel', 'click', function () { controller.cancelDownload() })
  bind('#recordModal', 'click', function (event) { if (event.target === this) controller.close() })
  bind('#recordTimelineCanvas', 'click', function (event) {
    var payload = controller.timelinePayload ? controller.timelinePayload(event.clientX) : null
    if (payload) controller.timelineSelect(payload)
  })
  bind(document, 'click', function (event) {
    if (!$(event.target).closest('#recordSpeedButton, #recordSpeedMenu').length) $('#recordSpeedMenu').removeClass('visible')
    if (!$(event.target).closest('#recordPlayerButton, #recordPlayerMenu').length) $('#recordPlayerMenu').removeClass('visible')
  })
  bind(window, 'resize', function () { if (controller.redrawTimeline) controller.redrawTimeline() })
  return { destroy: function () { handlers.forEach(function (unbind) { unbind() }) } }
}

export function defineRecordPanelElement() {
  if (typeof customElements === 'undefined' || customElements.get('record-panel')) return
  customElements.define('record-panel', class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector('#recordModal')) return
      this.innerHTML = `
        <div id="recordModal" class="record-modal" role="dialog" aria-modal="true" aria-label="国标录像">
          <div class="record-dialog">
            <section class="record-main">
              <div class="record-main-header"><div class="record-heading"><h2 id="recordTitle">未选择录像</h2><span id="recordIds"></span></div><button id="recordClose" class="record-close" type="button" title="关闭录像面板">×</button></div>
              <div id="recordPlayerBox" class="record-player-box">
                <div id="recordStage" class="play-box"><div id="recordLoading" class="record-loading"><span class="iconfont icon-wangye-loading"></span><span>正在加载</span></div><div id="recordPlayerContainer" class="record-player-container"></div><div id="recordPlaceholder" class="record-placeholder">请选择右侧录像文件开始回放</div></div>
                <div class="player-option-box"><div id="recordTimeHover" class="time-line-show"></div><div id="recordTimeline" class="record-timeline"><canvas id="recordTimelineCanvas"></canvas><span id="recordTimelineCurrent" class="record-timeline-current"></span><span id="recordTimelineEmpty" class="record-timeline-empty">查询录像后显示时间轴</span></div>
                  <div class="record-control-row"><div class="record-control-left"><div class="record-play-control record-play-control-transparent"><button id="recordSidebarButton" class="record-control-item iconfont icon-list" title="列表" type="button"></button><button id="recordScreenshot" class="record-control-item iconfont icon-camera1196054easyiconnet" title="截图" type="button"></button><button id="recordDownloadRange" class="record-control-item iconfont icon-xiazai1" title="选择时间段下载" type="button"></button></div></div>
                    <div class="record-control-center"><div class="record-play-control"><button id="recordPrev" class="record-control-item iconfont icon-diyigeshipin" title="上一个" type="button"></button><button id="recordSeekBackward" class="record-control-item iconfont icon-kuaijin" title="快退五秒" type="button"></button><button id="recordStop" class="record-control-item iconfont icon-stop1" title="停止" type="button"></button><button id="recordPause" class="record-control-item" data-command="pause" title="暂停" type="button"><span class="iconfont icon-zanting"></span><span class="record-control-label"></span></button><button id="recordSeekForward" class="record-control-item iconfont icon-houtui" title="快进五秒" type="button"></button><button id="recordNext" class="record-control-item iconfont icon-zuihouyigeshipin" title="下一个" type="button"></button><span class="record-speed-wrap"><button id="recordSpeedButton" class="record-control-item record-play-control-speed" title="倍速播放" type="button">1X</button><span id="recordSpeedMenu" class="record-menu record-menu-up"></span></span></div></div>
                    <div class="record-control-right"><div class="record-play-control record-play-control-transparent"><span class="record-player-wrap"><button id="recordPlayerButton" class="record-control-item record-play-control-speed" title="选择播放器" type="button"><span id="recordPlayerLabel">Jessibuca</span></button><span id="recordPlayerMenu" class="record-menu record-menu-up"></span></span><button id="recordDownloadCurrent" class="record-control-item iconfont icon-xiazai1" title="下载当前段" type="button"></button><button id="recordFullscreen" class="record-control-item iconfont icon-fangdazhanshi" title="全屏" type="button"></button></div></div>
                  </div>
                </div>
              </div>
              <div class="record-time-row"><span id="recordTimeLabel">未播放</span><input id="recordSeek" type="range" min="0" max="0" value="0" disabled aria-label="录像进度"></div>
              <div id="recordState" class="record-state loading">准备查询</div><div id="recordDownloadState" class="record-download-state"></div>
            </section>
            <aside id="recordSidebar" class="record-sidebar">
              <div class="record-sidebar-title"><span class="record-sidebar-heading"><span class="iconfont icon-liebiao"></span><span>国标录像</span></span><button id="recordSidebarClose" class="record-sidebar-close" type="button" title="关闭录像面板" aria-label="关闭录像面板">×</button></div>
              <div id="recordChannel" class="record-channel">请选择通道</div>
              <div class="record-date-row"><input id="recordDate" type="date" aria-label="录像日期"><button id="recordQueryButton" type="button">查询</button></div>
              <div id="recordListTitle" class="record-list-title">录像文件（0）</div>
              <div class="record-list-box"><ul id="recordList" class="record-list"></ul></div>
            </aside>
            <button id="recordSidebarToggle" class="record-sidebar-toggle" type="button" aria-controls="recordSidebar" aria-expanded="true" title="收起录像列表">‹</button>
          </div>
          <div id="recordRangeDialog" class="record-subdialog"><div class="record-subdialog-card"><h3>选择时间段</h3><div class="record-range-fields"><label>开始时间<input id="recordRangeStart" type="datetime-local" step="1"></label><span>至</span><label>结束时间<input id="recordRangeEnd" type="datetime-local" step="1"></label></div><div class="record-subdialog-footer"><button id="recordRangeCancel" type="button">取消</button><button id="recordRangeConfirm" class="primary" type="button">确认</button></div></div></div>
          <div id="recordDownloadDialog" class="record-subdialog"><div class="record-subdialog-card record-download-card"><h3>录像下载</h3><p id="recordDownloadProgressText">正在请求录像…</p><div class="record-subdialog-footer"><button id="recordDownloadCancel" type="button">取消下载</button></div></div></div>
        </div>
      `
      var speedMenu = this.querySelector('#recordSpeedMenu')
      ;[0.25, 0.5, 1, 2, 4].forEach(function (speed) {
        var button = document.createElement('button')
        button.type = 'button'
        button.className = 'record-menu-item'
        button.dataset.speed = speed
        button.textContent = speed + 'X'
        speedMenu.appendChild(button)
      })
      this.querySelector('#recordPause').querySelector('.record-control-label').textContent = '暂停'
    }
  })
}

defineRecordPanelElement()

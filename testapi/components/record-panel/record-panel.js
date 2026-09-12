export function createRecordPanel(options) {
  var $ = options.$
  var recordFileName = options.recordFileName
  var onPlayFile = options.onPlayFile || function () {}
  var onDownloadFile = options.onDownloadFile || function () {}

  function setState(message, type) {
    $('#recordState').removeClass('success error loading').addClass(type || '').text(message)
  }

  function setPlaceholder(message, isError) {
    $('#recordPlaceholder').text(message).toggleClass('error', Boolean(isError)).show()
  }

  function hidePlaceholder() {
    $('#recordPlaceholder').hide()
  }

  function setControls(enabled) {
    $('#recordPrev, #recordPause, #recordNext, #recordStop, #recordScreenshot, #recordDownloadCurrent').prop('disabled', !enabled)
    if (!enabled) $('#recordPause').text('暂停')
  }

  function getPauseCommand() {
    return $('#recordPause').text() === '暂停' ? 'pause' : 'resume'
  }

  function setPauseLabel(label) {
    $('#recordPause').text(label)
  }

  function renderTimeline(files) {
    var $timeline = $('#recordTimeline').empty()
    if (!files.length) {
      $timeline.append($('<div>', { 'class': 'record-timeline-empty', text: '查询录像后显示时间轴' }))
      return
    }
    var start = Math.min.apply(null, files.map(function (file) { return new Date(file.startTime).getTime() }))
    var end = Math.max.apply(null, files.map(function (file) { return new Date(file.endTime).getTime() }))
    var total = Math.max(end - start, 1)
    $.each(files, function (index, file) {
      var fileStart = new Date(file.startTime).getTime()
      var fileEnd = new Date(file.endTime).getTime()
      var left = Math.max(0, (fileStart - start) / total * 100)
      var width = Math.max(0.5, (fileEnd - fileStart) / total * 100)
      $('<div>', { 'class': 'record-segment', title: recordFileName(file), 'data-index': index })
        .css({ left: left + '%', width: width + '%' })
        .on('click', function () { onPlayFile(index) })
        .appendTo($timeline)
    })
  }

  function renderFiles(files) {
    var $list = $('#recordList').empty()
    $('#recordListTitle').text('录像文件（' + files.length + '）')
    if (!files.length) {
      $list.append($('<li>', { 'class': 'record-empty', text: '当天没有录像' }))
      renderTimeline(files)
      return
    }
    $.each(files, function (index, file) {
      var $item = $('<li>', { 'class': 'record-list-item' })
      $('<button>', { type: 'button', text: recordFileName(file), title: recordFileName(file) })
        .on('click', function () { onPlayFile(index) }).appendTo($item)
      $('<button>', { type: 'button', 'class': 'record-download', title: '下载录像', text: '↓' })
        .on('click', function (event) { event.stopPropagation(); onDownloadFile(file) }).appendTo($item)
      $item.appendTo($list)
    })
    renderTimeline(files)
  }

  function markFile(index) {
    $('#recordList button:not(.record-download)').removeClass('active')
    $('#recordList li').eq(index).find('button:not(.record-download)').addClass('active')
    $('#recordTimeline .record-segment').removeClass('active').filter('[data-index="' + index + '"]').addClass('active')
  }

  function showError(message) {
    $('#recordList').empty().append($('<li>', { 'class': 'record-error', text: message }))
  }

  function show() {
    $('#recordModal').addClass('visible')
  }

  function hide() {
    $('#recordModal').removeClass('visible')
  }

  return {
    setState: setState,
    setPlaceholder: setPlaceholder,
    hidePlaceholder: hidePlaceholder,
    setControls: setControls,
    getPauseCommand: getPauseCommand,
    setPauseLabel: setPauseLabel,
    renderTimeline: renderTimeline,
    renderFiles: renderFiles,
    markFile: markFile,
    showError: showError,
    show: show,
    hide: hide
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

  bind('#recordClose', 'click', function () { controller.close() })
  bind('#recordQueryButton', 'click', function () { controller.query() })
  bind('#recordPrev', 'click', function () { controller.previous() })
  bind('#recordNext', 'click', function () { controller.next() })
  bind('#recordPause', 'click', function () { controller.togglePause() })
  bind('#recordStop', 'click', function () { controller.stopPlayback() })
  bind('#recordScreenshot', 'click', function () { controller.screenshot() })
  bind('#recordSpeed', 'change', function () { controller.changeSpeed($(this).val()) })
  bind('#recordSeek', 'change', function () { controller.seek($(this).val()) })
  bind('#recordDownloadCurrent', 'click', function () { controller.downloadCurrent() })
  bind('#recordModal', 'click', function (event) {
    if (event.target === this) controller.close()
  })

  return {
    destroy: function () { handlers.forEach(function (unbind) { unbind() }) }
  }
}

export function defineRecordPanelElement() {
  if (typeof customElements === 'undefined' || customElements.get('record-panel')) return
  customElements.define('record-panel', class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector('#recordModal')) return
      this.innerHTML = `
        <div id="recordModal" class="record-modal" role="dialog" aria-modal="true" aria-label="国标录像">
          <div class="record-dialog">
            <aside class="record-sidebar">
              <h3>国标录像</h3>
              <div id="recordChannel" class="record-channel">请选择通道</div>
              <div class="record-date-row">
                <input id="recordDate" type="date" aria-label="录像日期">
                <button id="recordQueryButton" type="button">查询</button>
              </div>
              <div id="recordListTitle" class="record-list-title">录像文件</div>
              <ul id="recordList" class="record-list"></ul>
            </aside>
            <section class="record-main">
              <div class="record-main-header">
                <div><h2 id="recordTitle">未选择录像</h2></div>
                <span id="recordIds"></span>
                <button id="recordClose" class="record-close" type="button" title="关闭录像面板">×</button>
              </div>
              <div id="recordStage" class="record-stage">
                <div id="recordPlayerContainer" class="record-player-container"></div>
                <div id="recordPlaceholder" class="record-placeholder">请选择左侧录像文件开始回放</div>
              </div>
              <div id="recordTimeline" class="record-timeline"><div class="record-timeline-empty">查询录像后显示时间轴</div></div>
              <div class="record-time-row">
                <span id="recordTimeLabel">未播放</span>
                <input id="recordSeek" type="range" min="0" max="0" value="0" disabled aria-label="录像进度">
              </div>
              <div class="record-toolbar">
                <button id="recordPrev" type="button" disabled>上一段</button>
                <button id="recordPause" type="button" disabled>暂停</button>
                <button id="recordNext" type="button" disabled>下一段</button>
                <button id="recordStop" type="button" disabled>停止</button>
                <button id="recordScreenshot" type="button" disabled>截图</button>
                <select id="recordSpeed" aria-label="回放速度">
                  <option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option>
                </select>
                <button id="recordDownloadCurrent" type="button" disabled>下载当前段</button>
                <span id="recordState" class="record-state">未播放</span>
              </div>
              <div id="recordDownloadState" class="record-download-state"></div>
            </section>
          </div>
        </div>
      `
    }
  })
}

defineRecordPanelElement()

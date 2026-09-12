export function createDetailPanel(options) {
  var $ = options.$
  var onDisableControls = options.onDisableControls || function () {}

  function setPlayerState(message, type) {
    $('#playerState').removeClass('success error loading').addClass(type || '').text(message)
  }

  function setPlayerStreamUrl(url) {
    $('#playerStreamUrl').text(url ? '流地址：' + url : '流地址：未获取')
  }

  function setPlayerPlaceholder(message, isError) {
    $('#playerPlaceholder').text(message).toggleClass('error', Boolean(isError)).show()
  }

  function hidePlayerPlaceholder() {
    $('#playerPlaceholder').hide()
  }

  function setControlEnabled(enabled) {
    $('#controlFieldset').prop('disabled', !enabled)
    if (!enabled) onDisableControls()
  }

  function setControlChannel(message) {
    $('#controlChannel').text(message)
  }

  function open(slot, state, stateType, isPlaying, placeholder) {
    $('#playerStage').append(slot.$container)
    slot.$placeholder.hide()
    setPlayerState(state || '未播放', stateType)
    setPlayerStreamUrl(slot.wsUrl)
    if (isPlaying) hidePlayerPlaceholder()
    else setPlayerPlaceholder(placeholder || '等待添加通道', stateType === 'error')
    $('#detailModal .detail-dialog').removeClass('ctrl-collapsed')
    $('#detailCtrlToggle').attr('aria-expanded', 'true').attr('title', '收起通道控制').text('‹')
    $('#detailModal').addClass('visible')
    $('#detailClose').focus()
  }

  function close(slot, isPlaying) {
    if (slot) {
      slot.$container.appendTo(slot.$slot)
      if (slot.$placeholder) slot.$placeholder.toggle(!isPlaying)
    }
    $('#detailModal .detail-dialog').removeClass('ctrl-collapsed')
    $('#detailCtrlToggle').attr('aria-expanded', 'true').attr('title', '收起通道控制').text('‹')
    $('#detailModal').removeClass('visible')
  }

  return {
    setPlayerState: setPlayerState,
    setPlayerStreamUrl: setPlayerStreamUrl,
    setPlayerPlaceholder: setPlayerPlaceholder,
    hidePlayerPlaceholder: hidePlayerPlaceholder,
    setControlEnabled: setControlEnabled,
    setControlChannel: setControlChannel,
    open: open,
    close: close
  }
}

export function mountDetailPanel(options) {
  var $ = options.$
  var controller = options.controller
  var handlers = []

  function bind(selector, event, handler) {
    $(selector).on(event, handler)
    handlers.push(function () { $(selector).off(event, handler) })
  }

  bind('#detailClose', 'click', function () { controller.close() })
  bind('#detailCtrlToggle', 'click', function () {
    var collapsed = $('#detailModal .detail-dialog').toggleClass('ctrl-collapsed').hasClass('ctrl-collapsed')
    $('#detailCtrlToggle').attr('aria-expanded', String(!collapsed)).attr('title', collapsed ? '展开通道控制' : '收起通道控制').text(collapsed ? '›' : '‹')
  })
  bind('#detailModal', 'click', function (event) {
    if (event.target === this) controller.close()
  })

  return {
    destroy: function () { handlers.forEach(function (unbind) { unbind() }) }
  }
}

export function defineDetailPanelElement() {
  if (typeof customElements === 'undefined' || customElements.get('detail-panel')) return
  customElements.define('detail-panel', class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector('#detailModal')) return
      this.innerHTML = `
        <div id="detailModal" class="detail-modal" role="dialog" aria-modal="true" aria-label="播放器和通道控制">
          <button id="detailClose" class="detail-close" type="button" title="关闭">×</button>
          <div class="detail-dialog">
            <section class="player-panel" aria-label="Jessibuca播放器">
              <div class="player-title">
                <div>
                  <h2 id="playerChannelName">未选择通道</h2>
                  <p id="playerChannelId">请选择左侧在线通道开始播放</p>
                  <p id="playerStreamUrl">流地址：未获取</p>
                </div>
              </div>
              <div class="player-stage" id="playerStage">
                <div id="playerPlaceholder" class="player-placeholder">ws-flv 播放画面将在这里显示</div>
                <div id="dragLayer" class="drag-layer">
                  <div id="dragTip" class="drag-tip">在画面上拖动鼠标框选区域，右键或 Esc 取消</div>
                  <div id="dragRect" class="drag-rect" style="display:none"></div>
                </div>
              </div>
            </section>
            <button id="detailCtrlToggle" class="ctrl-toggle-edge" type="button" aria-controls="ctrlPanel" aria-expanded="true" title="收起通道控制">‹</button>
            <aside id="ctrlPanel" class="ctrl-panel" aria-label="通道控制">
              <div class="ctrl-inner">
                <div class="ctrl-header">
                  <h3>通道控制</h3>
                  <span id="controlChannel" class="ctrl-channel">请选择在线通道</span>
                </div>
                <div class="ctrl-body">
                  <fieldset id="controlFieldset" disabled>
                    <div class="ptz-section-inner">
                      <div class="ptz-top">
                        <div class="ptz-dpad">
                          <div class="dpad-ring"></div>
                          <button type="button" class="dpad-btn card card-up" data-ptz="up">▲</button>
                          <button type="button" class="dpad-btn card card-right" data-ptz="right">▶</button>
                          <button type="button" class="dpad-btn card card-down" data-ptz="down">▼</button>
                          <button type="button" class="dpad-btn card card-left" data-ptz="left">◀</button>
                          <button type="button" class="dpad-btn diag diag-upright" data-ptz="upright"><span style="transform:rotate(45deg)">▲</span></button>
                          <button type="button" class="dpad-btn diag diag-downright" data-ptz="downright"><span style="transform:rotate(135deg)">▲</span></button>
                          <button type="button" class="dpad-btn diag diag-downleft" data-ptz="downleft"><span style="transform:rotate(225deg)">▲</span></button>
                          <button type="button" class="dpad-btn diag diag-upleft" data-ptz="upleft"><span style="transform:rotate(-45deg)">▲</span></button>
                          <button type="button" class="dpad-btn dpad-center" id="ptzStopBtn" title="停止">⏹</button>
                        </div>
                        <div class="ptz-func-col">
                          <div class="ptz-func-group">
                            <div class="ptz-func-row">
                              <div class="ptz-func-btn" data-ptz="zoomin"><i>⊕</i><span>变倍+</span></div>
                              <div class="ptz-func-btn" data-ptz="zoomout"><i>⊖</i><span>变倍-</span></div>
                            </div>
                            <div class="ptz-func-row">
                              <div class="ptz-func-btn" data-focus="near"><i>◉</i><span>聚焦+</span></div>
                              <div class="ptz-func-btn" data-focus="far"><i>◎</i><span>聚焦-</span></div>
                            </div>
                            <div class="ptz-func-row">
                              <div class="ptz-func-btn" data-iris="in"><i>☀</i><span>光圈+</span></div>
                              <div class="ptz-func-btn" data-iris="out"><i>☼</i><span>光圈-</span></div>
                            </div>
                            <div class="ptz-func-row">
                              <div class="ptz-func-btn" id="dragZoomInBtn" data-dragzoom="in"><i>⬚</i><span>拉框放大</span></div>
                              <div class="ptz-func-btn" id="dragZoomOutBtn" data-dragzoom="out"><i>⬚</i><span>拉框缩小</span></div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div class="ptz-bottom">
                        <div class="slider-with-controls">
                          <span class="slider-label">速度</span>
                          <button type="button" class="slider-btn" id="speedMinus">−</button>
                          <input type="range" id="speedSlider" min="1" max="100" value="50">
                          <button type="button" class="slider-btn" id="speedPlus">+</button>
                          <span class="slider-value" id="speedValue">50</span>
                        </div>
                      </div>
                    </div>
                    <div class="ctrl-section">
                      <h4>预置位</h4>
                      <div class="ctrl-actions">
                        <button id="queryPresetButton" type="button">查询预置位</button>
                        <button id="callPresetButton" type="button">调用预置位</button>
                      </div>
                      <div id="presetTags" class="preset-tags"><span class="preset-empty">请先查询预置位</span></div>
                      <div class="preset-row">
                        <input id="presetIdInput" type="number" min="1" max="255" placeholder="预置位编号（点击上方标签或手输）">
                      </div>
                    </div>
                    <div class="ctrl-section">
                      <h4>辅助</h4>
                      <div class="ctrl-actions">
                        <button type="button" data-wiper="on">雨刷开</button>
                        <button type="button" data-wiper="off">雨刷关</button>
                      </div>
                    </div>
                  </fieldset>
                  <p class="ctrl-hint">方向/变倍/聚焦/光圈：按住即动，松开即停。控制接口使用数据库通道 ID（<code>channelId</code>），仅 GB28181 / JT1078 通道支持。</p>
                </div>
                <pre id="log" class="log" aria-label="请求日志"></pre>
              </div>
            </aside>
          </div>
        </div>
      `
    }
  })
}

defineDetailPanelElement()

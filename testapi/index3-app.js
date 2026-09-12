import { createWvpApi, getWsFlvUrl } from './components/shared/wvp.js'
import { createDeviceTree, mountDeviceTree } from './components/device-tree/device-tree.js'
import { createVideoGrid, mountVideoGrid } from './components/video-grid/video-grid.js'
import { createDetailPanel, mountDetailPanel } from './components/detail-panel/detail-panel.js'
import { createRecordPanel, mountRecordPanel } from './components/record-panel/record-panel.js'

    (function ($) {
      'use strict'

      // 测试页面固定使用当前 Docker WVP 实例；生产环境请勿在前端硬编码账号密码。
      var API_BASE = 'http://192.168.1.200:8080'
      var USERNAME = 'admin'
      var PASSWORD = 'ABCabc123@'
      var token = ''
      var rootNode = null
      var nodeSequence = 0
      var currentChannelId = null
      var currentChannelNode = null
      var jessibucaLoaded = false
      var controlDetailRequestSequence = 0
      var gridSlots = []
      var activeSlot = null
      var gridSize = 3
      var recordPlayback = {
        slot: null,
        deviceId: '',
        channelId: '',
        files: [],
        fileIndex: -1,
        streamInfo: null,
        stream: '',
        player: null,
        requestId: 0,
        downloadInfo: null,
        downloadTimer: null
      }

      var wvp = createWvpApi({
        $: $,
        apiBase: API_BASE,
        getToken: function () { return token }
      })
      var videoGrid = createVideoGrid({
        $: $,
        onSelect: function (slot) { selectSlot(slot) },
        onOpenDetail: function (slot) { openDetail(slot) },
        onRecord: function (slot) { openRecordPanel(slot) },
        onRemove: function (slot) { stopSlot(slot, true) }
      })
      var deviceTree = createDeviceTree({
        $: $,
        isChannel: isChannel,
        isLeaf: isLeaf,
        nodeLabel: nodeLabel,
        nodeDeviceId: nodeDeviceId,
        nodeOnline: nodeOnline,
        onToggle: function (node) { toggleNode(node) },
        onPlay: function (node) { playChannel(node) }
      })
      var detailPanel = createDetailPanel({
        $: $,
        onDisableControls: function () { exitDragZoom() }
      })
      var recordPanel = createRecordPanel({
        $: $,
        recordFileName: recordFileName,
        onPlayFile: function (index) { playRecordFile(index) },
        onDownloadFile: function (file) { startRecordDownload(file) }
      })

      $('#apiBaseText').text(API_BASE)

      /* ---------------- 通用工具 ---------------- */
      function log(message, type) {
        var now = new Date().toLocaleTimeString()
        var prefix = type === 'error' ? '[错误]' : type === 'success' ? '[成功]' : '[信息]'
        var current = $('#log').text()
        $('#log').text(current + (current ? '\n' : '') + now + ' ' + prefix + ' ' + message)
        var logElement = document.getElementById('log')
        logElement.scrollTop = logElement.scrollHeight
      }
      function setStatus(message, type) { $('#status').removeClass('success error loading').addClass(type || '').text(message) }
      function setPlayerState(message, type) { detailPanel.setPlayerState(message, type) }
      function setPlayerPlaceholder(message, isError) { detailPanel.setPlayerPlaceholder(message, isError) }
      function hidePlayerPlaceholder() { detailPanel.hidePlayerPlaceholder() }
      function setRecordState(message, type) { recordPanel.setState(message, type) }
      function setRecordPlaceholder(message, isError) { recordPanel.setPlaceholder(message, isError) }
      function hideRecordPlaceholder() { recordPanel.hidePlaceholder() }
      function setSlotState(slot, message, type) {
        slot.state = message
        slot.stateType = type || ''
        if (slot.$status) slot.$status.removeClass('success error loading').addClass(slot.stateType).text(message)
        if (activeSlot === slot) setPlayerState(message, type)
      }
      function setSlotPlaceholder(slot, message, isError) {
        slot.placeholder = message
        if (slot.$placeholder) slot.$placeholder.text(message).toggleClass('error', Boolean(isError)).toggle(!slot.player || !slot.playing)
        if (activeSlot === slot) setPlayerPlaceholder(message, isError)
      }
      function setTreeButtons(enabled) { $('#refreshButton, #expandButton, #collapseButton').prop('disabled', !enabled) }
      function setControlEnabled(enabled) { detailPanel.setControlEnabled(enabled) }

      function formatError(xhr, fallback) {
        return wvp.formatError(xhr, fallback)
      }

      /* ---------------- 通道类型 / 控制能力 ---------------- */
      function channelTypeName(dataType) {
        switch (Number(dataType)) {
          case 1: return 'GB28181'
          case 2: return '推流设备'
          case 3: return '拉流代理'
          case 200: return 'JT/T 1078'
          default: return '未知类型'
        }
      }
      function isControlSupported(data) {
        var dataType = Number(data && data.dataType)
        return dataType === 1 || dataType === 200
      }
      function updateControlState(node) {
        if (!node || !isChannel(node.data)) {
          $('#controlChannel').text('请选择在线通道')
          setControlEnabled(false)
          return
        }
        var channelId = nodeChannelId(node.data)
        var dataType = Number(node.data.dataType)
        if (!nodeOnline(node.data)) {
          $('#controlChannel').text('通道 ' + channelId + '（离线）')
          setControlEnabled(false)
        } else if (!node.data.dataType) {
          $('#controlChannel').text('通道 ' + channelId + '（读取类型中）')
          setControlEnabled(false)
        } else if (!isControlSupported(node.data)) {
          $('#controlChannel').text('通道 ' + channelId + '（' + channelTypeName(dataType) + '不支持云台）')
          setControlEnabled(false)
        } else {
          $('#controlChannel').text('通道 ' + channelId + '（' + channelTypeName(dataType) + '）')
          setControlEnabled(channelId !== '')
        }
      }
      function loadChannelDetail(node) {
        if (!node || !isChannel(node.data)) return
        var channelId = nodeChannelId(node.data)
        var requestId = ++controlDetailRequestSequence
        updateControlState(node)
        if (channelId === '') return
        wvp.getChannelOne(channelId).then(function (detail) {
          if (requestId !== controlDetailRequestSequence || currentChannelNode !== node) return
          if (!detail) throw new Error('通道详情为空')
          node.data = $.extend({}, node.data, detail)
          updateControlState(node)
          log('通道 ' + channelId + ' 类型：' + channelTypeName(node.data.dataType))
        }).catch(function (error) {
          if (requestId !== controlDetailRequestSequence || currentChannelNode !== node) return
          setControlEnabled(false)
          $('#controlChannel').text('通道类型读取失败')
          log('读取通道 ' + channelId + ' 控制能力失败：' + (error.message || error), 'error')
        })
      }

      function controlChannelId() {
        if (!currentChannelNode || !isChannel(currentChannelNode.data)) throw new Error('请先选择通道')
        var channelId = nodeChannelId(currentChannelNode.data)
        if (channelId === '') throw new Error('当前通道缺少数据库 ID')
        if (!nodeOnline(currentChannelNode.data)) throw new Error('当前通道离线，无法控制')
        if (!isControlSupported(currentChannelNode.data)) throw new Error('当前通道为' + channelTypeName(currentChannelNode.data.dataType) + '，不支持云台控制')
        return channelId
      }

      function requestControl(request, data, description) {
        return request(data, 30000)
          .then(function (result) { log(description + '成功', 'success'); return result })
          .catch(function (error) {
            log(description + '失败：' + (error && error.message ? error.message : description + '失败'), 'error')
            throw error
          })
      }

      /* ---------------- 移植自 channelPtzPanel：commonChanel/ptz|focus|iris ---------------- */
      var controSpeed = 50
      var currentCommand = null

      function speed() { return controSpeed }

      // 对应 channelPtzPanel.onPtzMove / onPtzStop
      function ptz(command, sp) {
        var channelId = controlChannelId()
        return requestControl(function (requestData, timeout) {
          return wvp.ptz(channelId, command, sp, timeout)
        }, {}, '云台 ' + command)
      }
      // 对应 channelPtzPanel.onFocusMove / onFocusStop
      function focus(command, sp) {
        var channelId = controlChannelId()
        return requestControl(function (requestData, timeout) {
          return wvp.focus(channelId, command, sp, timeout)
        }, {}, '聚焦 ' + command)
      }
      // 对应 channelPtzPanel.onIrisMove / onIrisStop
      function iris(command, sp) {
        var channelId = controlChannelId()
        return requestControl(function (requestData, timeout) {
          return wvp.iris(channelId, command, sp, timeout)
        }, {}, '光圈 ' + command)
      }
      function wiper(command) {
        var channelId = controlChannelId()
        return requestControl(function (requestData, timeout) {
          return wvp.wiper(channelId, command, timeout)
        }, {}, '雨刷 ' + command)
      }

      function safe(fn) {
        try { var p = fn(); if (p && p.catch) p.catch(function () {}) } catch (e) { log(e.message || '控制失败', 'error') }
      }

      // 对应 ptzControls.handlePtzMove / handlePtzStop / onWindowMouseUp：按住即动，松开即停
      function bindHold($el, onDown, onUp) {
        $el.on('mousedown touchstart', function (e) {
          if (e.type === 'mousedown' && e.button !== 0) return
          e.preventDefault()
          $(this).addClass('pressed')
          currentCommand = { el: this, up: onUp }
          onDown.call(this)
        })
        $el.on('mouseup touchend', function (e) {
          e.preventDefault()
          releaseHold()
        })
      }
      function releaseHold() {
        if (!currentCommand) return
        $(currentCommand.el).removeClass('pressed')
        var up = currentCommand.up
        currentCommand = null
        up()
      }
      $(window).on('mouseup touchend touchcancel', releaseHold)

      bindHold($('[data-ptz]'), function () {
        var direction = $(this).data('ptz')
        safe(function () { return ptz(direction, speed()) })
      }, function () {
        safe(function () { return ptz('stop', 0) })
      })
      bindHold($('[data-focus]'), function () {
        var command = $(this).data('focus')
        safe(function () { return focus(command, speed()) })
      }, function () {
        safe(function () { return focus('stop', 0) })
      })
      bindHold($('[data-iris]'), function () {
        var command = $(this).data('iris')
        safe(function () { return iris(command, speed()) })
      }, function () {
        safe(function () { return iris('stop', 0) })
      })
      $('#ptzStopBtn').on('click', function () { safe(function () { return ptz('stop', 0) }) })
      $('[data-wiper]').on('click', function () {
        var command = $(this).data('wiper')
        safe(function () { return wiper(command) })
      })

      // 速度滑块，对应 ptzControls.controSpeed / adjustSpeed
      function setSpeed(v) {
        v = Math.max(1, Math.min(100, Number(v) || 50))
        controSpeed = v
        $('#speedSlider').val(v)
        $('#speedValue').text(v)
      }
      $('#speedSlider').on('input change', function () { setSpeed($(this).val()) })
      $('#speedMinus').on('click', function () { setSpeed(controSpeed - 1) })
      $('#speedPlus').on('click', function () { setSpeed(controSpeed + 1) })

      /* ---------------- 拉框放大 / 缩小（对应 toggleDragZoom + drag_zoom_in/out） ---------------- */
      var dragZoomDirection = ''
      var dragStart = null

      function enterDragZoom(direction) {
        if (dragZoomDirection === direction) { exitDragZoom(); return }
        try { controlChannelId() } catch (e) { log(e.message, 'error'); return }
        dragZoomDirection = direction
        $('#dragLayer').addClass('active')
        $('#dragTip').text('在画面上拖动鼠标框选' + (direction === 'in' ? '放大' : '缩小') + '区域，右键或 Esc 取消')
        $('#dragZoomInBtn').toggleClass('active-mode', direction === 'in')
        $('#dragZoomOutBtn').toggleClass('active-mode', direction === 'out')
      }
      function exitDragZoom() {
        dragZoomDirection = ''
        dragStart = null
        $('#dragLayer').removeClass('active')
        $('#dragRect').hide()
        $('#dragZoomInBtn, #dragZoomOutBtn').removeClass('active-mode')
      }
      $('#dragZoomInBtn').on('click', function () { enterDragZoom('in') })
      $('#dragZoomOutBtn').on('click', function () { enterDragZoom('out') })
      $(document).on('keydown', function (e) {
        if (e.key !== 'Escape') return
        if (dragZoomDirection) exitDragZoom()
        else if ($('#detailModal').hasClass('visible')) closeDetail()
      })
      $('#dragLayer').on('contextmenu', function (e) { e.preventDefault(); exitDragZoom() })

      $('#dragLayer').on('mousedown', function (e) {
        if (e.button !== 0 || !dragZoomDirection) return
        var rect = this.getBoundingClientRect()
        dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        $('#dragRect').css({ left: dragStart.x, top: dragStart.y, width: 0, height: 0 }).show()
      })
      $('#dragLayer').on('mousemove', function (e) {
        if (!dragStart) return
        var rect = this.getBoundingClientRect()
        var x = e.clientX - rect.left, y = e.clientY - rect.top
        $('#dragRect').css({
          left: Math.min(x, dragStart.x), top: Math.min(y, dragStart.y),
          width: Math.abs(x - dragStart.x), height: Math.abs(y - dragStart.y)
        })
      })
      $('#dragLayer').on('mouseup', function (e) {
        if (e.button !== 0 || !dragStart) return
        var rect = this.getBoundingClientRect()
        var x = e.clientX - rect.left, y = e.clientY - rect.top
        var lengthX = Math.round(Math.abs(x - dragStart.x))
        var lengthY = Math.round(Math.abs(y - dragStart.y))
        var midPointX = Math.round((x + dragStart.x) / 2)
        var midPointY = Math.round((y + dragStart.y) / 2)
        var direction = dragZoomDirection
        dragStart = null
        $('#dragRect').hide()
        if (lengthX < 5 || lengthY < 5) { log('拉框区域太小，已忽略'); return }
        safe(function () {
          var channelId = controlChannelId()
          return requestControl(function (requestData, timeout) {
            return wvp.dragZoom(channelId, direction, requestData, timeout)
          }, {
            length: Math.round(rect.width),
            width: Math.round(rect.height),
            midPointX: midPointX, midPointY: midPointY,
            lengthX: lengthX, lengthY: lengthY
          }, direction === 'in' ? '拉框放大' : '拉框缩小')
        })
        exitDragZoom()
      })

      /* ---------------- 预置位 ---------------- */
      function queryPresets() {
        var channelId = controlChannelId()
        return requestControl(function (requestData, timeout) {
          return wvp.queryPresets(channelId, timeout)
        }, {}, '预置位查询')
          .then(function (presets) {
            var $tags = $('#presetTags').empty()
            if (!Array.isArray(presets) || !presets.length) {
              $tags.append($('<span>', { 'class': 'preset-empty', text: '设备未返回预置位' }))
              return presets
            }
            $.each(presets, function (_, preset) {
              var presetId = preset.presetId === undefined ? '' : preset.presetId
              $tags.append($('<span>', {
                'class': 'preset-tag',
                text: preset.presetName || ('预置位 ' + presetId),
                title: '编号 ' + presetId
              }).on('click', function () {
                $('#presetIdInput').val(presetId)
                safe(callPreset)
              }))
            })
            return presets
          })
      }
      function callPreset() {
        var channelId = controlChannelId()
        var presetId = Number($('#presetIdInput').val())
        if (!Number.isInteger(presetId) || presetId < 1 || presetId > 255) throw new Error('预置位编号必须是 1-255 的整数')
        return requestControl(function (requestData, timeout) {
          return wvp.callPreset(channelId, presetId, timeout)
        }, {}, '调用预置位 ' + presetId)
      }
      $('#queryPresetButton').on('click', function () { safe(queryPresets) })
      $('#callPresetButton').on('click', function () { safe(callPreset) })

      /* ---------------- 登录 ---------------- */
      function login() {
        setStatus('正在登录…', 'loading')
        log('GET /api/user/login')
        return wvp.login(USERNAME, CryptoJS.MD5(PASSWORD).toString()).then(function (data) {
          if (!data || !data.accessToken) throw new Error('登录成功但未返回 accessToken')
          token = data.accessToken
          setStatus('登录成功', 'success')
          setTreeButtons(true)
          log('登录成功，已获取 access-token', 'success')
          return token
        }).catch(function (error) {
          token = ''
          setTreeButtons(false)
          setStatus('登录失败', 'error')
          log(error && error.message ? error.message : '登录请求失败，请检查 API 地址、账号或密码', 'error')
          throw error
        })
      }

      /* ---------------- 树 ---------------- */
      function createVirtualRoot() {
        return {
          key: 'root',
          data: { id: null, treeId: '', deviceId: '', name: '根资源组', type: 0, leaf: false, isLeaf: false },
          isRoot: true, loaded: false, loading: false, expanded: false, children: []
        }
      }
      function isChannel(data) { return Number(data.type) === 1 }
      function isLeaf(data) { return isChannel(data) || data.leaf === true || data.isLeaf === true }
      function nodeLabel(data) { return data.name || data.gbName || data.deviceId || data.gbDeviceId || '未命名节点' }
      function nodeDeviceId(data) { return data.deviceId || data.gbDeviceId || '' }
      function nodeOnline(data) { return data.status === 'ON' || data.gbStatus === 'ON' }
      // GroupTree 的通道节点由 wvp_device_channel.id 映射而来；id 是播放/控制接口所需的数据库 ID。
      function nodeChannelId(data) { return data.id !== undefined && data.id !== null ? data.id : '' }

      function apiPathFor(node) {
        var params = { hasChannel: node.isRoot ? 'false' : 'true' }
        if (!node.isRoot && node.data.id !== null && node.data.id !== undefined) params.parent = node.data.id
        return '/api/group/tree/list?' + $.param(params)
      }

      function setSelectedNode(node) {
        $('.tree-row.selected').removeClass('selected')
        if (node && node.$row) node.$row.addClass('selected')
        currentChannelNode = node || null
        exitDragZoom()
        if (node && isChannel(node.data)) {
          var channelId = nodeChannelId(node.data)
          $('#playerChannelName').text(nodeLabel(node.data))
          $('#playerChannelId').text('通道 ID：' + channelId + (nodeDeviceId(node.data) ? '｜设备：' + nodeDeviceId(node.data) : ''))
          $('#stopButton').prop('disabled', false)
          $('#presetTags').empty().append($('<span>', { 'class': 'preset-empty', text: '请先查询预置位' }))
          updateControlState(node)
          loadChannelDetail(node)
        } else {
          ++controlDetailRequestSequence
          $('#playerChannelName').text('未选择通道')
          $('#playerChannelId').text('请选择左侧在线通道开始播放')
          $('#stopButton').prop('disabled', true)
          $('#controlChannel').text('请选择在线通道')
          setControlEnabled(false)
        }
      }

      function renderNode(node) {
        return deviceTree.renderNode(node)
      }

      function renderChildren(node) {
        deviceTree.renderChildren(node)
      }

      function replaceRoot() {
        rootNode = createVirtualRoot()
        deviceTree.renderRoot(rootNode)
      }

      function loadChildren(node) {
        if (node.loading) return $.Deferred().reject().promise()
        node.loading = true
        node.expanded = true
        if (node.$toggle) node.$toggle.removeClass('empty').addClass('loading').text('…')
        if (node.$children) node.$children.show().empty().append($('<li>', { 'class': 'loading-row', text: '正在加载…' }))
        var path = apiPathFor(node)
        log('GET ' + path)
        return wvp.getGroupTree(node.isRoot, node.isRoot ? null : node.data.id).then(function (data) {
          if (!Array.isArray(data)) throw new Error('树接口返回的数据不是数组')
          node.children = data.map(function (item) {
            nodeSequence += 1
            return { key: (item.treeId || item.deviceId || 'node') + '-' + nodeSequence, data: item, isRoot: false, loaded: false, loading: false, expanded: false, children: [] }
          })
          node.loaded = true
          renderChildren(node)
          log('返回 ' + data.length + ' 个节点', 'success')
          return data
        }).catch(function (error) {
          var message = error && error.message ? error.message : '树节点请求失败'
          if (node.$children) node.$children.empty().append($('<li>', { 'class': 'error-row', text: message }))
          log(message, 'error')
          return $.Deferred().reject(error).promise()
        }).always(function () {
          node.loading = false
          if (node.$toggle) node.$toggle.removeClass('loading').text(node.expanded ? '▾' : '▸')
        })
      }

      function toggleNode(node) {
        if (isLeaf(node.data)) return
        if (node.expanded) {
          node.expanded = false
          if (node.$children) node.$children.slideUp(100)
          if (node.$toggle) node.$toggle.text('▸')
          return
        }
        node.expanded = true
        if (node.$children) node.$children.slideDown(100)
        if (node.loaded) { if (node.$toggle) node.$toggle.text('▾'); return }
        loadChildren(node).catch(function () {
          node.expanded = false
          if (node.$children) node.$children.hide()
          if (node.$toggle) node.$toggle.text('▸')
        })
      }

      function expandAll(node) {
        if (isLeaf(node.data)) return $.Deferred().resolve().promise()
        node.expanded = true
        if (node.$children) node.$children.show()
        return (node.loaded ? $.Deferred().resolve().promise() : loadChildren(node)).then(function () {
          var tasks = []
          $.each(node.children, function (_, child) { if (!isLeaf(child.data)) tasks.push(expandAll(child)) })
          return $.when.apply($, tasks)
        })
      }
      function collapseAll(node) {
        if (node.$children) node.$children.hide()
        if (node.$toggle && !isLeaf(node.data)) node.$toggle.text('▸')
        node.expanded = false
        $.each(node.children, function (_, child) { collapseAll(child) })
      }

      /* ---------------- 多路宫格 ---------------- */
      function findSlot(channelId) {
        return videoGrid.findSlot(gridSlots, channelId)
      }
      function renderGrid() {
        closeRecordPanel()
        if ($('#detailModal').hasClass('visible')) closeDetail()
        var oldSlots = gridSlots.slice()
        var result = videoGrid.render(gridSize, oldSlots)
        gridSlots = result.slots
        $.each(result.removedSlots, function (_, slot) { stopSlot(slot, false) })
      }
      function clearSlotView(slot) {
        if (!slot) return
        if (slot.player) {
          try { slot.player.pause(); slot.player.clearView() } catch (error) { console.warn('停止 Jessibuca 失败', error) }
          try { slot.player.destroy() } catch (error) {}
        }
        slot.player = null
        slot.playing = false
        slot.$container.empty().appendTo(slot.$slot)
        slot.$placeholder.show()
      }
      function selectSlot(slot) {
        if (!slot) return
        $('.video-slot.selected').removeClass('selected')
        slot.$slot.addClass('selected')
        setSelectedNode(slot.node)
        activeSlot = slot
        currentChannelId = slot.channelId
        if (slot.state) setPlayerState(slot.state, slot.stateType)
      }
      function resizeSlotPlayer(slot) {
        if (!slot || !slot.player || !slot.player.resize) return
        var resize = function () {
          try { slot.player.resize() } catch (error) { console.warn('恢复 Jessibuca 尺寸失败', error) }
        }
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(function () { window.requestAnimationFrame(resize) })
        } else {
          setTimeout(resize, 0)
        }
      }
      function openDetail(slot) {
        selectSlot(slot)
        detailPanel.open(slot, slot.state, slot.stateType, slot.playing, slot.placeholder)
        resizeSlotPlayer(slot)
      }
      function closeDetail() {
        if (!activeSlot) { detailPanel.close(null, false); return }
        var slot = activeSlot
        detailPanel.close(slot, slot.playing)
        exitDragZoom()
        resizeSlotPlayer(slot)
      }

      function stopSlot(slot, remove) {
        if (!slot) return $.Deferred().resolve().promise()
        var channelId = slot.channelId
        slot.requestId += 1
        if (recordPlayback.slot === slot) closeRecordPanel()
        if (activeSlot === slot) {
          closeDetail()
          activeSlot = null
          setSelectedNode(null)
        }
        var stopPromise = requestStop(channelId)
        clearSlotView(slot)
        slot.node = null
        slot.channelId = null
        slot.wsUrl = ''
        slot.state = '空闲'
        slot.stateType = ''
        slot.placeholder = '等待添加通道'
        slot.$name.text('未添加通道')
        slot.$slot.removeClass('has-channel')
        setSlotState(slot, '空闲')
        setSlotPlaceholder(slot, slot.placeholder, false)
        if (remove) slot.$slot.removeClass('selected')
        return stopPromise
      }

      /* ---------------- WebRTC 播放 ---------------- */
      function requestStop(channelId) {
        if (channelId === null || channelId === undefined || channelId === '') return $.Deferred().resolve().promise()
        log('GET /api/common/channel/play/stop?channelId=' + encodeURIComponent(channelId))
        return wvp.stopChannel(channelId, 10000).then(function () {
          log('已请求停止通道 ' + channelId, 'success')
        }, function (xhr) {
          log(formatError(xhr, '停止播放请求失败'), 'error')
        })
      }

      /* ---------------- Jessibuca ws-flv 播放（参照 web/src/views/common/jessibuca.vue） ---------------- */
      function createJessibuca(slot) {
        if (slot.player) return slot.player
        if (!window.Jessibuca) throw new Error('未加载 jessibuca.js，请确认 static/js/jessibuca/ 与本页同源可访问')
        var container = slot.$container[0]
        slot.player = new window.Jessibuca({
          container: container,
          videoBuffer: 0,
          isResize: true,
          useMSE: false,
          useWCS: false,
          text: '',
          controlAutoHide: false,
          debug: false,
          hotKey: true,
          decoder: 'static/js/jessibuca/decoder.js',
          isNotMute: false,
          timeout: 10,
          recordType: 'mp4',
          isFlv: false,
          forceNoOffscreen: true,
          hasAudio: true,
          heartTimeout: 5,
          heartTimeoutReplay: true,
          heartTimeoutReplayTimes: 3,
          hiddenAutoPause: false,
          isFullResize: false,
          keepScreenOn: true,
          loadingText: '请稍等, 视频加载中......',
          loadingTimeout: 10,
          loadingTimeoutReplay: true,
          loadingTimeoutReplayTimes: 3,
          openWebglAlignment: false,
          operateBtns: { fullscreen: true, screenshot: true, play: true, audio: true, recorder: false },
          showBandwidth: true,
          supportDblclickFullscreen: false,
          useWebFullSreen: true,
          wasmDecodeErrorReplay: true,
          wcsUseVideoRendcer: true
        })
        slot.player.on('load', function () { jessibucaLoaded = true })
        slot.player.on('play', function () {
          slot.playing = true
          setSlotState(slot, '播放中', 'success')
          setSlotPlaceholder(slot, '', false)
          if (activeSlot === slot) hidePlayerPlaceholder()
          log('通道 ' + slot.channelId + ' ws-flv 播放成功', 'success')
        })
        slot.player.on('pause', function () { slot.playing = false; setSlotState(slot, '已暂停') })
        slot.player.on('videoInfo', function (msg) { log('通道 ' + slot.channelId + ' 视频信息：' + JSON.stringify(msg)) })
        slot.player.on('audioInfo', function (msg) { log('通道 ' + slot.channelId + ' 音频信息：' + JSON.stringify(msg)) })
        slot.player.on('error', function (msg) {
          slot.playing = false
          setSlotState(slot, '播放错误', 'error')
          setSlotPlaceholder(slot, 'Jessibuca 错误：' + msg, true)
          log('Jessibuca error: ' + msg, 'error')
        })
        slot.player.on('timeout', function (msg) {
          slot.playing = false
          setSlotState(slot, '连接超时', 'error')
          setSlotPlaceholder(slot, 'ws-flv 连接超时，请检查 nginx 是否代理了该流路径。', true)
          log('Jessibuca timeout: ' + msg, 'error')
        })
        slot.player.on('loadingTimeout', function (msg) { log('通道 ' + slot.channelId + ' loadingTimeout: ' + msg, 'error') })
        slot.player.on('delayTimeout', function (msg) { log('通道 ' + slot.channelId + ' delayTimeout: ' + msg, 'error') })
        return slot.player
      }

      function jessibucaPlay(slot, url) {
        var player = createJessibuca(slot)
        if (player.hasLoaded && player.hasLoaded()) {
          player.play(url)
        } else if (jessibucaLoaded) {
          player.play(url)
        } else {
          player.on('load', function () { player.play(url) })
        }
      }

      /* ---------------- 国标录像：移植自 device/channel/record.vue ---------------- */
      function formatRecordDate(value) {
        var date = new Date(value)
        if (isNaN(date.getTime())) return String(value || '')
        var pad = function (number) { return String(number).padStart(2, '0') }
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
      }
      function recordFileName(file) {
        return formatRecordDate(file.startTime).slice(11) + ' - ' + formatRecordDate(file.endTime).slice(11)
      }
      function recordIdentity(slot) {
        var data = slot && slot.node ? slot.node.data : {}
        return {
          deviceId: data.parentDeviceId || data.gbParentDeviceId || data.parentIdForDevice || '',
          channelId: data.deviceId || data.gbDeviceId || data.channelDeviceId || ''
        }
      }
      function destroyRecordPlayer() {
        if (!recordPlayback.player) return
        try { recordPlayback.player.pause() } catch (error) {}
        try { recordPlayback.player.clearView() } catch (error) {}
        try { recordPlayback.player.destroy() } catch (error) {}
        recordPlayback.player = null
        $('#recordPlayerContainer').empty()
      }
      function createRecordPlayer() {
        if (recordPlayback.player) return recordPlayback.player
        if (!window.Jessibuca) throw new Error('未加载 jessibuca.js，无法回放录像')
        recordPlayback.player = new window.Jessibuca({
          container: $('#recordPlayerContainer')[0],
          videoBuffer: 0,
          isResize: true,
          useMSE: false,
          useWCS: false,
          text: '',
          controlAutoHide: false,
          debug: false,
          hotKey: true,
          decoder: 'static/js/jessibuca/decoder.js',
          isNotMute: false,
          timeout: 10,
          recordType: 'mp4',
          isFlv: false,
          forceNoOffscreen: true,
          hasAudio: true,
          heartTimeout: 5,
          heartTimeoutReplay: true,
          heartTimeoutReplayTimes: 3,
          hiddenAutoPause: false,
          isFullResize: false,
          keepScreenOn: true,
          loadingText: '请稍等, 视频加载中......',
          loadingTimeout: 10,
          loadingTimeoutReplay: true,
          loadingTimeoutReplayTimes: 3,
          openWebglAlignment: false,
          operateBtns: { fullscreen: true, screenshot: true, play: true, audio: true, recorder: false },
          showBandwidth: true,
          supportDblclickFullscreen: false,
          useWebFullSreen: true,
          wasmDecodeErrorReplay: true,
          wcsUseVideoRendcer: true
        })
        recordPlayback.player.on('play', function () {
          setRecordState('回放中', 'success')
          hideRecordPlaceholder()
        })
        recordPlayback.player.on('pause', function () { setRecordState('已暂停') })
        recordPlayback.player.on('error', function (message) {
          setRecordState('回放失败', 'error')
          setRecordPlaceholder('Jessibuca 错误：' + message, true)
          log('录像 Jessibuca error: ' + message, 'error')
        })
        recordPlayback.player.on('timeout', function (message) {
          setRecordState('连接超时', 'error')
          setRecordPlaceholder('录像 ws-flv 连接超时', true)
          log('录像回放超时：' + message, 'error')
        })
        recordPlayback.player.on('loadingTimeout', function (message) { log('录像 loadingTimeout：' + message, 'error') })
        return recordPlayback.player
      }
      function setRecordControls(enabled) {
        recordPanel.setControls(enabled)
      }
      function renderRecordTimeline() {
        recordPanel.renderTimeline(recordPlayback.files)
      }
      function renderRecordFiles() {
        recordPanel.renderFiles(recordPlayback.files)
      }
      function markRecordFile(index) {
        recordPanel.markFile(index)
      }
      function ensureRecordIdentity(slot) {
        var identity = recordIdentity(slot)
        if (identity.deviceId && identity.channelId) return $.Deferred().resolve(identity).promise()
        return wvp.getChannelOne(slot.channelId, 15000).then(function (detail) {
          slot.node.data = $.extend({}, slot.node.data, detail)
          identity = recordIdentity(slot)
          if (!identity.deviceId || !identity.channelId) throw new Error('通道详情缺少设备国标编号或通道国标编号')
          return identity
        })
      }
      function queryRecordFiles() {
        if (!recordPlayback.slot) return
        var date = $('#recordDate').val()
        if (!date) { setRecordState('请选择日期', 'error'); return }
        var identity = { deviceId: recordPlayback.deviceId, channelId: recordPlayback.channelId }
        var requestId = ++recordPlayback.requestId
        var startTime = date + ' 00:00:00'
        var endTime = date + ' 23:59:59'
        recordPlayback.files = []
        recordPlayback.fileIndex = -1
        renderRecordFiles()
        setRecordState('正在查询录像…', 'loading')
        setRecordPlaceholder('正在向设备查询录像，请稍候…')
        log('GET /api/gb_record/query/' + identity.deviceId + '/' + identity.channelId + ' ' + startTime + ' - ' + endTime)
        stopRecordPlayback().always(function () {
          if (requestId !== recordPlayback.requestId || !recordPlayback.slot) return
          wvp.queryRecords(identity.deviceId, identity.channelId, startTime, endTime, 60000).then(function (data) {
            if (requestId !== recordPlayback.requestId || !recordPlayback.slot) return
            recordPlayback.files = Array.isArray(data && data.recordList) ? data.recordList : []
            renderRecordFiles()
            setRecordState('查询完成', 'success')
            log('录像查询完成，共 ' + recordPlayback.files.length + ' 段', 'success')
          }).catch(function (error) {
            if (requestId !== recordPlayback.requestId || !recordPlayback.slot) return
            var message = error && error.message ? error.message : '录像查询失败'
            setRecordState('查询失败', 'error')
            recordPanel.showError(message)
            log(message, 'error')
          })
        })
      }
      function stopRecordPlayback() {
        var stream = recordPlayback.stream
        var deviceId = recordPlayback.deviceId
        var channelId = recordPlayback.channelId
        var stopPromise = $.Deferred().resolve().promise()
        if (stream && deviceId && channelId) {
          log('GET /api/playback/stop/' + deviceId + '/' + channelId + '/' + stream)
          stopPromise = wvp.stopPlayback(deviceId, channelId, stream, 15000)
            .fail(function (xhr) { log(formatError(xhr, '停止录像回放失败'), 'error') })
        }
        destroyRecordPlayer()
        recordPlayback.streamInfo = null
        recordPlayback.stream = ''
        $('#recordSeek').prop({ disabled: true, min: 0, max: 0, value: 0 })
        $('#recordTimeLabel').text('未播放')
        setRecordControls(false)
        return stopPromise
      }
      function playRecordFile(index) {
        if (!recordPlayback.files[index]) return
        var file = recordPlayback.files[index]
        var requestId = ++recordPlayback.requestId
        recordPlayback.fileIndex = index
        markRecordFile(index)
        $('#recordTitle').text(recordFileName(file))
        var duration = Math.max(0, Math.round((new Date(file.endTime).getTime() - new Date(file.startTime).getTime()) / 1000))
        $('#recordTimeLabel').text(formatRecordDate(file.startTime))
        setRecordState('正在请求回放…', 'loading')
        setRecordPlaceholder('正在请求录像回放流…')
        stopRecordPlayback().always(function () {
          if (requestId !== recordPlayback.requestId) return
          $('#recordSeek').prop({ disabled: false, min: 0, max: duration, value: 0 })
          wvp.startPlayback(recordPlayback.deviceId, recordPlayback.channelId, file.startTime, file.endTime, 60000).then(function (streamContent) {
            if (requestId !== recordPlayback.requestId) return
            recordPlayback.streamInfo = streamContent
            recordPlayback.stream = streamContent && streamContent.stream ? streamContent.stream : ''
            var info = (streamContent && streamContent.transcodeStream) || streamContent
            var wsUrl = getWsFlvUrl(info)
            if (!wsUrl) throw new Error('回放接口未返回 ws_flv/wss_flv 地址')
            var player = createRecordPlayer()
            player.play(wsUrl)
            setRecordControls(true)
            setRecordState('正在连接…', 'loading')
            log('收到录像 ws-flv 地址：' + wsUrl)
          }).catch(function (error) {
            if (requestId !== recordPlayback.requestId) return
            var message = error && error.message ? error.message : '录像回放失败'
            setRecordState('回放失败', 'error')
            setRecordPlaceholder(message, true)
            log(message, 'error')
          })
        })
      }
      function openRecordPanel(slot) {
        if (!slot || !slot.node) return
        if (Number(slot.node.data.dataType) !== 1 && slot.node.data.dataType !== undefined) {
          log('当前通道不是 GB28181 通道，暂不支持国标录像', 'error')
          return
        }
        if ($('#detailModal').hasClass('visible')) closeDetail()
        selectSlot(slot)
        var requestId = ++recordPlayback.requestId
        recordPlayback.slot = slot
        recordPlayback.files = []
        recordPlayback.fileIndex = -1
        $('#recordDate').val(new Date().toISOString().slice(0, 10))
        $('#recordChannel').text(nodeLabel(slot.node.data))
        $('#recordIds').text('正在读取通道编号…')
        $('#recordTitle').text('未选择录像')
        $('#recordDownloadState').text('')
        setRecordState('准备查询', 'loading')
        setRecordPlaceholder('正在读取通道信息…')
        renderRecordFiles()
        recordPanel.show()
        ensureRecordIdentity(slot).then(function (identity) {
          if (recordPlayback.slot !== slot || requestId !== recordPlayback.requestId) return
          recordPlayback.deviceId = identity.deviceId
          recordPlayback.channelId = identity.channelId
          $('#recordIds').text('设备：' + identity.deviceId + '｜通道：' + identity.channelId)
          queryRecordFiles()
        }).catch(function (error) {
          if (recordPlayback.slot !== slot || requestId !== recordPlayback.requestId) return
          var message = error && error.message ? error.message : '读取通道信息失败'
          setRecordState('打开失败', 'error')
          setRecordPlaceholder(message, true)
          log(message, 'error')
        })
        $('#recordClose').focus()
      }
      function closeRecordPanel() {
        recordPlayback.requestId += 1
        stopRecordDownload()
        stopRecordPlayback()
        recordPanel.hide()
        recordPlayback.slot = null
        recordPlayback.files = []
        recordPlayback.fileIndex = -1
        recordPlayback.deviceId = ''
        recordPlayback.channelId = ''
        $('#recordDownloadState').text('')
      }
      function toggleRecordPause() {
        if (!recordPlayback.player || !recordPlayback.stream) return
        var command = recordPanel.getPauseCommand()
        wvp.playbackCommand(command, recordPlayback.stream, 15000)
          .fail(function (xhr) { log(formatError(xhr, '录像' + command + '失败'), 'error') })
        if (command === 'pause') {
          try { recordPlayback.player.pause() } catch (error) {}
          recordPanel.setPauseLabel('继续')
        } else {
          try {
            if (recordPlayback.player.unPause) recordPlayback.player.unPause()
            else recordPlayback.player.play(getWsFlvUrl((recordPlayback.streamInfo && recordPlayback.streamInfo.transcodeStream) || recordPlayback.streamInfo))
          } catch (error) {}
          recordPanel.setPauseLabel('暂停')
          setRecordState('回放中', 'success')
        }
      }
      function changeRecordSpeed(speed) {
        if (!recordPlayback.stream) return
        wvp.setPlaybackSpeed(recordPlayback.stream, speed, 15000)
          .done(function () {
            if (recordPlayback.player && recordPlayback.player.setPlaybackRate) recordPlayback.player.setPlaybackRate(Number(speed))
            log('录像回放倍速：' + speed + 'x', 'success')
          }).fail(function (xhr) { log(formatError(xhr, '设置录像倍速失败'), 'error') })
      }
      function seekRecord(seconds) {
        if (!recordPlayback.stream) return
        wvp.seekPlayback(recordPlayback.stream, seconds, 15000)
          .fail(function (xhr) { log(formatError(xhr, '录像拖动失败'), 'error') })
      }
      function triggerRecordDownload(path) {
        if (!path) return
        var link = document.createElement('a')
        link.href = path
        link.target = '_blank'
        link.download = (recordPlayback.deviceId || 'record') + '-' + (recordPlayback.channelId || 'channel') + '.mp4'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      function stopRecordDownload() {
        var info = recordPlayback.downloadInfo
        if (recordPlayback.downloadTimer) {
          window.clearTimeout(recordPlayback.downloadTimer)
          recordPlayback.downloadTimer = null
        }
        recordPlayback.downloadInfo = null
        if (!info || !info.stream) return $.Deferred().resolve().promise()
        log('GET /api/gb_record/download/stop/' + info.deviceId + '/' + info.channelId + '/' + info.stream)
        return wvp.stopRecordDownload(info.deviceId, info.channelId, info.stream, 15000)
          .done(function () { log('已停止录像下载', 'success') })
          .fail(function (xhr) { log(formatError(xhr, '停止录像下载失败'), 'error') })
      }
      function pollRecordDownload() {
        var info = recordPlayback.downloadInfo
        if (!info || !info.stream) return
        wvp.getDownloadProgress(info.deviceId, info.channelId, info.stream, 15000).then(function (data) {
          if (recordPlayback.downloadInfo !== info) return
          var progress = Number(data && data.progress || 0)
          $('#recordDownloadState').text('下载进度：' + (progress * 100).toFixed(1) + '%')
          var pathInfo = data && data.downLoadFilePath
          if (pathInfo) {
            var path = window.location.protocol === 'https:' ? (pathInfo.httpsPath || pathInfo.httpPath) : (pathInfo.httpPath || pathInfo.httpsPath)
            $('#recordDownloadState').text('下载完成，正在打开文件')
            triggerRecordDownload(path)
            recordPlayback.downloadInfo = null
            return
          }
          recordPlayback.downloadTimer = window.setTimeout(pollRecordDownload, 5000)
        }).catch(function (error) {
          if (recordPlayback.downloadInfo !== info) return
          $('#recordDownloadState').text('下载进度查询失败：' + (error.message || error))
        })
      }
      function startRecordDownload(file) {
        if (!file || !recordPlayback.deviceId || !recordPlayback.channelId) return
        var speed = 4
        var requestId = recordPlayback.requestId
        $('#recordDownloadState').text('正在请求录像下载…')
        stopRecordDownload().always(function () {
          if (requestId !== recordPlayback.requestId || !recordPlayback.slot) return
          stopRecordPlayback().always(function () {
            if (requestId !== recordPlayback.requestId || !recordPlayback.slot) return
            wvp.startRecordDownload(recordPlayback.deviceId, recordPlayback.channelId, {
              startTime: file.startTime, endTime: file.endTime, downloadSpeed: speed
            }, 60000).then(function (data) {
              if (requestId !== recordPlayback.requestId || !recordPlayback.slot) return
              recordPlayback.downloadInfo = { deviceId: recordPlayback.deviceId, channelId: recordPlayback.channelId, stream: data && data.stream }
              if (!recordPlayback.downloadInfo.stream) throw new Error('下载接口未返回流 ID')
              pollRecordDownload()
            }).catch(function (error) {
              if (requestId !== recordPlayback.requestId || !recordPlayback.slot) return
              $('#recordDownloadState').text('下载失败：' + (error.message || error))
              log('录像下载失败：' + (error.message || error), 'error')
            })
          })
        })
      }

      function startPlayback(slot, node, requestId) {
        var channelId = nodeChannelId(node.data)
        if (channelId === '') throw new Error('通道缺少数据库 ID，无法调用播放接口')
        setSlotState(slot, '正在请求流…', 'loading')
        setSlotPlaceholder(slot, '正在请求媒体流并建立 ws-flv 连接…')
        log('使用通道 ID ' + channelId + ' 调用 WVP 播放接口')
        return wvp.playChannel(channelId, 60000).then(function (streamContent) {
          if (requestId !== slot.requestId) {
            if (!findSlot(channelId)) requestStop(channelId)
            return null
          }
          var info = (streamContent && streamContent.transcodeStream) || streamContent
          var wsUrl = getWsFlvUrl(info)
          if (!wsUrl) throw new Error('播放接口未返回 ws_flv/wss_flv 地址')
          slot.wsUrl = wsUrl
          if (activeSlot === slot) {
            currentChannelId = channelId
            $('#playerChannelId').text('通道 ID：' + channelId + '｜ws-flv：' + wsUrl)
          }
          log('收到 ws-flv 地址：' + wsUrl)
          try {
            jessibucaPlay(slot, wsUrl)
          } catch (error) { throw new Error('创建 Jessibuca 播放器失败：' + (error.message || error)) }
          return streamContent
        }).catch(function (error) {
          if (requestId !== slot.requestId) return null
          clearSlotView(slot)
          if (activeSlot === slot) currentChannelId = null
          var message = error && error.message ? error.message : 'ws-flv 播放失败'
          setSlotState(slot, '播放失败', 'error')
          setSlotPlaceholder(slot, message, true)
          log(message, 'error')
          throw error
        })
      }

      function playChannel(node) {
        var data = node.data
        var channelId = nodeChannelId(data)
        if (channelId === '') {
          log('通道 ' + nodeLabel(data) + ' 缺少数据库 ID，无法播放', 'error')
          return
        }
        if ($('#detailModal').hasClass('visible')) closeDetail()
        var slot = findSlot(channelId)
        if (!slot) slot = $.grep(gridSlots, function (item) { return !item.node })[0] || activeSlot || gridSlots[0]
        if (!slot) return
        var stopPromise = stopSlot(slot, false)
        slot.node = node
        slot.channelId = channelId
        slot.$slot.addClass('has-channel')
        slot.$name.text(nodeLabel(data))
        slot.placeholder = '准备播放…'
        setSlotState(slot, '准备播放', 'loading')
        setSlotPlaceholder(slot, slot.placeholder, false)
        selectSlot(slot)
        var requestId = ++slot.requestId
        if (!nodeOnline(data)) {
          setSlotState(slot, '通道离线', 'error')
          setSlotPlaceholder(slot, '当前通道离线，未发起播放请求。', true)
          log('通道 ' + (channelId || nodeLabel(data)) + ' 当前离线，跳过播放', 'error')
          return
        }
        stopPromise.always(function () {
          if (requestId !== slot.requestId) return
          startPlayback(slot, node, requestId).catch(function () {})
        })
      }

      function stopPlayback() {
        if (activeSlot) {
          stopSlot(activeSlot, true)
          log('已停止当前宫格播放', 'success')
          return
        }
        log('当前没有选中的宫格', 'error')
      }

      function stopAllPlayback() {
        closeRecordPanel()
        var slots = gridSlots.slice()
        $.each(slots, function (_, slot) { stopSlot(slot, true) })
        activeSlot = null
        currentChannelId = null
        detailPanel.close(null, false)
        setPlayerState('未播放')
        setPlayerPlaceholder('ws-flv 播放画面将在这里显示')
        log('已停止全部宫格播放', 'success')
      }

      function refreshTree() {
        if (!token) { setStatus('未登录', 'error'); return }
        stopAllPlayback()
        setSelectedNode(null)
        replaceRoot()
        setStatus('正在加载树…', 'loading')
        loadChildren(rootNode).then(function () { setStatus('树加载完成', 'success') })
          .catch(function () { setStatus('树加载失败', 'error') })
      }

      /* ---------------- 事件绑定 & 启动 ---------------- */
      mountDeviceTree({
        $: $,
        controller: {
          refresh: refreshTree,
          expandAll: function () {
            if (!rootNode) return
            setStatus('正在展开全部…', 'loading')
            expandAll(rootNode).then(function () { setStatus('已展开全部', 'success') })
              .catch(function () { setStatus('展开全部时有节点加载失败', 'error') })
          },
          collapseAll: function () {
            if (!rootNode) return
            collapseAll(rootNode)
            setStatus('已收起全部', 'success')
          }
        }
      })
      mountVideoGrid({
        $: $,
        controller: {
          setGridSize: function (size) {
            gridSize = size
            renderGrid()
          }
        }
      })
      mountDetailPanel({
        $: $,
        controller: { stop: stopPlayback, close: closeDetail }
      })
      mountRecordPanel({
        $: $,
        controller: {
          close: closeRecordPanel,
          query: queryRecordFiles,
          previous: function () {
            if (recordPlayback.fileIndex > 0) playRecordFile(recordPlayback.fileIndex - 1)
          },
          next: function () {
            if (recordPlayback.fileIndex < recordPlayback.files.length - 1) playRecordFile(recordPlayback.fileIndex + 1)
          },
          togglePause: toggleRecordPause,
          stopPlayback: function () {
            recordPlayback.requestId += 1
            stopRecordPlayback().always(function () {
              setRecordState('已停止')
              setRecordPlaceholder('请选择左侧录像文件开始回放')
            })
          },
          screenshot: function () {
            if (recordPlayback.player && recordPlayback.player.screenshot) recordPlayback.player.screenshot()
          },
          changeSpeed: changeRecordSpeed,
          seek: seekRecord,
          downloadCurrent: function () {
            if (recordPlayback.fileIndex >= 0) startRecordDownload(recordPlayback.files[recordPlayback.fileIndex])
          }
        }
      })
      $(window).on('beforeunload', function () {
        stopRecordDownload()
        stopRecordPlayback()
        $.each(gridSlots, function (_, slot) {
          if (slot.player) { try { slot.player.destroy() } catch (e) {} }
        })
      })

      setControlEnabled(false)
      setSpeed(50)
      renderGrid()
      replaceRoot()
      login().then(refreshTree).catch(function () {
        $('#treeRoot').empty().append($('<li>', { 'class': 'error-row', text: '自动登录失败，请检查浏览器控制台、API 地址和账号配置。' }))
      })
    })(jQuery)

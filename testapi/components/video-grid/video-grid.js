export function createVideoGrid(options) {
  var $ = options.$
  var onSelect = options.onSelect || function () {}
  var onOpenDetail = options.onOpenDetail || function () {}
  var onRecord = options.onRecord || function () {}
  var onRemove = options.onRemove || function () {}

  function findSlot(slots, channelId) {
    return $.grep(slots || [], function (slot) {
      return String(slot.channelId) === String(channelId)
    })[0] || null
  }

  function createSlot(index) {
    var slot = {
      index: index,
      node: null,
      channelId: null,
      player: null,
      playing: false,
      requestId: 0,
      wsUrl: '',
      state: '空闲',
      stateType: '',
      placeholder: '等待添加通道'
    }
    var $slot = $('<div>', { 'class': 'video-slot', 'data-slot-index': index, title: '双击打开播放器和通道控制' })
    var $container = $('<div>', { 'class': 'slot-container' })
    var $placeholder = $('<div>', { 'class': 'slot-placeholder', text: slot.placeholder })
    var $label = $('<div>', { 'class': 'slot-label' })
    var $slotIndex = $('<span>', { 'class': 'slot-index', text: index + 1 })
    var $name = $('<span>', { text: '未添加通道' })
    var $status = $('<span>', { 'class': 'slot-status', text: slot.state })
    var $record = $('<button>', { 'class': 'slot-record', type: 'button', title: '查看国标录像', 'aria-label': '查看国标录像', text: '●' })
    var $remove = $('<button>', { 'class': 'slot-remove', type: 'button', title: '停止并移除', text: '×' })
    $label.append($slotIndex, $name, $status)
    $slot.append($container, $placeholder, $label, $record, $remove)
    slot.$slot = $slot
    slot.$container = $container
    slot.$placeholder = $placeholder
    slot.$name = $name
    slot.$status = $status
    slot.$record = $record
    $slot.on('click', function () { if (slot.node) onSelect(slot) })
    $slot[0].addEventListener('dblclick', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (slot.node) onOpenDetail(slot)
    }, true)
    $record.on('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      onRecord(slot)
    })
    $remove.on('click', function (event) {
      event.stopPropagation()
      onRemove(slot)
    })
    return slot
  }

  function render(gridSize, oldSlots) {
    var $grid = $('#videoGrid').removeClass('grid-3 grid-4 grid-5').addClass('grid-' + gridSize).empty()
    var previousSlots = (oldSlots || []).slice(0, gridSize * gridSize)
    var slots = []
    for (var index = 0; index < gridSize * gridSize; index += 1) {
      var slot = previousSlots[index] || createSlot(index)
      slot.index = index
      slot.$slot.attr('data-slot-index', index)
      slot.$slot.find('.slot-index').text(index + 1)
      $grid.append(slot.$slot)
      slots.push(slot)
    }
    return {
      slots: slots,
      removedSlots: (oldSlots || []).slice(gridSize * gridSize)
    }
  }

  return {
    createSlot: createSlot,
    findSlot: findSlot,
    render: render
  }
}

export function mountVideoGrid(options) {
  var $ = options.$
  var controller = options.controller
  var handlers = []

  function bind(selector, event, handler) {
    $(selector).on(event, handler)
    handlers.push(function () { $(selector).off(event, handler) })
  }

  bind('#gridSize', 'change', function () { controller.setGridSize(Number($(this).val()) || 3) })

  return {
    destroy: function () { handlers.forEach(function (unbind) { unbind() }) }
  }
}

export function defineVideoGridElement() {
  if (typeof customElements === 'undefined' || customElements.get('video-grid-panel')) return
  customElements.define('video-grid-panel', class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector('#videoGrid')) return
      this.innerHTML = [
        '<div class="grid-toolbar">',
        '<label for="gridSize">宫格布局</label>',
        '<select id="gridSize">',
        '<option value="3">九宫格</option>',
        '<option value="4">十六宫格</option>',
        '<option value="5">二十五宫格</option>',
        '</select>',
        '<span class="grid-hint">点击左侧在线通道播放，双击画面打开播放器和云台控制</span>',
        '</div>',
        '<div id="videoGrid" class="video-grid grid-3" aria-label="视频宫格"></div>'
      ].join('')
    }
  })
}

defineVideoGridElement()

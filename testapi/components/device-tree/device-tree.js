export function createDeviceTree(options) {
  var $ = options.$
  var isChannel = options.isChannel
  var isLeaf = options.isLeaf
  var nodeLabel = options.nodeLabel
  var nodeDeviceId = options.nodeDeviceId
  var nodeOnline = options.nodeOnline
  var onToggle = options.onToggle
  var onPlay = options.onPlay

  function renderChildren(node) {
    if (!node.$children) return
    node.$children.empty()
    if (!node.children.length) {
      node.$children.append($('<li>', {
        'class': 'empty-row',
        text: node.isRoot ? '根资源组下暂无分组' : '该节点下暂无子分组或通道'
      }))
      return
    }
    $.each(node.children, function (_, child) { node.$children.append(renderNode(child)) })
  }

  function renderNode(node) {
    var data = node.data
    var channel = isChannel(data)
    var leaf = isLeaf(data)
    var online = nodeOnline(data)
    var $li = $('<li>', { 'class': 'tree-node', 'data-node-key': node.key })
    var $row = $('<div>', {
      'class': 'tree-row' + (channel ? ' channel-row' : ''),
      role: channel ? 'button' : undefined,
      tabindex: channel ? '0' : undefined,
      title: channel ? (online ? '点击播放' : '通道离线，无法播放') : ''
    })
    var $toggle = $('<button>', { 'class': 'tree-toggle' + (leaf ? ' empty' : ''), type: 'button' })
    if (!leaf) {
      $toggle.text(node.expanded ? '▾' : '▸')
      $toggle.on('click', function (event) {
        event.stopPropagation()
        onToggle(node)
      })
    }
    var $icon = $('<span>', {
      'class': 'node-icon ' + (channel ? 'channel ' + (online ? 'online' : 'offline') : 'group'),
      text: channel ? '▣' : '▰'
    })
    var $name = $('<span>', { 'class': 'node-name', text: nodeLabel(data) })
    $row.append($toggle, $icon, $name)
    var deviceId = nodeDeviceId(data)
    if (deviceId) $row.append($('<span>', { 'class': 'node-meta', text: deviceId }))
    if (channel) {
      $row.append($('<span>', {
        'class': 'node-status ' + (online ? 'online' : 'offline'),
        text: online ? '在线' : '离线'
      }))
      $row.on('click', function () { onPlay(node) })
      $row.on('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPlay(node)
        }
      })
    }
    $li.append($row)
    node.$row = $row
    if (!leaf) {
      var $children = $('<ul>', { 'class': 'tree-children' })
      if (!node.expanded) $children.hide()
      $li.append($children)
      node.$children = $children
      node.$toggle = $toggle
      if (node.loaded) renderChildren(node)
    }
    node.$element = $li
    return $li
  }

  function renderRoot(rootNode) {
    $('#treeRoot').empty().append(renderNode(rootNode))
  }

  return {
    renderNode: renderNode,
    renderChildren: renderChildren,
    renderRoot: renderRoot
  }
}

export function mountDeviceTree(options) {
  var $ = options.$
  var controller = options.controller
  var handlers = []

  function bind(selector, event, handler) {
    $(selector).on(event, handler)
    handlers.push(function () { $(selector).off(event, handler) })
  }

  bind('#refreshButton', 'click', function () { controller.refresh() })
  bind('#expandButton', 'click', function () { controller.expandAll() })
  bind('#collapseButton', 'click', function () { controller.collapseAll() })

  return {
    destroy: function () { handlers.forEach(function (unbind) { unbind() }) }
  }
}

export function defineDeviceTreeElement() {
  if (typeof customElements === 'undefined' || customElements.get('device-tree-panel')) return
  customElements.define('device-tree-panel', class extends HTMLElement {
    connectedCallback() {
      if (this.querySelector('#treeRoot')) return
      this.innerHTML = '<ul id="treeRoot" class="tree" aria-label="分组和通道树"></ul>'
    }
  })
}

defineDeviceTreeElement()

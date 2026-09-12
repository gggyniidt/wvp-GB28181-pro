export function createWvpApi(options) {
  var $ = options.$
  var apiBase = options.apiBase
  var getToken = options.getToken || function () { return '' }

  function formatError(xhr, fallback) {
    if (xhr instanceof Error) return xhr.message || fallback
    var response = xhr && xhr.responseJSON
    if (response && response.msg) return response.msg + '（HTTP ' + xhr.status + '）'
    if (xhr && xhr.status) return fallback + '（HTTP ' + xhr.status + '）'
    return fallback
  }

  function headers(extra) {
    var result = { 'access-token': getToken() }
    Object.keys(extra || {}).forEach(function (key) { result[key] = extra[key] })
    return result
  }

  function requestJson(path, requestOptions) {
    requestOptions = requestOptions || {}
    var ajaxOptions = {
      url: apiBase + path,
      method: requestOptions.method || 'GET',
      dataType: 'json',
      timeout: requestOptions.timeout || 15000,
      headers: headers(requestOptions.headers)
    }
    if (requestOptions.data) ajaxOptions.data = requestOptions.data
    return $.ajax(ajaxOptions).then(function (response) {
      if (!response || typeof response.code === 'undefined') throw new Error('API 返回格式不正确')
      if (response.code !== 0) throw new Error(response.msg || ('API 返回错误码：' + response.code))
      return response.data
    }, function (xhr) {
      throw new Error(formatError(xhr, 'API 请求失败'))
    })
  }

  function requestText(path, timeout) {
    return $.ajax({
      url: apiBase + path,
      method: 'GET',
      dataType: 'text',
      timeout: timeout || 15000,
      headers: headers()
    })
  }

  function query(path, data) {
    var separator = path.indexOf('?') === -1 ? '?' : '&'
    return path + separator + $.param(data || {})
  }

  function playbackPath(command, stream) {
    return '/api/playback/' + command + '/' + encodeURIComponent(stream)
  }

  return {
    apiBase: apiBase,
    formatError: formatError,
    requestJson: requestJson,
    requestText: requestText,
    login: function (username, passwordHash) {
      return requestJson('/api/user/login', { data: { username: username, password: passwordHash } })
    },
    getGroupTree: function (isRoot, parentId) {
      var data = { hasChannel: isRoot ? 'false' : 'true' }
      if (!isRoot && parentId !== null && parentId !== undefined) data.parent = parentId
      return requestJson(query('/api/group/tree/list', data))
    },
    getChannelOne: function (channelId, timeout) {
      return requestJson('/api/common/channel/one', { data: { id: channelId }, timeout: timeout })
    },
    playChannel: function (channelId, timeout) {
      return requestJson('/api/common/channel/play', { data: { channelId: channelId }, timeout: timeout || 60000 })
    },
    stopChannel: function (channelId, timeout) {
      if (channelId === null || channelId === undefined || channelId === '') return $.Deferred().resolve().promise()
      return requestText('/api/common/channel/play/stop?channelId=' + encodeURIComponent(channelId), timeout || 10000)
    },
    control: function (path, data, timeout) {
      return requestJson(path, { data: data, timeout: timeout || 30000 })
    },
    ptz: function (channelId, command, speed, timeout) {
      return this.control('/api/common/channel/front-end/ptz', {
        channelId: channelId, command: command, panSpeed: speed, tiltSpeed: speed, zoomSpeed: speed
      }, timeout)
    },
    focus: function (channelId, command, speed, timeout) {
      return this.control('/api/common/channel/front-end/fi/focus', { channelId: channelId, command: command, speed: speed }, timeout)
    },
    iris: function (channelId, command, speed, timeout) {
      return this.control('/api/common/channel/front-end/fi/iris', { channelId: channelId, command: command, speed: speed }, timeout)
    },
    wiper: function (channelId, command, timeout) {
      return this.control('/api/common/channel/front-end/wiper', { channelId: channelId, command: command }, timeout)
    },
    dragZoom: function (channelId, direction, data, timeout) {
      return this.control('/api/common/channel/front-end/drag_zoom_' + direction, Object.assign({ channelId: channelId }, data), timeout)
    },
    queryPresets: function (channelId, timeout) {
      return this.control('/api/common/channel/front-end/preset/query', { channelId: channelId }, timeout)
    },
    callPreset: function (channelId, presetId, timeout) {
      return this.control('/api/common/channel/front-end/preset/call', { channelId: channelId, presetId: presetId }, timeout)
    },
    queryRecords: function (deviceId, channelId, startTime, endTime, timeout) {
      return requestJson('/api/gb_record/query/' + encodeURIComponent(deviceId) + '/' + encodeURIComponent(channelId), {
        data: { startTime: startTime, endTime: endTime }, timeout: timeout || 60000
      })
    },
    startPlayback: function (deviceId, channelId, startTime, endTime, timeout) {
      return requestJson('/api/playback/start/' + encodeURIComponent(deviceId) + '/' + encodeURIComponent(channelId), {
        data: { startTime: startTime, endTime: endTime }, timeout: timeout || 60000
      })
    },
    playbackCommand: function (command, stream, timeout) {
      return requestText(playbackPath(command, stream), timeout || 15000)
    },
    setPlaybackSpeed: function (stream, speed, timeout) {
      return requestText('/api/playback/speed/' + encodeURIComponent(stream) + '/' + encodeURIComponent(speed), timeout || 15000)
    },
    seekPlayback: function (stream, seconds, timeout) {
      return requestText('/api/playback/seek/' + encodeURIComponent(stream) + '/' + encodeURIComponent(seconds), timeout || 15000)
    },
    stopPlayback: function (deviceId, channelId, stream, timeout) {
      return requestText('/api/playback/stop/' + encodeURIComponent(deviceId) + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(stream), timeout || 15000)
    },
    startRecordDownload: function (deviceId, channelId, data, timeout) {
      return requestJson('/api/gb_record/download/start/' + encodeURIComponent(deviceId) + '/' + encodeURIComponent(channelId), {
        data: data, timeout: timeout || 60000
      })
    },
    getDownloadProgress: function (deviceId, channelId, stream, timeout) {
      return requestJson('/api/gb_record/download/progress/' + encodeURIComponent(deviceId) + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(stream), {
        timeout: timeout || 15000
      })
    },
    stopRecordDownload: function (deviceId, channelId, stream, timeout) {
      return requestText('/api/gb_record/download/stop/' + encodeURIComponent(deviceId) + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(stream), timeout || 15000)
    }
  }
}

export function getWsFlvUrl(streamContent) {
  if (!streamContent) return ''
  var field = window.location.protocol === 'https:' ? 'wss_flv' : 'ws_flv'
  var fallback = field === 'wss_flv' ? 'ws_flv' : 'wss_flv'
  var value = streamContent[field] || streamContent[fallback]
  var url = value && typeof value === 'object' ? value.url : value
  return forceWsPort(url || '')
}

export function forceWsPort(url) {
  if (!url) return ''
  try {
    var parsed = new URL(url)
    if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && (parsed.port === '' || parsed.port === '80')) {
      parsed.port = '8080'
      return parsed.toString()
    }
    return url
  } catch (error) {
    return String(url).replace(/^(wss?:\/\/[^/:]+)(:80)?\//, '$1:8080/')
  }
}

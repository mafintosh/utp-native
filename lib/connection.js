const binding = require('./binding')
const { Duplex } = require('streamx')
const unordered = require('unordered-set')
const dns = require('dns')
const timeout = require('timeout-refresh')
const b4a = require('b4a')
const queueTick = require('queue-tick')

const EMPTY = b4a.alloc(0)
const UTP_ERRORS = [
  'UTP_ECONNREFUSED',
  'UTP_ECONNRESET',
  'UTP_ETIMEDOUT',
  'UTP_UNKNOWN'
]

module.exports = class Connection extends Duplex {
  constructor (utp, port, address, handle, halfOpen) {
    super()

    this.remoteAddress = address
    this.remoteFamily = 'IPv4'
    this.remotePort = port

    this._index = -1
    this._utp = utp
    this._handle = handle || b4a.alloc(binding.sizeof_utp_napi_connection_t)
    this._buffer = b4a.allocUnsafe(65536 * 2)
    this._offset = 0
    this._view = new Uint32Array(this._handle.buffer, this._handle.byteOffset, 2)
    this._callback = null
    this._writing = null
    this._error = null
    this._connected = false
    this._needsConnect = !handle
    this._timeout = null
    this._contentSize = 0
    this._allowOpen = halfOpen ? 2 : 1

    this.on('finish', this._shutdown)

    binding.utp_napi_connection_init(this._handle, this, this._buffer,
      this._onread.bind(this),
      this._ondrain.bind(this),
      this._onend.bind(this),
      this._onerror.bind(this),
      this._onclose.bind(this),
      this._onconnect.bind(this),
      this._realloc.bind(this)
    )

    unordered.add(utp.connections, this)
    if (utp.maxConnections && utp.connections.length >= utp.maxConnections) {
      utp.firewall(true)
    }
  }

  setTimeout (ms, ontimeout) {
    if (ontimeout) this.once('timeout', ontimeout)
    if (this._timeout) this._timeout.destroy()
    this._timeout = timeout(ms, this._ontimeout, this)
  }

  _ontimeout () {
    this.emit('timeout')
  }

  setInteractive (interactive) {
    this.setPacketSize(interactive ? 0 : 65536)
  }

  setContentSize (size) {
    this._view[0] = size < 65536 ? (size >= 0 ? size : 0) : 65536
    this._contentSize = size
  }

  setPacketSize (size) {
    if (size > 65536) size = 65536
    this._view[0] = size
    this._contentSize = 0
  }

  address () {
    if (this.destroyed) return null
    return this._utp.address()
  }

  _writev (datas, cb) {
    let bufs = new Array(datas.length)
    for (var i = 0; i < datas.length; i++) {
      const data = datas[i]
      bufs[i] = typeof data === 'string' ? b4a.from(data) : data
    }

    if (bufs.length > 256) bufs = [b4a.concat(bufs)]

    if (!this._connected || !binding.utp_napi_connection_writev(this._handle, bufs)) {
      this._callback = cb
      this._writing = bufs
      return
    }

    cb(null)
  }

  _realloc () {
    this._buffer = b4a.allocUnsafe(this._buffer.length)
    this._offset = 0
    return this._buffer
  }

  _onread (size) {
    if (!this._connected) this._onconnect() // makes the server wait for reads before writes
    if (this._timeout) this._timeout.refresh()

    const buf = this._buffer.subarray(this._offset, this._offset += size)

    if (this._contentSize) {
      if (size > this._contentSize) size = this._contentSize
      this._contentSize -= size
      if (this._contentSize < 65536) this._view[0] = this._contentSize
    }

    this.push(buf)

    // 64kb + 4kb as max package buffer is 64kb and we wanna make sure we have room for that
    // plus the next udp package
    if (this._buffer.length - this._offset <= 69632) {
      this._buffer = b4a.allocUnsafe(this._buffer.length)
      this._offset = 0
      return this._buffer
    }

    return EMPTY
  }

  _ondrain () {
    this._writing = null
    const cb = this._callback
    this._callback = null
    cb(null)
  }

  _onclose () {
    unordered.remove(this._utp.connections, this)
    if (!this._utp.maxConnections || this._utp.connections.length < this._utp.maxConnections) {
      this._utp.firewall(false)
    }
    this._handle = null
    if (this._error) this.emit('error', this._error)
    this.emit('close')
    this._utp._closeMaybe()
  }

  _onerror (status) {
    this.destroy(createUTPError(status))
  }

  _onend () {
    if (this._timeout) this._timeout.destroy()
    this.push(null)
    this._destroyMaybe()
  }

  _resolveAndConnect (port, host) {
    const self = this
    dns.lookup(host, { family: 4 }, function (err, ip) {
      if (err) return self.destroy(err)
      if (!ip) return self.destroy(new Error('Could not resolve ' + host))
      self._connect(port, ip)
    })
  }

  _connect (port, ip) {
    if (this.destroyed) return
    this._needsConnect = false
    this.remoteAddress = ip
    binding.utp_napi_connect(this._utp._handle, this._handle, port, ip)
  }

  _onconnect () {
    if (this._timeout) this._timeout.refresh()

    this._connected = true
    if (this._writing) {
      const cb = this._callback
      const data = this._writing
      this._callback = null
      this._writing = null
      this._writev(data, cb)
    }
    this.emit('connect')
  }

  destroy (err) {
    if (this.destroyed) return
    super.destroy(err)
    if (err) this._error = err
    if (this._needsConnect) return queueTick(() => binding.utp_napi_connection_on_close(this._handle))
    binding.utp_napi_connection_close(this._handle)
  }

  _destroyMaybe () {
    if (this._allowOpen && !--this._allowOpen) this.destroy()
  }

  _shutdown () {
    if (this.destroyed) return
    binding.utp_napi_connection_shutdown(this._handle)
    this._destroyMaybe()
  }
}

function createUTPError (code) {
  const str = UTP_ERRORS[code < 0 ? 3 : code]
  const err = new Error(str)
  err.code = str
  err.errno = code
  return err
}

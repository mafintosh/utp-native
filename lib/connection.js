const EventEmitter = require('events')
const { Duplex } = require('streamx')
const unordered = require('unordered-set')
const dns = require('dns')
const timeout = require('timeout-refresh')
const b4a = require('b4a')
const binding = require('./binding')

const EMPTY = b4a.alloc(0)

module.exports = class Connection extends Duplex {
  constructor (utp, port, address, handle, halfOpen) {
    super()

    this.remoteAddress = address
    this.remoteFamily = 'IPv4'
    this.remotePort = port

    this._index = -1
    this._utp = utp
    this._connection = new UTPConnection(utp, handle)
    this._view = new Uint32Array(this._connection._handle.buffer, this._connection._handle.byteOffset, 2)
    this._timeout = null
    this._contentSize = 0
    this._allowOpen = halfOpen ? 2 : 1

    unordered.add(this._utp.connections, this)

    if (this._utp.maxConnections && this._utp.connections.length >= this._utp.maxConnections) {
      this._utp.firewall(true)
    }

    this._connection
      .on('data', (buffer) => this._onread(buffer))
      .on('end', () => this._onend())
      .on('connect', () => this._onconnect())
  }

  setTimeout (ms, ontimeout) {
    if (ontimeout) this.once('timeout', ontimeout)
    if (this._timeout) this._timeout.destroy()
    this._timeout = timeout(ms, this._ontimeout, this)
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

  _open (cb) {
    if (this._connection.connected) cb(null)
    else {
      this._connection.once('connect', () => {
        if (this._timeout) this._timeout.refresh()
        cb(null)
      })
    }
  }

  _destroy (cb) {
    this._connection.close((err) => {
      if (err) return cb(err)

      unordered.remove(this._utp.connections, this)

      if (!this._utp.maxConnections || this._utp.connections.length < this._utp.maxConnections) {
        this._utp.firewall(false)
      }

      this._utp._closeMaybe()

      cb(null)
    })
  }

  _destroyMaybe () {
    if (this._allowOpen && !--this._allowOpen) this.destroy()
  }

  _final (cb) {
    this._connection.shutdown()
    this._destroyMaybe()
    cb(null)
  }

  _writev (datas, cb) {
    let bufs = new Array(datas.length)
    for (var i = 0; i < datas.length; i++) {
      const data = datas[i]
      bufs[i] = typeof data === 'string' ? b4a.from(data) : data
    }

    if (bufs.length > 256) bufs = [b4a.concat(bufs)]

    this._connection.writev(bufs, cb)
  }

  _connect (port, ip) {
    this.remotePort = port
    this.remoteAddress = ip

    this._connection.connect(port, ip)
  }

  _resolveAndConnect (port, host) {
    dns.lookup(host, { family: 4 }, (err, ip) => {
      if (err) this.destroy(err)
      else this._connect(port, ip)
    })
  }

  _ontimeout () {
    this.emit('timeout')
  }

  _onread (buffer) {
    if (this._timeout) this._timeout.refresh()

    let size = buffer.byteLength

    if (this._contentSize) {
      if (size > this._contentSize) size = this._contentSize
      this._contentSize -= size
      if (this._contentSize < 65536) this._view[0] = this._contentSize
    }

    this.push(buffer)
  }

  _onend () {
    if (this._timeout) this._timeout.destroy()
    this.push(null)
    this._destroyMaybe()
  }

  _onconnect () {
    this.emit('connect')
  }
}

const INITIALIZED = 1
const CONNECTING = 1 << 1
const CONNECTED = 1 << 2
const CLOSING = 1 << 3
const CLOSED = 1 << 4
const SHUTDOWN = 1 << 5

class UTPConnection extends EventEmitter {
  constructor (socket, handle) {
    super()

    this._socket = socket
    this._handle = handle || b4a.alloc(binding.sizeof_utp_napi_connection_t)

    this._state = 0
    this._buffer = b4a.allocUnsafe(65536 * 2)
    this._offset = 0
    this._writing = null

    if (handle) {
      this._init()
      this._state |= CONNECTED
    }
  }

  get connected () {
    return (this._state & CONNECTED) !== 0
  }

  connect (port, ip, cb) {
    if ((this._state & (CONNECTED | CONNECTING)) !== 0) return cb && cb(new Error('Already connected'))
    if ((this._state & INITIALIZED) === 0) this._init()

    if (cb) this.once('connect', cb)

    this._state |= CONNECTING

    binding.utp_napi_connect(this._socket._handle, this._handle, port, ip)
  }

  write (data, cb) {
    if ((this._state & CONNECTED) === 0) return cb(new Error('Not connected'))

    const drained = binding.utp_napi_connection_write(this._handle, data) === 1

    if (drained) cb(null)
    else this._writing = [cb, data]

    return drained
  }

  writev (batch, cb) {
    if ((this._state & CONNECTED) === 0) return cb(new Error('Not connected'))

    const drained = binding.utp_napi_connection_writev(this._handle, batch) === 1

    if (drained) cb(null)
    else this._writing = [cb, batch]

    return drained
  }

  shutdown () {
    if ((this._state & SHUTDOWN) !== 0) return

    this._state |= SHUTDOWN

    binding.utp_napi_connection_shutdown(this._handle)
  }

  close (cb) {
    if ((this._state & INITIALIZED) === 0) return cb && cb(null)

    if (cb) this.once('close', cb)

    if ((this._state & (CLOSED | CLOSING)) === 0) {
      if ((this._state & CONNECTED) === 0) {
        binding.utp_napi_connection_on_close(this._handle)
      } else {
        binding.utp_napi_connection_close(this._handle)
      }

      this._state |= CLOSING
    }
  }

  _init () {
    if ((this._state & INITIALIZED) !== 0) return

    this._state |= INITIALIZED

    binding.utp_napi_connection_init(this._handle, this, this._buffer,
      this._onread,
      this._ondrain,
      this._onend,
      this._onerror,
      this._onclose,
      this._onconnect,
      this._realloc
    )
  }

  _onread (size) {
    const buffer = this._buffer.subarray(this._offset, this._offset += size)

    this.emit('data', buffer)

    if (this._buffer.length - this._offset <= 69632) return this._realloc()

    return EMPTY
  }

  _ondrain () {
    const cb = this._writing[0]
    this._writing = null
    cb(null)
  }

  _onend () {
    this.emit('end')
  }

  _onerror (code) {
    this.emit('error', createUTPError(code))
  }

  _onclose () {
    this._state &= ~CLOSING
    this._state |= CLOSED
    this.emit('close')
  }

  _onconnect () {
    this._state &= ~CONNECTING
    this._state |= CONNECTED
    this.emit('connect')
  }

  _realloc () {
    this._buffer = b4a.allocUnsafe(this._buffer.length)
    this._offset = 0
    return this._buffer
  }
}

const UTP_ERRORS = [
  'UTP_ECONNREFUSED',
  'UTP_ECONNRESET',
  'UTP_ETIMEDOUT',
  'UTP_UNKNOWN'
]

function createUTPError (code) {
  const str = UTP_ERRORS[code < 0 ? 3 : code]
  const err = new Error(str)
  err.code = str
  err.errno = code
  return err
}

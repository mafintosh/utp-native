const EventEmitter = require('events')
const set = require('unordered-set')
const b4a = require('b4a')
const binding = require('./binding')

const EMPTY = b4a.alloc(0)

const INITIALIZED = 1
const CONNECTING = 1 << 1
const CONNECTED = 1 << 2
const CLOSING = 1 << 3
const CLOSED = 1 << 4

class UTPConnection extends EventEmitter {
  constructor (socket, handle) {
    super()

    this._socket = socket
    this._handle = handle || b4a.alloc(binding.sizeof_utp_napi_connection_t)

    this._index = null
    this._state = 0
    this._buffer = b4a.allocUnsafe(65536 * 2)
    this._offset = 0
    this._writing = []

    set.add(this._socket._connections, this)

    if (handle) {
      this._init()
      this._state |= CONNECTING
    }
  }

  get connected () {
    return (this._state & CONNECTED) !== 0
  }

  connect (port, ip, cb) {
    if ((this._state & (CONNECTED | CONNECTING)) !== 0) return cb(new Error('Already connected'))
    if ((this._state & INITIALIZED) === 0) this._init()

    this._socket._ensureBound((err) => {
      if (err) return cb(err)

      this.once('connect', cb)

      this._state |= CONNECTING

      binding.utp_napi_connect(this._socket._handle, this._handle, port, ip)
    })
  }

  write (data, cb) {
    if ((this._state & CONNECTED) === 0) return cb(new Error('Not connected'))

    const drained = binding.utp_napi_connection_write(this._handle, data) === 1

    if (drained) cb(null)
    else this._writing.push([cb, data])

    return drained
  }

  writev (batch, cb) {
    if ((this._state & CONNECTED) === 0) return cb(new Error('Not connected'))

    const drained = binding.utp_napi_connection_writev(this._handle, batch) === 1

    if (drained) cb(null)
    else this._writing.push([cb, batch])

    return drained
  }

  shutdown (cb) {
    if ((this._state & INITIALIZED) === 0) return cb(null)

    this._state &= ~CONNECTED

    binding.utp_napi_connection_shutdown(this._handle)

    cb(null)
  }

  close (cb) {
    if ((this._state & INITIALIZED) === 0) return cb(null)
    if ((this._state & CLOSED) !== 0) return cb(null)

    this._ensureShutdown((err) => {
      if (err) return cb(err)

      this.once('close', cb)

      if ((this._state & CLOSING) === 0) {
        this._state |= CLOSING

        if ((this._state & CONNECTING) === 0) {
          binding.utp_napi_connection_close(this._handle)
        } else {
          binding.utp_napi_connection_on_close(this._handle)
        }
      }
    })
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
    if ((this._state & CONNECTED) === 0) this._onconnect()

    const buffer = this._buffer.subarray(this._offset, this._offset += size)

    this.emit('data', buffer)

    if (this._buffer.length - this._offset <= 69632) return this._realloc()

    return EMPTY
  }

  _ondrain () {
    const [cb] = this._writing.shift()
    cb(null)
  }

  _onend () {
    this.emit('end')
  }

  _onerror (code) {
    this.emit('error', createUTPError(code))
  }

  _onclose () {
    set.remove(this._socket._connections, this)

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

  _ensureShutdown (cb) {
    if ((this._state & CONNECTED) !== 0) this.shutdown(cb)
    else cb(null)
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

module.exports = UTPConnection

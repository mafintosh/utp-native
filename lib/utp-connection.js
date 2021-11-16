const set = require('unordered-set')
const b4a = require('b4a')
const binding = require('./binding')

const EMPTY = b4a.alloc(0)

const INITIALIZED = 1
const CONNECTING = 1 << 1
const CONNECTED = 1 << 2
const CLOSING = 1 << 3
const CLOSED = 1 << 4
const WRITABLE = 1 << 5

class UTPConnection {
  constructor (socket, handle) {
    this._socket = socket
    this._handle = handle || b4a.alloc(binding.sizeof_utp_napi_connection_t)

    this._index = null
    this._state = 0
    this._buffer = b4a.allocUnsafe(65536 * 2)
    this._offset = 0
    this._writing = null

    this.onerror = noop
    this.onclose = noop
    this.onconnect = noop
    this.ondata = noop
    this.onend = noop

    set.add(this._socket._connections, this)

    // Server connections start out connected, but are only writable after the
    // first read
    if (handle) {
      this._init()
      this._state |= CONNECTED
    }
  }

  get inited () {
    return (this._state & INITIALIZED) !== 0
  }

  get connecting () {
    return (this._state & CONNECTING) !== 0
  }

  get connected () {
    return (this._state & CONNECTED) !== 0
  }

  get closing () {
    return (this._state & CLOSING) !== 0
  }

  get closed () {
    return (this._state & CLOSED) !== 0
  }

  get writable () {
    return (this._state & WRITABLE) !== 0
  }

  connect (port, ip) {
    if ((this._state & (CONNECTED | CONNECTING)) !== 0) throw new Error('Connection is already connected')
    if ((this._state & INITIALIZED) === 0) this._init()

    this._socket._ensureBound()

    this._state |= CONNECTING

    binding.utp_napi_connect(this._socket._handle, this._handle, port, ip)
  }

  writev (batch, cb) {
    if ((this._state & WRITABLE) === 0) return cb(new Error('Connection is not writable'))

    const drained = binding.utp_napi_connection_writev(this._handle, batch) === 1

    if (drained) cb(null)
    else this._writing = [cb, batch]

    return drained
  }

  shutdown () {
    if ((this._state & INITIALIZED) === 0) return

    this._state &= ~(CONNECTED | CONNECTING | WRITABLE)

    binding.utp_napi_connection_shutdown(this._handle)
  }

  close () {
    if ((this._state & CLOSED) !== 0) return
    if ((this._state & INITIALIZED) === 0) return this._onclose()

    if ((this._state & CLOSING) === 0) {
      this._state |= CLOSING

      // The connection can only be closed if not in the process of connecting,
      // otherwise destroy the connection immediately
      const canClose = (this._state & CONNECTING) === 0

      this._ensureShutdown()

      if (canClose) {
        binding.utp_napi_connection_close(this._handle)
      } else {
        binding.utp_napi_connection_destroy(this._handle)
      }
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
    if ((this._state & WRITABLE) === 0) this._onconnect()

    const buffer = this._buffer.subarray(this._offset, this._offset += size)

    this.ondata(buffer)

    if (this._buffer.length - this._offset <= 69632) return this._realloc()

    return EMPTY
  }

  _ondrain () {
    const cb = this._writing[0]
    this._wiriting = null
    cb(null)
  }

  _onend () {
    this.onend()
  }

  _onerror (code) {
    this.onerror(createUTPError(code))
  }

  _onclose () {
    set.remove(this._socket._connections, this)

    this._state &= ~CLOSING
    this._state |= CLOSED

    if (this._socket.idle) this._socket._onidle()

    this.onclose()
  }

  _onconnect () {
    this._state &= ~CONNECTING
    this._state |= (CONNECTED | WRITABLE)

    this.onconnect()
  }

  _realloc () {
    this._buffer = b4a.allocUnsafe(this._buffer.length)
    this._offset = 0
    return this._buffer
  }

  _ensureShutdown () {
    if ((this._state & CONNECTED) !== 0) this.shutdown()
  }
}

module.exports = UTPConnection

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

function noop () {}

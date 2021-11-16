const set = require('unordered-set')
const b4a = require('b4a')
const binding = require('./binding')
const UTPConnection = require('./utp-connection')

const EMPTY = b4a.alloc(0)

const INITIALIZED = 1
const BOUND = 1 << 1
const CLOSING = 1 << 2
const CLOSED = 1 << 3
const UNREFED = 1 << 4

class UTPSocket {
  constructor () {
    this._connections = []
    this._sending = []
    this._sent = []
    this._handle = b4a.alloc(binding.sizeof_utp_napi_t)
    this._state = 0
    this._nextConnection = b4a.alloc(binding.sizeof_utp_napi_connection_t)
    this._buffer = b4a.allocUnsafe(65536 * 2)
    this._offset = 0
    this._accept = new Uint32Array(
      this._handle.buffer,
      this._handle.byteOffset + binding.offsetof_utp_napi_t_accept_connections,
      1
    )

    this.onmessage = noop
    this.onerror = noop
    this.onclose = noop
    this.onconnection = noop
  }

  get bound () {
    return (this._state & BOUND) !== 0
  }

  get closing () {
    return (this._state & CLOSING) !== 0
  }

  get closed () {
    return (this._state & CLOSED) !== 0
  }

  get unrefed () {
    return (this._state & UNREFED) !== 0
  }

  get idle () {
    return this._connections.length === 0 && this._sending.length === 0
  }

  firewall (enable) {
    this._accept[0] = enable ? 0 : 1
  }

  ref () {
    if ((this._state & INITIALIZED) !== 0) binding.utp_napi_ref(this._handle)
    this._refed &= ~UNREFED
  }

  unref () {
    if ((this._state & INITIALIZED) !== 0) binding.utp_napi_unref(this._handle)
    this._state |= UNREFED
  }

  bind (port, ip) {
    if ((this._state & BOUND) !== 0) throw new Error('Already bound')
    if ((this._state & INITIALIZED) === 0) this._init()

    this._state |= BOUND

    binding.utp_napi_bind(this._handle, port, ip)
  }

  listen (port, ip) {
    this.bind(port, ip)
    this.firewall(false)
  }

  send (buffer, offset, len, port, ip, cb) {
    if ((this._state & (CLOSED | CLOSING)) === 0) throw new Error('Socket is closed')

    this._ensureBound()

    const request = this._sent.pop() || new UTPSendRequest()

    request.send(buffer, offset, len, port, ip, cb)
  }

  close () {
    if ((this._state & INITIALIZED) === 0) return
    if ((this._state & CLOSED) !== 0) return

    if ((this._state & CLOSING) === 0) {
      this._state |= CLOSING

      if (this.idle) this._onidle()
    }
  }

  _init () {
    if ((this._state & INITIALIZED) !== 0) return

    this._state |= INITIALIZED

    binding.utp_napi_init(this._handle, this, this._nextConnection, this._buffer,
      this._onmessage,
      this._onsend,
      this._onconnection,
      this._onclose,
      this._realloc
    )

    if ((this._state & UNREFED) === 0) this.ref()
    else this.unref()
  }

  _onidle () {
    if ((this._state & CLOSING) !== 0) binding.utp_napi_close(this._handle)
  }

  _onmessage (size, port, ip) {
    if (size < 0) {
      this.onerror(new Error('Read failed (status: ' + size + ')'))
      return EMPTY
    }

    const message = this._buffer.subarray(this._offset, this._offset += size)

    this.onmessage(message, { address: ip, family: 'IPv4', port })

    if (this._buffer.length - this._offset <= 65536) return this._realloc()

    return EMPTY
  }

  _onsend (request, status) {
    request.finish(status)

    if (this.idle) this._onidle()
  }

  _onconnection (port, ip) {
    const connection = new UTPConnection(this, this._nextConnection)

    this.onconnection(port, ip, connection)

    this._nextConnection = b4a.alloc(binding.sizeof_utp_napi_connection_t)
    return this._nextConnection
  }

  _onclose () {
    this._state &= ~CLOSING
    this._state |= CLOSED

    binding.utp_napi_destroy(this._handle, this._sent.map(toHandle))

    this.onclose()
  }

  _realloc () {
    this._buffer = b4a.allocUnsafe(this._buffer.length)
    this._offset = 0
    return this._buffer
  }

  _ensureBound () {
    if ((this._state & BOUND) === 0) this.bind(0, '127.0.0.1')
  }
}

class UTPSendRequest {
  constructor (socket) {
    this._socket = socket

    this._index = null
    this._handle = b4a.alloc(binding.sizeof_utp_napi_send_request_t)
    this._buffer = null
    this._callback = null

    this._init()
  }

  send (buffer, offset, length, port, ip, cb) {
    set.add(this._socket._sending, this)

    this._buffer = buffer
    this._callback = cb

    binding.utp_napi_send(this._socket._handle, this._handle,
      buffer,
      offset,
      length,
      port,
      ip
    )
  }

  finish (status) {
    set.remove(this._socket._sending, this)

    this._socket._sent.push(this)

    const cb = this._callback

    this._buffer = null
    this._callback = null

    cb(status < 0 ? new Error('Send failed (status: ' + status + ')') : null)
  }

  _init () {
    binding.utp_napi_send_request_init(this._handle, this)
  }
}

function toHandle (obj) {
  return obj._handle
}

function noop () {}

module.exports = UTPSocket

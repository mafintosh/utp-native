const b4a = require('b4a')
const binding = require('./binding')
const UTPConnection = require('./utp-connection')
const UTPSendRequest = require('./utp-send-request')

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

  get inited () {
    return (this._state & INITIALIZED) !== 0
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
    this._state &= ~UNREFED

    if ((this._state & INITIALIZED) !== 0) binding.utp_napi_ref(this._handle)
  }

  unref () {
    this._state |= UNREFED

    if ((this._state & INITIALIZED) !== 0) binding.utp_napi_unref(this._handle)
  }

  bind (port, ip) {
    if ((this._state & BOUND) !== 0) throw new Error('Already bound')
    if ((this._state & INITIALIZED) === 0) this._init()

    // This will throw if not successfully bound
    binding.utp_napi_bind(this._handle, port, ip)

    this._state |= BOUND
  }

  send (buffer, offset, len, port, ip) {
    if ((this._state & (CLOSED | CLOSING)) !== 0) throw new Error('Socket is closed')

    this._ensureBound()

    const request = this._sent.pop() || new UTPSendRequest(this)

    request.send(buffer, offset, len, port, ip)

    return request
  }

  close () {
    if ((this._state & CLOSED) !== 0) return
    if ((this._state & INITIALIZED) === 0) return this._onclose()

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
    if ((this._state & CLOSED) === 0 && (this._state & CLOSING) !== 0) {
      binding.utp_napi_close(this._handle)
    }
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
  }

  _onconnection (port, ip) {
    const connection = new UTPConnection(this, this._nextConnection)

    this.onconnection(port, ip, connection)

    this._nextConnection = b4a.alloc(binding.sizeof_utp_napi_connection_t)
    return this._nextConnection
  }

  _onclose () {
    this._state &= ~(BOUND | CLOSING)
    this._state |= CLOSED

    binding.utp_napi_destroy(this._handle, this._sent.map(UTPSendRequest.toHandle))

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

module.exports = UTPSocket

function noop () {}

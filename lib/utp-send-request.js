const set = require('unordered-set')
const b4a = require('b4a')
const binding = require('./binding')

const INITIALIZED = 1
const SENDING = 1 << 1

class UTPSendRequest {
  constructor (socket) {
    this._socket = socket

    this._index = null
    this._handle = b4a.alloc(binding.sizeof_utp_napi_send_request_t)
    this._state = 0
    this._buffer = null

    this.onsent = noop

    this._init()
  }

  send (buffer, offset, length, port, ip) {
    if ((this._state & SENDING) !== 0) throw new Error('Already sending')

    this._state |= SENDING

    set.add(this._socket._sending, this)

    this._buffer = buffer

    binding.utp_napi_send(this._socket._handle, this._handle,
      buffer,
      offset,
      length,
      port,
      ip
    )
  }

  finish (status) {
    if ((this._state & SENDING) === 0) throw new Error('Not sending')

    this._state &= ~SENDING

    set.remove(this._socket._sending, this)

    this._socket._sent.push(this)

    this._buffer = null

    if (this._socket.idle) this._socket._onidle()

    this.onsent(status < 0 ? new Error('Send failed (status: ' + status + ')') : null)
  }

  _init () {
    if ((this._state & INITIALIZED) !== 0) return

    this._state |= INITIALIZED

    binding.utp_napi_send_request_init(this._handle, this)
  }
}

module.exports = UTPSendRequest

function noop () {}

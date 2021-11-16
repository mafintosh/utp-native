const set = require('unordered-set')
const b4a = require('b4a')
const binding = require('./binding')

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
module.exports = UTPSendRequest

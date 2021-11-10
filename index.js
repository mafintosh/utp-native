const binding = require('./lib/binding')
const Connection = require('./lib/connection')
const EventEmitter = require('events')
const dns = require('dns')
const set = require('unordered-set')
const b4a = require('b4a')
const queueTick = require('queue-tick')

const EMPTY = b4a.alloc(0)
const IPv4Pattern = /^((?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])[.]){3}(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])$/

const Socket = module.exports = class Socket extends EventEmitter {
  constructor (opts) {
    super()

    this.connections = []

    this._sending = []
    this._sent = []
    this._offset = 0
    this._buffer = b4a.allocUnsafe(2 * 65536)
    this._handle = b4a.alloc(binding.sizeof_utp_napi_t)
    this._nextConnection = b4a.alloc(binding.sizeof_utp_napi_connection_t)
    this._address = null
    this._inited = false
    this._refed = true
    this._closing = false
    this._closed = false
    this._allowHalfOpen = !opts || opts.allowHalfOpen !== false
    this._acceptConnections = new Uint32Array(this._handle.buffer, this._handle.byteOffset + binding.offsetof_utp_napi_t_accept_connections, 1)
    this.maxConnections = 0
  }

  _init () {
    this._inited = true

    binding.utp_napi_init(this._handle, this,
      this._nextConnection,
      this._buffer,
      this._onmessage,
      this._onsend,
      this._onconnection,
      this._onclose,
      this._realloc
    )

    if (!this._refed) this.unref()
  }

  firewall (yes) {
    this._acceptConnections[0] = yes ? 0 : 1
  }

  ref () {
    if (this._inited) binding.utp_napi_ref(this._handle)
    this._refed = true
  }

  unref () {
    if (this._inited) binding.utp_napi_unref(this._handle)
    this._refed = false
  }

  address () {
    if (!this._address || this._closing) throw new Error('Socket not bound')
    return {
      address: this._address,
      family: 'IPv4',
      port: binding.utp_napi_local_port(this._handle)
    }
  }

  getRecvBufferSize () {
    if (!this._inited) throw new Error('getRecvBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_recv_buffer(this._handle, 0)
  }

  setRecvBufferSize (n) {
    if (!this._inited) throw new Error('setRecvBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_recv_buffer(this._handle, n)
  }

  getSendBufferSize () {
    if (!this._inited) throw new Error('getSendBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_send_buffer(this._handle, 0)
  }

  setSendBufferSize (n) {
    if (!this._inited) throw new Error('setSendBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_send_buffer(this._handle, n)
  }

  setTTL (ttl) {
    if (!this._inited) throw new Error('setTTL EBADF')
    if (this._closing) return
    binding.utp_napi_set_ttl(this._handle, ttl)
  }

  send (buf, offset, len, port, host, cb) {
    if (!cb) cb = noop
    if (!isIP(host)) return this._resolveAndSend(buf, offset, len, port, host, cb)
    if (this._closing) return queueTick(() => cb(new Error('Socket is closed')))
    if (!this._address) this.bind(0)

    var send = this._sent.pop()
    if (!send) {
      send = new SendRequest()
      binding.utp_napi_send_request_init(send._handle, send)
    }

    send._index = this._sending.push(send) - 1
    send._buffer = buf
    send._callback = cb

    binding.utp_napi_send(this._handle, send._handle, send._buffer, offset, len, port, host)
  }

  _resolveAndSend (buf, offset, len, port, host, cb) {
    const self = this

    dns.lookup(host, { family: 4 }, onlookup)

    function onlookup (err, ip) {
      if (err) return cb(err)
      if (!ip) return cb(new Error('Could not resolve ' + host))
      self.send(buf, offset, len, port, ip, cb)
    }
  }

  close (cb) {
    if (this._closed) return queueTick(() => cb && cb())
    if (cb) this.once('close', cb)
    if (this._closing) return
    this._closing = true
    this._closeMaybe()
  }

  _closeMaybe () {
    if (this._closing && !this.connections.length && !this._sending.length && this._inited && !this._closed) {
      this._closed = true
      binding.utp_napi_close(this._handle)
    }
  }

  connect (port, ip) {
    if (!this._inited) this.bind()
    if (!ip) ip = '127.0.0.1'
    const conn = new Connection(this, port, ip, null, this._allowHalfOpen)
    if (!isIP(ip)) conn._resolveAndConnect(port, ip)
    else conn._connect(port, ip || '127.0.0.1')
    return conn
  }

  listen (port, ip, onlistening) {
    if (!this._address) this.bind(port, ip, onlistening)
    this.firewall(false)
  }

  bind (port, ip, onlistening) {
    if (typeof port === 'function') return this.bind(0, null, port)
    if (typeof ip === 'function') return this.bind(port, null, ip)
    if (!port) port = 0
    if (!ip) ip = '0.0.0.0'

    if (!this._inited) this._init()
    if (this._closing) return

    if (this._address) {
      this.emit('error', new Error('Socket already bound'))
      return
    }

    if (onlistening) this.once('listening', onlistening)
    if (!isIP(ip)) return this._resolveAndBind(port, ip)

    this._address = ip

    try {
      binding.utp_napi_bind(this._handle, port, ip)
    } catch (err) {
      this._address = null
      queueTick(() => this.emit('error', err))
      return
    }

    queueTick(() => this.emit('listening'))
  }

  _resolveAndBind (port, host) {
    const self = this

    dns.lookup(host, { family: 4 }, function (err, ip) {
      if (err) return self.emit('error', err)
      self.bind(port, ip)
    })
  }

  _realloc () {
    this._buffer = b4a.allocUnsafe(this._buffer.length)
    this._offset = 0
    return this._buffer
  }

  _onmessage (size, port, address) {
    if (size < 0) {
      this.emit('error', new Error('Read failed (status: ' + size + ')'))
      return EMPTY
    }

    const message = this._buffer.subarray(this._offset, this._offset += size)
    this.emit('message', message, { address, family: 'IPv4', port })

    if (this._buffer.length - this._offset <= 65536) {
      this._buffer = b4a.allocUnsafe(this._buffer.length)
      this._offset = 0
      return this._buffer
    }

    return EMPTY
  }

  _onsend (send, status) {
    const cb = send._callback

    send._callback = send._buffer = null
    set.remove(this._sending, send)
    this._sent.push(send)
    if (this._closing) this._closeMaybe()

    cb(status < 0 ? new Error('Send failed (status: ' + status + ')') : null)
  }

  _onconnection (port, addr) {
    const conn = new Connection(this, port, addr, this._nextConnection, this._allowHalfOpen)
    queueTick(() => this.emit('connection', conn))
    this._nextConnection = b4a.alloc(binding.sizeof_utp_napi_connection_t)
    return this._nextConnection
  }

  _onclose () {
    binding.utp_napi_destroy(this._handle, this._sent.map(toHandle))
    this._handle = null
    this.emit('close')
  }

  static createServer (opts, onconnection) {
    if (typeof opts === 'function') {
      onconnection = opts
      opts = {}
    }
    const server = new Socket(opts)
    if (onconnection) server.on('connection', onconnection)
    return server
  }

  static connect (port, host, opts) {
    const udp = new Socket(opts)
    return udp.connect(port, host).on('close', ononeoffclose)
  }
}

Socket.Socket = Socket

function SendRequest () {
  this._handle = b4a.alloc(binding.sizeof_utp_napi_send_request_t)
  this._buffer = null
  this._callback = null
  this._index = null
}

function noop () {}

function isIP (ip) {
  return IPv4Pattern.test(ip)
}

function toHandle (obj) {
  return obj._handle
}

function ononeoffclose () {
  this._utp.close()
}

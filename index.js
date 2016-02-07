var events = require('events')
var util = require('util')
var stream = require('readable-stream')
var bindings = require('bindings')
var utp = bindings('utp')
var net = require('net')
var dns = require('dns')

var UTP_ERRORS = [
  'UTP_ECONNREFUSED',
  'UTP_ECONNRESET',
  'UTP_ETIMEDOUT'
]

var IPV4_ONLY = new Error('Only IPv4 is supported currently. Open an issue for IPv6 support')

module.exports = UTP

function UTP () {
  if (!(this instanceof UTP)) return new UTP()
  events.EventEmitter.call(this)
  var self = this

  this.connections = []

  this._refs = 1
  this._bound = false
  this._firewalled = true
  this._sending = []
  this._sendingFree = []
  this._handle = utp.utp()
  this._handle.onclose(onclose)
  this._handle.onmessage(onmessage)
  this._handle.onsend(onsend)
  this._handle.onerror(onerror)

  function onmessage (buf, rinfo) {
    self.emit('message', buf, rinfo)
  }

  function onsend (ptr, error) {
    var req = self._sending[ptr]
    self._sending[ptr] = null
    self._sendingFree.push(ptr)
    if (error) req.callback(new Error('Send failed'))
    else req.callback(null, req.buffer.length)
  }

  function onclose () {
    self._handle = null
    self.emit('close')
  }

  function onerror () {
    self.emit(new Error('Unknown UDP error'))
  }
}

util.inherits(UTP, events.EventEmitter)

UTP.createServer = function (onconnection) {
  var server = UTP()
  if (onconnection) server.on('connection', onconnection)
  return server
}

UTP.client = null // reuse a global client

UTP.connect = function (port, host) {
  if (UTP.client) return UTP.client.connect(port, host)
  UTP.client = UTP()
  UTP.client.once('closeable', oncloseable)
  return UTP.client.connect(port, host)
}

function oncloseable () {
  UTP.client.close()
  UTP.client.on('error', noop)
  UTP.client = null
}

UTP.prototype.address = function () {
  return this._handle.address()
}

UTP.prototype.send = function (buf, offset, len, port, host, cb) {
  if (typeof host === 'function') return this.send(buf, offset, len, port, null, host)
  if (!Buffer.isBuffer(buf)) throw new Error('Buffer should be a buffer')
  if (typeof offset !== 'number') throw new Error('Offset should be a number')
  if (typeof len !== 'number') throw new Error('Length should be a number')
  if (typeof port !== 'number') throw new Error('Port should be a number')
  if (host && typeof host !== 'string') throw new Error('Host should be a string')

  if (!this._bound) this.bind()
  if (!cb) cb = noop
  if (host && !net.isIPv4(host)) return this._resolveAndSend(buf, offset, len, port, host, cb)

  var free = this._sendingFree.length ? this._sendingFree.pop() : (this._sending.push(null) - 1)
  this._sending[free] = new SendRequest(buf, cb)

  try {
    this._handle.send(free, buf, offset, len, Number(port), host || '127.0.0.1')
  } catch (err) {
    this._sending[free] = null
    this._sendingFree.push(free)
    next(cb, err)
  }
}

UTP.prototype._resolveAndSend = function (buf, offset, len, port, host, cb) {
  if (!cb) cb = noop
  var self = this
  dns.lookup(host, function (err, ip, family) {
    if (err) return cb(err)
    if (family !== 4) return cb(IPV4_ONLY)
    self.send(buf, offset, len, port, ip, cb)
  })
}

UTP.prototype.connect = function (port, host) {
  if (port && typeof port === 'object') return this.connect(port.port, port.host)
  if (typeof port === 'string') port = Number(port)
  if (host && typeof host !== 'string') throw new Error('Host should be a string')
  if (!port) throw new Error('Port should be a number')

  if (!this._bound) this.bind()

  var conn = new Connection(this)

  if (!host || net.isIPv4(host)) conn._connect(port, host || '127.0.0.1')
  else conn._resolveAndConnect(port, host)

  return conn
}

UTP.prototype.bind = function (port, ip, onlistening) {
  if (typeof port === 'function') return this.bind(0, null, port)
  if (typeof ip === 'function') return this.bind(port, null, ip)
  if (ip && typeof ip !== 'string') throw new Error('IP must be a string')

  if (onlistening) this.once('listening', onlistening)

  if (this._bound) throw new Error('Socket is already bound')

  try {
    this._handle.bind(Number(port) || 0, ip || '0.0.0.0')
    this._bound = true
  } catch (err) {
    emit(this, 'error', err)
    return
  }

  emit(this, 'listening')
}

UTP.prototype.listen = function (port, ip, onlistening) {
  if (this._bound && port) throw new Error('Socket is already bound')
  if (port !== undefined) this.bind(port, ip, onlistening)
  else this.bind()

  if (!this._firewalled) return
  this._firewalled = false

  var self = this
  this._handle.onsocket(function (socket) {
    self.emit('connection', new Connection(self, socket))
  })
}

UTP.prototype.ref = function () {
  if (++this._refs === 1) this._handle.ref()
}

UTP.prototype.unref = function () {
  if (--this._refs === 0) this._handle.unref()
}

UTP.prototype.close = function (cb) {
  if (cb) this.once('close', cb)
  this._handle.destroy()
}

function Connection (utp, socket) {
  stream.Duplex.call(this)

  this._utp = utp
  this._socket = null
  this._index = this._utp.connections.push(this) - 1
  this._dataReq = null
  this._batchReq = null
  this._ondrain = null
  this._ended = false
  this._resolved = false
  this.destroyed = false
  this.on('finish', this._finish)

  if (socket) this._onsocket(socket)
}

util.inherits(Connection, stream.Duplex)

Connection.prototype._connect = function (port, ip) {
  if (this._utp) this._onsocket(this._utp._handle.connect(port, ip || '127.0.0.1'))
}

Connection.prototype._resolveAndConnect = function (port, host) {
  var self = this
  dns.lookup(host, function (err, ip, family) {
    self._resolved = true
    if (err) return self.destroy(err)
    if (family !== 4) return self.destroy(IPV4_ONLY)
    self._connect(port, ip)
  })
}

Connection.prototype._onsocket = function (socket) {
  var self = this

  this._resolved = true
  this._socket = socket

  socket.ondrain(ondrain)
  socket.ondata(ondata)
  socket.onend(onend)
  socket.onclose(onclose)
  socket.onerror(onerror)
  socket.onconnect(onconnect)

  this.emit('resolve')

  function onconnect () {
    self.emit('connect')
  }

  function onerror (error) {
    self.destroy(new Error(UTP_ERRORS[error] || 'UTP_UNKNOWN_ERROR'))
  }

  function onclose () {
    self._cleanup()
    self.destroy()
  }

  function onend () {
    self._finish()
  }

  function ondata (data) {
    self.push(data)
  }

  function ondrain () {
    var ondrain = self._ondrain
    self._ondrain = null
    self._batchReq = null
    self._dataReq = null
    if (ondrain) ondrain()
  }
}

Connection.prototype.ref = function () {
  this._utp.ref()
}

Connection.prototype.unref = function () {
  this._utp.unref()
}

Connection.prototype.address = function () {
  return this._utp && this._utp.address()
}

Connection.prototype._write = function (data, enc, cb) {
  if (this.destroyed) return cb()
  if (!this._resolved) return this.once('resolve', this._write.bind(this, data, enc, cb))
  if (this._socket.write(data)) return cb()
  this._dataReq = data
  this._ondrain = cb
}

Connection.prototype._writev = function (batch, cb) {
  if (this.destroyed) return cb()
  if (!this._resolved) return this.once('resolve', this._writev.bind(this, batch, cb))
  if (this._socket.writev(batch)) return cb()
  this._batchReq = batch
  this._ondrain = cb
}

Connection.prototype._finish = function () {
  if (!this._resolved) return this.once('resolve', this._finish)
  if (this._ended) return
  this._ended = true
  if (this._socket) this._socket.end()
  this.push(null)
}

Connection.prototype.destroy = function (err) {
  if (!this._resolved) return this.once('resolve', this._destroy.bind(this, err))
  if (this.destroyed) return
  this.destroyed = true
  if (err) this.emit('error', err)
  this.emit('close')
  this._finish()
}

Connection.prototype._read = function () {
  // no readable backpressure atm
}

Connection.prototype._cleanup = function () {
  var last = this._utp.connections.pop()
  if (last !== this) {
    this._utp.connections[this._index] = last
    last._index = this._index
  }
  if (!this._utp.connections.length) this._utp.emit('closeable')
  this._utp = null
  this._socket = null
  this.emit('finalize')
}

function SendRequest (buffer, callback) {
  this.buffer = buffer
  this.callback = callback
}

function next (fn, arg) {
  process.nextTick(function () {
    fn(arg)
  })
}

function emit (self, name, arg) {
  process.nextTick(function () {
    if (arg) self.emit(name, arg)
    else self.emit(name)
  })
}

function noop () {}

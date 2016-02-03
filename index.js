var events = require('events')
var util = require('util')
var stream = require('readable-stream')
var bindings = require('bindings')
var utp = bindings('utp')

var UTP_ERRORS = [
  'UTP_ECONNREFUSED',
  'UTP_ECONNRESET',
  'UTP_ETIMEDOUT'
]

module.exports = UTP

function UTP () {
  if (!(this instanceof UTP)) return new UTP()
  events.EventEmitter.call(this)
  var self = this

  this.connections = []

  this._refs = 1
  this._bound = false
  this._firewalled = true
  this._handle = utp.utp()
  this._handle.onclose(onclose)
  this._handle.onmessage(onmessage)
  this._handle.onerror(onerror)

  function onmessage (buf, rinfo) {
    self.emit('message', buf, rinfo)
  }

  function onclose () {
    self.emit('close')
  }

  function onerror () {
    self.emit(new Error('Unknown UDP error'))
  }
}

util.inherits(UTP, events.EventEmitter)

UTP.createServer = function (onconnection) {
  var server = UTP()
  server.on('connection', onconnection)
  return server
}

UTP.client = null // reuse a global client

UTP.connect = function (port, host) {
  if (UTP.client) return UTP.client.connect(port, host)

  UTP.client = UTP()

  var connection = UTP.client.connect(port, host)

  UTP.client.close() // closes when no one is using it
  UTP.client.on('close', onglobalclose)

  return connection
}

function onglobalclose () {
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

  var wrote = this._handle.send(buf, offset, len, Number(port), host || '127.0.0.1')
  process.nextTick(function () {
    if (cb) cb(null, wrote)
  })
}

UTP.prototype.connect = function (port, host) {
  if (!this._bound) this.bind()

  if (port && typeof port === 'object') return this.connect(port.port, port.host)
  if (typeof port === 'string') port = Number(port)
  if (host && typeof host !== 'string') throw new Error('Host should be a string')
  if (!port) throw new Error('Port should be a number')

  // TODO: support dns
  var socket = this._handle.connect(port, host || '127.0.0.1')
  return new Connection(this, socket)
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
  if (port) this.bind(port, ip, onlistening)
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

UTP.prototype.close = function () {
  this._handle.destroy()
}

function Connection (utp, socket) {
  stream.Duplex.call(this)

  var self = this

  this._utp = utp
  this._socket = socket
  this._index = this._utp.connections.push(this) - 1
  this._dataReq = null
  this._batchReq = null
  this._ondrain = null
  this._ended = false
  this.destroyed = false

  socket.ondrain(ondrain)
  socket.ondata(ondata)
  socket.onend(onend)
  socket.onclose(onclose)
  socket.onerror(onerror)
  socket.onconnect(onconnect)

  this.on('finish', this._finish)

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

util.inherits(Connection, stream.Duplex)

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
  if (this._socket.write(data)) return cb()
  this._dataReq = data
  this._ondrain = cb
}

Connection.prototype._writev = function (batch, cb) {
  if (this.destroyed) return cb()
  if (this._socket.writev(batch)) return cb()
  this._batchReq = batch
  this._ondrain = cb
}

Connection.prototype._finish = function () {
  if (this._ended) return
  this._ended = true
  if (this._socket) this._socket.end()
  this.push(null)
}

Connection.prototype.destroy = function (err) {
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
  this._utp = null
  this._socket = null
  this.emit('finalize')
}

function emit (self, name, arg) {
  process.nextTick(function () {
    if (arg) self.emit(name, arg)
    else self.emit(name)
  })
}

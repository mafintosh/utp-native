var bindings = require('bindings')
var utp = bindings('utp')
var events = require('events')
var stream = require('readable-stream')
var util = require('util')

exports.Connection = Connection
exports.connect = connect

function connect (port, host) {
  var c = new Connection()
  c.connect(port, host)
  return c
}

function Connection (handle) {
  if (!(this instanceof Connection)) return Connection(handle)
  stream.Duplex.call(this)

  this._handle = handle || -1
  this._port = 0
  this._setupCallbacks()
  this._ondrain = null
  this._connecting = false
  this._reading = false

  this.destroyed = false
}

util.inherits(Connection, stream.Duplex)

Connection.prototype.connect = function (port, host) {
  this._create()
  try {
    this._port = utp.connect(this._handle, '' + port, host || '127.0.0.1', '' + 0, '0.0.0.0')
    this._connecting = true
  } catch (err) {
    this._destroyNext(err)
    return
  }
}

Connection.prototype._create = function () {
  if (this._handle > -1) return
  this._handle = utp.create()
  this._setupCallbacks()
}

Connection.prototype._setupCallbacks = function () {
  if (this._handle === -1) return
  var self = this

  utp.callbacks(this._handle, {
    onread: onread,
    onconnect: onconnect,
    oneof: oneof,
    ondrain: ondrain
  })

  this.once('finish', this._end)

  function ondrain () {
    var cb = self._ondrain
    self._ondrain = null
    if (cb) cb()
  }

  function onread (buf) {
    self.push(buf)
  }

  function oneof () {
    self._eof()
  }

  function onconnect () {
    self._connecting = false
    self.emit('connect')
  }
}

Connection.prototype.destroy = function (err) {
  if (this.destroyed) return
  this.destroyed = true

  if (this._handle > -1) {
    utp.destroy(this._handle)
  }

  if (err) this.emit('error', err)
  this.emit('close')
}

Connection.prototype._end = function () {
  if (this._connecting) return this.once('connect', this._end)
  this.destroy()
}

Connection.prototype._destroyNext = function (err) {
  var self = this
  process.nextTick(function () {
    self.destroy(err)
  })
}

Connection.prototype._writev = function (batch, cb) {
  if (this._handle === -1) return cb()

  var buffers = new Array(batch.length)
  for (var i = 0; i < buffers.length; i++) buffers[i] = batch[i].chunk

  if (!utp.sendBulk(this._handle, buffers)) this._ondrain = cb
  else cb()
}

Connection.prototype._eof = function () {
  // TODO: can utp be half-open??
  this._handle = -1
  this.end()
  this.push(null)
}

Connection.prototype._write = function (data, enc, cb) {
  if (this._handle === -1) return cb()

  if (!utp.send(this._handle, data)) this._ondrain = cb
  else cb()
}

Connection.prototype._read = function () {
  // TODO: readable preassure
}

exports.Server
exports.createServer = Server

function Server (onconnection) {
  if (!(this instanceof Server)) return new Server(onconnection)
  events.EventEmitter.call(this)
  if (onconnection) this.on('connection', onconnection)
  this._handle = -1
  this._port = 0
}

util.inherits(Server, events.EventEmitter)

Server.prototype.address = function () {
  if (!this._port) throw new Error('Server is not bound')
  return {port: this._port, address: '0.0.0.0'} // TODO return actual address
}

Server.prototype.close = function () {
  throw new Error('Not yet implemented')
}

Server.prototype.listen = function (port, addr, onlistening) {
  if (typeof port === 'function') return this.listen(0, null, port)
  if (typeof addr === 'function') return this.listen(port, null, addr)
  if (typeof port !== 'number') throw new Error('port must be a number')
  if (onlistening) this.on('listening', onlistening)

  var self = this
  this._create()

  try {
    this._port = utp.listen(this._handle, '' + (port || 0), addr || '0.0.0.0')
  } catch (err) {
    return this._error(err)
  }

  process.nextTick(function () {
    self.emit('listening')
  })
}

Server.prototype._error = function (err) {
  var self = this
  utp.destroy(this._handle)
  this._handle = -1
  process.nextTick(function () {
    self.emit('error', err)
  })
}

Server.prototype._create = function () {
  if (this._handle > -1) throw new Error('Server is already listening')

  var self = this

  this._handle = utp.create()
  utp.callbacks(this._handle, {
    onsocket: onsocket
  })

  function onsocket (handle) {
    self.emit('connection', new Connection(handle))
  }
}

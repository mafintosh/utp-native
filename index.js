var stream = require('stream')
var events = require('events')
var util = require('util')
var bindings = require('bindings')
var utp = bindings('utp')

var Connection = function (handle, port, host) {
  stream.Duplex.call(this)

  var self = this
  this._handle = handle
  this._connected = false

  this._handle.handlers({
    onconnect: function () {
      self._connected = true
      self.emit('connect')
    },
    onread: function (data, length) {
      self.push(data.slice(0, length))
    }
  })

  if (port) {
    this._handle.connect(port, host)
  } else {
    this._connected = true
  }
}

util.inherits(Connection, stream.Duplex)

Connection.prototype._read = function () {
  // TODO: backpressure :)
}

Connection.prototype._write = function (data, enc, cb) {
  // TODO: backpressure :)
  if (!this._connected) return this.once('connect', this._write.bind(this, data, enc, cb))
  this._handle.write(data, data.length)
  cb()
}

exports.connect = function (port, host) {
  if (!port) throw new Error('Port is required')
  return new Connection(utp.socket(), '' + port, host || '127.0.0.1')
}

var Server = function () {
  events.EventEmitter.call(this)
  var self = this
  this._handle = utp.socket()
  this._handle.handlers({
    onsocket: function (handle) {
      var conn = new Connection(handle)
      self.emit('connection', conn)
    }
  })
}

util.inherits(Server, events.EventEmitter)

Server.prototype.listen = function (port) {
  this._handle.listen('' + (port || 0))
}

exports.createServer = function (onconnection) {
  var server = new Server()
  if (onconnection) server.on('connection', onconnection)
  return server
}

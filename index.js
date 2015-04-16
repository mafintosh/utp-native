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
  this._buf = null
  this._cb = null

  this._handle.handlers({
    onconnect: function () {
      self._connected = true
      self.emit('connect')
    },
    onread: function (data, length) {
      self.push(data.slice(0, length))
    },
    oneof: function () {
      self.push(null)
    },
    ondrain: function () {
      var cb = self._cb
      if (!cb) return
      self._buf = null
      self._cb = null
      cb()
    },
    onerror: function () {
      self.emit('error', new Error('UTP socket error'))
    }
  })

  this.once('finish', this.close)

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

// Connection.prototype._writev = function(datas, cb) {
//   if (!this._connected) return this.once('connect', this._writev.bind(this, datas, cb))
//   console.log(datas)
// }

Connection.prototype._write = function (data, enc, cb) {
  if (!this._connected) return this.once('connect', this._write.bind(this, data, enc, cb))
  if (!this._handle) return cb(new Error('Socket is closed'))
  this._buf = data // retain
  this._cb = cb // retain
  this._handle.write(data)
}

Connection.prototype.close = function () {
  if (this._handle) {
    this._handle.close()
    this._handle = null
  }
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
    },
    onerror: function () {
      self.emit('error', new Error('UTP server error'))
    }
  })
}

util.inherits(Server, events.EventEmitter)

Server.prototype.close = function () {
  if (this._handle) {
    this._handle.close()
    this._handle = null
  }
}

Server.prototype.listen = function (port, onlisten) {
  if (!this._handle) {
    this.emit('error', new Error('Server is closed'))
    return
  }

  var self = this

  if (onlisten) this.once('listening', onlisten)
  this._handle.listen('' + (port || 0))
  process.nextTick(function () {
    self.emit('listening')
  })
}

exports.createServer = function (onconnection) {
  var server = new Server()
  if (onconnection) server.on('connection', onconnection)
  return server
}

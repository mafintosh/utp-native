const EventEmitter = require('events')
const net = require('net')
const dns = require('dns')
const { Duplex } = require('streamx')
const timeout = require('timeout-refresh')
const b4a = require('b4a')
const binding = require('./lib/binding')
const UTPConnection = require('./lib/utp-connection')
const UTPSocket = require('./lib/utp-socket')

const Socket = module.exports = class Socket extends EventEmitter {
  constructor (opts) {
    super()

    this.connections = []
    this.maxConnections = 0

    this._address = null
    this._socket = new UTPSocket()
    this._allowHalfOpen = !opts || opts.allowHalfOpen !== false

    this._socket
      .on('connection', this._onconnection.bind(this))
  }

  firewall (enable) {
    this._socket.firewall(enable)
  }

  address () {
    if (!this._address || this._closing) throw new Error('Socket not bound')
    return {
      address: this._address,
      family: 'IPv4',
      port: binding.utp_napi_local_port(this._socket._handle)
    }
  }

  getRecvBufferSize () {
    if (!this._inited) throw new Error('getRecvBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_recv_buffer(this._socket._handle, 0)
  }

  setRecvBufferSize (n) {
    if (!this._inited) throw new Error('setRecvBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_recv_buffer(this._socket._handle, n)
  }

  getSendBufferSize () {
    if (!this._inited) throw new Error('getSendBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_send_buffer(this._socket._handle, 0)
  }

  setSendBufferSize (n) {
    if (!this._inited) throw new Error('setSendBufferSize EBADF')
    if (this._closing) return 0
    return binding.utp_napi_send_buffer(this._socket._handle, n)
  }

  setTTL (ttl) {
    if (!this._inited) throw new Error('setTTL EBADF')
    if (this._closing) return
    binding.utp_napi_set_ttl(this._socket._handle, ttl)
  }

  connect (port, ip) {
    if (!this._socket.bound) this.bind()
    if (!ip) ip = '127.0.0.1'

    const connection = new Connection(
      this,
      null,
      port,
      ip,
      this._allowHalfOpen
    )

    if (!net.isIPv4(ip)) connection._resolveAndConnect(port, ip)
    else connection._connect(port, ip)

    return connection
  }

  listen (port, ip, onlistening) {
    if (!this._socket.bound) this.bind(port, ip, onlistening)
    this.firewall(false)
  }

  send (buf, offset, len, port, host, cb) {
    if (!this._socket.bound) this._socket.bind()
    if (!net.isIPv4(host)) return this._resolveAndSend(buf, offset, len, port, host, cb)
    if (this._closing) return cb(new Error('Socket is closed'))
  }

  bind (port, ip, onlistening) {
    if (typeof port === 'function') return this.bind(0, null, port)
    if (typeof ip === 'function') return this.bind(port, null, ip)
    if (!port) port = 0
    if (!ip) ip = '0.0.0.0'

    if (this._socket.closing) return

    if (this._address) {
      this.emit('error', new Error('Socket already bound'))
      return
    }

    if (onlistening) this.once('listening', onlistening)
    if (!net.isIPv4(ip)) return this._resolveAndBind(port, ip)

    this._address = ip

    this._socket.bind(port, ip, (err) => {
      if (err) {
        this._address = null
        this.emit('error', err)
      } else {
        this.emit('listening')
      }
    })
  }

  close (cb) {
    if (this._socket.closed) return cb && cb(null)
    if (cb) this.once('close', cb)
    if (this._socket.closing) return

    this._socket.close((err) => {
      if (err) this.emit('error', err)
    })
  }

  _closeMaybe () {
    // if (this._closing && !this.connections.length && !this._sending.length && this._inited && !this._closed) {
    //   this._closed = true
    //   binding.utp_napi_close(this._handle)
    // }
  }

  _resolveAndSend (buf, offset, len, port, host, cb) {
    dns.lookup(host, { family: 4 }, (err, ip) => {
      if (err) cb(err)
      else this.send(buf, offset, len, port, ip, cb)
    })
  }

  _resolveAndBind (port, host) {
    dns.lookup(host, { family: 4 }, (err, ip) => {
      if (err) this.emit('error', err)
      else this.bind(port, ip)
    })
  }

  _onsend () {
    if (this._socket.closing) this._closeMaybe()
  }

  _onconnection (port, ip, handle) {
    this.emit('connection', new Connection(this, handle, port, ip, this._allowHalfOpen))
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
    const socket = new Socket(opts)
    return socket
      .connect(port, host)
      .on('close', () => socket.close())
  }
}

Socket.Socket = Socket

class Connection extends Duplex {
  constructor (socket, connection, port, address, halfOpen) {
    super()

    this.remoteAddress = address
    this.remoteFamily = 'IPv4'
    this.remotePort = port

    this._index = -1
    this._socket = socket
    this._connection = connection || new UTPConnection(this._socket._socket)
    this._view = new Uint32Array(this._connection._handle.buffer, this._connection._handle.byteOffset, 2)
    this._timeout = null
    this._contentSize = 0
    this._allowOpen = halfOpen ? 2 : 1

    this._connection
      .on('data', (buffer) => this._onread(buffer))
      .on('end', () => this._onend())
      .on('connect', () => this._onconnect())
  }

  setTimeout (ms, ontimeout) {
    if (ontimeout) this.once('timeout', ontimeout)
    if (this._timeout) this._timeout.destroy()
    this._timeout = timeout(ms, this._ontimeout, this)
  }

  setInteractive (interactive) {
    this.setPacketSize(interactive ? 0 : 65536)
  }

  setContentSize (size) {
    this._view[0] = size < 65536 ? (size >= 0 ? size : 0) : 65536
    this._contentSize = size
  }

  setPacketSize (size) {
    if (size > 65536) size = 65536
    this._view[0] = size
    this._contentSize = 0
  }

  address () {
    return this.destroyed ? null : this._socket.address()
  }

  _open (cb) {
    if (this._connection.connected) cb(null)
    else {
      this._connection.once('connect', () => {
        if (this._timeout) this._timeout.refresh()
        cb(null)
      })
    }
  }

  _destroy (cb) {
    this._connection.close(cb)
  }

  _destroyMaybe () {
    if (this._allowOpen && !--this._allowOpen) this.destroy()
  }

  _final (cb) {
    this._connection.shutdown()
    this._destroyMaybe()
    cb(null)
  }

  _writev (datas, cb) {
    let bufs = new Array(datas.length)
    for (var i = 0; i < datas.length; i++) {
      const data = datas[i]
      bufs[i] = typeof data === 'string' ? b4a.from(data) : data
    }

    if (bufs.length > 256) bufs = [b4a.concat(bufs)]

    this._connection.writev(bufs, cb)
  }

  _connect (port, ip) {
    this.remotePort = port
    this.remoteAddress = ip

    this._connection.connect(port, ip, (err) => {
      if (err) this.emit('error', err)
    })
  }

  _resolveAndConnect (port, host) {
    dns.lookup(host, { family: 4 }, (err, ip) => {
      if (err) this.destroy(err)
      else this._connect(port, ip)
    })
  }

  _ontimeout () {
    this.emit('timeout')
  }

  _onread (buffer) {
    if (this._timeout) this._timeout.refresh()

    let size = buffer.byteLength

    if (this._contentSize) {
      if (size > this._contentSize) size = this._contentSize
      this._contentSize -= size
      if (this._contentSize < 65536) this._view[0] = this._contentSize
    }

    this.push(buffer)
  }

  _onend () {
    if (this._timeout) this._timeout.destroy()
    this.push(null)
    this._destroyMaybe()
  }

  _onconnect () {
    this.emit('connect')
  }
}

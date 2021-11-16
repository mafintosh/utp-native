const EventEmitter = require('events')
const net = require('net')
const dns = require('dns')
const { Duplex } = require('streamx')
const timeout = require('timeout-refresh')
const set = require('unordered-set')
const b4a = require('b4a')
const binding = require('./lib/binding')
const UTPConnection = require('./lib/utp-connection')
const UTPSocket = require('./lib/utp-socket')

class Socket extends EventEmitter {
  constructor (opts) {
    super()

    this.connections = []
    this.maxConnections = 0

    this._address = null
    this._socket = new UTPSocket()
    this._allowHalfOpen = !opts || opts.allowHalfOpen !== false

    this._socket.onerror = this._onerror.bind(this)
    this._socket.onconnection = this._onconnection.bind(this)
    this._socket.onmessage = this._onmessage.bind(this)
    this._socket.onclose = this._onclose.bind(this)
  }

  firewall (enable) {
    this._socket.firewall(enable)
  }

  address () {
    if (!this._socket.bound || this._socket.closing) throw new Error('Socket not bound')
    return {
      address: this._address,
      family: 'IPv4',
      port: binding.utp_napi_local_port(this._socket._handle)
    }
  }

  getRecvBufferSize () {
    if (!this._socket.inited) throw new Error('getRecvBufferSize EBADF')
    if (this._socket.closing) return 0
    return binding.utp_napi_recv_buffer(this._socket._handle, 0)
  }

  setRecvBufferSize (n) {
    if (!this._socket.inited) throw new Error('setRecvBufferSize EBADF')
    if (this._socket.closing) return 0
    return binding.utp_napi_recv_buffer(this._socket._handle, n)
  }

  getSendBufferSize () {
    if (!this._socket.inited) throw new Error('getSendBufferSize EBADF')
    if (this._socket.closing) return 0
    return binding.utp_napi_send_buffer(this._socket._handle, 0)
  }

  setSendBufferSize (n) {
    if (!this._socket.inited) throw new Error('setSendBufferSize EBADF')
    if (this._socket.closing) return 0
    return binding.utp_napi_send_buffer(this._socket._handle, n)
  }

  setTTL (ttl) {
    if (!this._socket.inited) throw new Error('setTTL EBADF')
    if (this._socket.closing) return
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

  send (buf, offset, len, port, host, onsent) {
    if (!this._socket.bound) this.bind()
    if (!net.isIPv4(host)) return this._resolveAndSend(buf, offset, len, port, host, onsent)

    try {
      const request = this._socket.send(buf, offset, len, port, host)

      if (onsent) request.onsent = onsent
    } catch (err) {
      if (onsent) onsent(err)
    }
  }

  bind (port, ip, onlistening) {
    if (typeof port === 'function') return this.bind(0, null, port)
    if (typeof ip === 'function') return this.bind(port, null, ip)
    if (!port) port = 0
    if (!ip) ip = '0.0.0.0'

    if (this._socket.closed || this._socket.closing) return

    if (this._address) {
      this.emit('error', new Error('Socket already bound'))
      return
    }

    if (onlistening) this.once('listening', onlistening)

    if (!net.isIPv4(ip)) return this._resolveAndBind(port, ip)

    this._address = ip

    try {
      this._socket.bind(port, ip)
      this.emit('listening')
    } catch (err) {
      this._address = null
      this.emit('error', err)
    }
  }

  close (cb) {
    if (this._socket.closed) return cb()

    if (cb) this.once('close', cb)

    this._socket.close()
  }

  _resolveAndSend (buf, offset, len, port, host, onsent) {
    dns.lookup(host, { family: 4 }, (err, ip) => {
      if (err) this.emit('error', err)
      else this.send(buf, offset, len, port, ip, onsent)
    })
  }

  _resolveAndBind (port, host) {
    dns.lookup(host, { family: 4 }, (err, ip) => {
      if (err) this.emit('error', err)
      else this.bind(port, ip)
    })
  }

  _onerror (err) {
    this.emit('error', err)
  }

  _onconnection (port, ip, handle) {
    this.emit('connection', new Connection(this, handle, port, ip, this._allowHalfOpen))
  }

  _onmessage (buffer, address) {
    this.emit('message', buffer, address)
  }

  _onclose () {
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
    const socket = new Socket(opts)
    return socket
      .connect(port, host)
      .on('close', () => socket.close())
  }
}

module.exports = Socket.Socket = Socket

class Connection extends Duplex {
  constructor (socket, connection, port, address, halfOpen) {
    super({ mapWritable: toBuffer })

    this.remoteAddress = address
    this.remoteFamily = 'IPv4'
    this.remotePort = port

    this._index = -1
    this._socket = socket
    this._connection = connection || new UTPConnection(this._socket._socket)
    this._view = new Uint32Array(this._connection._handle.buffer, this._connection._handle.byteOffset, 2)
    this._timeout = null
    this._contentSize = 0

    this._opening = null
    this._destroying = null

    this._connection.onerror = this._onerror.bind(this)
    this._connection.ondata = this._ondata.bind(this)
    this._connection.onend = this._onend.bind(this)
    this._connection.onconnect = this._onconnect.bind(this)
    this._connection.onclose = this._onclose.bind(this)

    set.add(this._socket.connections, this)

    if (
      this._socket.maxConnections > 0 &&
      this._socket.connections.length >= this._socket.maxConnections
    ) {
      this._socket.firewall(true)
    }

    if (!halfOpen) this.on('end', () => this.end())
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
    else this._opening = cb
  }

  _continueOpen (err) {
    const cb = this._opening

    if (cb) {
      this._opening = null
      cb(err)
    }
  }

  _predestroy () {
    this._continueOpen(new Error('Socket was destroyed'))
  }

  _destroy (cb) {
    set.remove(this._socket.connections, this)

    if (
      this._socket.maxConnections <= 0 ||
      this._socket.connections.length < this._socket.maxConnections
    ) {
      this._socket.firewall(false)
    }

    if (this._connection.closed) cb(null)
    else {
      this._destroying = cb
      this._connection.close()
    }
  }

  _final (cb) {
    this._connection.shutdown()
    cb(null)
  }

  _writev (batch, cb) {
    this._connection.writev(batch.length > 256 ? [b4a.concat(batch)] : batch, cb)
  }

  _connect (port, ip) {
    this.remotePort = port
    this.remoteAddress = ip

    this._connection.connect(port, ip)
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

  _onerror (err) {
    this.destroy(err)
  }

  _ondata (buffer) {
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
  }

  _onconnect () {
    this._continueOpen()
    this.emit('connect')
  }

  _onclose () {
    const cb = this._destroying

    if (cb) {
      this._destroying = null
      cb(null)
    } else {
      this.destroy()
    }
  }
}

function toBuffer (data) {
  return typeof data === 'string' ? b4a.from(data) : data
}

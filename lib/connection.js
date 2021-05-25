const binding = require('./binding')
const streamx = require('streamx')
const unordered = require('unordered-set')
const dns = require('dns')
const timeout = require('timeout-refresh')

const EMPTY = Buffer.alloc(0)
const UTP_ERRORS = [
  'UTP_ECONNREFUSED',
  'UTP_ECONNRESET',
  'UTP_ETIMEDOUT',
  'UTP_UNKNOWN'
]

module.exports = class Connection extends streamx.Duplex {
  constructor (utp, port, address, handle, halfOpen) {
    super({
      mapWritable: Buffer.from
    })

    this.remoteAddress = address || '127.0.0.1'
    this.remoteFamily = 'IPv4'
    this.remotePort = port

    this._index = -1
    this._utp = utp
    this._connectCalled = !!handle
    this._handle = handle || Buffer.alloc(binding.sizeof_utp_napi_connection_t)
    this._buffer = Buffer.allocUnsafe(65536 * 2)
    this._offset = 0
    this._view = new Uint32Array(this._handle.buffer, this._handle.byteOffset, 2)
    this._callback = null
    this._writing = null
    this._timeout = null
    this._contentSize = 0
    this._endCalled = false
    this._inited = false
    if (!halfOpen) {
      this.once('end', () => {
        if (this.writable) {
          this.end()
        }
      })
      this.once('finish', () => {
        if (this.writable) {
          this.push(null)
        }
      })
    }

    this.once('error', unregister)
    this.once('close', unregister)

    function unregister () {
      this.off('error', unregister)
      this.off('close', unregister)
      process.nextTick(() => {
        unordered.remove(utp.connections, this)
        if (!utp.maxConnections || utp.connections.length < utp.maxConnections) {
          utp.firewall(false)
        }
        utp._closeMaybe()
      })
    }

    unordered.add(utp.connections, this)
    if (utp.maxConnections && utp.connections.length >= utp.maxConnections) {
      utp.firewall(true)
    }
  }

  _open (cb) {
    const remoteAddress = this.remoteAddress
    if (this._connectCalled) {
      this._init(cb)
    } else {
      if (!isIP(remoteAddress)) this._resolveAndConnect(cb)
      else this._connect(cb)
    }
  }

  _init (initCb) {
    this._inited = true
    let opened = false
    binding.utp_napi_connection_init(this._handle, this, this._buffer,
      onread,
      this._ondrain,
      this._onend,
      onerror,
      this._onclose,
      onconnect,
      this._realloc
    )

    function onread (size) {
      if (!opened) {
        onconnect.call(this)
      }
      return this._onread(size)
    }

    function onerror (code) {
      const error = createUTPError(code)
      if (!opened) {
        opened = true
        initCb(error)
      } else {
        this.destroy(error)
      }
    }

    function onconnect () {
      if (opened) return
      opened = true
      if (this._timeout) this._timeout.refresh()

      if (this._writing) {
        const cb = this._callback
        const data = this._writing[0]
        this._callback = null
        this._writing = null
        this._write(data, cb)
      }
      process.nextTick(() => this.emit('connect'))
      initCb()
    }
  }

  _final (cb) {
    // Sends the write-end message
    binding.utp_napi_connection_shutdown(this._handle)
    this._connectCalled = false
    // The final message is sent out,
    process.nextTick(cb)
  }

  _destroy (cb) {
    if (!this._inited) {
      return cb()
    }
    this._oncloseHook = cb
    if (this._connectCalled) {
      binding.utp_napi_connection_close(this._handle)
    } else {
      binding.utp_napi_connection_on_close(this._handle)
    }
  }

  setTimeout (ms, ontimeout) {
    if (ontimeout) this.once('timeout', ontimeout)
    if (this._timeout) this._timeout.destroy()
    this._timeout = timeout(ms, this._ontimeout, this)
  }

  _ontimeout () {
    this.emit('timeout')
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
    if (this.destroyed) return null
    return this._utp.address()
  }

  _read (cb) {
    // TODO: backpressure
    cb(null)
  }

  _write (data, cb) {
    if (this.destroyed) return

    if (!binding.utp_napi_connection_write(this._handle, data)) {
      this._callback = cb
      this._writing = [data]
      return
    }
    cb(null)
  }

  _writev (datas, cb) {
    if (this.destroyed) return

    const bufs = new Array(datas.length)
    for (var i = 0; i < datas.length; i++) bufs[i] = datas[i].chunk

    if (bufs.length > 256) return this._write(Buffer.concat(bufs), null, cb)

    if (!binding.utp_napi_connection_writev(this._handle, bufs)) {
      this._callback = cb
      this._writing = bufs
      return
    }

    cb(null)
  }

  _realloc () {
    this._buffer = Buffer.allocUnsafe(this._buffer.length)
    this._offset = 0
    return this._buffer
  }

  _onread (size) {
    if (this._timeout) this._timeout.refresh()

    const buf = this._buffer.slice(this._offset, this._offset += size)
    if (this._contentSize) {
      if (size > this._contentSize) size = this._contentSize
      this._contentSize -= size
      if (this._contentSize < 65536) this._view[0] = this._contentSize
    }

    this.push(buf)

    if (this._buffer.length - this._offset <= 69632) {
      // 64kb + 4kb as max package buffer is 64kb and we wanna make sure we have room for that
      // plus the next udp package, returning the buffer indicates to the native code that
      // it should use the new buffer now
      this._buffer = Buffer.allocUnsafe(this._buffer.length)
      this._offset = 0
      return this._buffer
    }

    return EMPTY
  }

  _ondrain () {
    this._writing = null
    const cb = this._callback
    this._callback = null
    cb(null)
  }

  _onclose () {
    if (this._oncloseHook) {
      const cb = this._oncloseHook
      this._oncloseHook = null
      process.nextTick(cb)
    } else {
      this.destroy(new Error('Connection closed.'))
    }
  }

  _onend () {
    if (this._timeout) this._timeout.destroy()
    if (!this._endCalled) {
      this._endCalled = true
      this.push(null)
    }
  }

  _resolveAndConnect (cb) {
    const { remoteAddress: host } = this
    dns.lookup(host, (err, ip) => {
      if (err) return cb(err)
      if (!ip) return cb(new Error(`Could not resolve ${host}`))
      this.remoteAddress = ip
      this._connect(cb)
    })
  }

  _connect (cb) {
    if (this.destroyed) {
      return
    }
    this._connectCalled = true
    binding.utp_napi_connect(this._utp._handle, this._handle, this.remotePort, this.remoteAddress)
    this._init(cb)
  }
}

function createUTPError (code) {
  const str = UTP_ERRORS[code < 0 ? 3 : code]
  const err = new Error(str)
  err.code = str
  err.errno = code
  return err
}

function isIP (ip) {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

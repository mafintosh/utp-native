const test = require('brittle')
const utp = require('../')

test('server + connect', function (t) {
  t.plan(1)

  var connected = false

  const server = utp.createServer(function (socket) {
    connected = true
    socket.write('hello mike')
    socket.end()
  })

  server.listen(function () {
    var socket = utp.connect(server.address().port)

    socket.on('connect', function () {
      socket.destroy()
      server.close()
      t.ok(connected, 'connected successfully')
    })

    socket.write('hello joe')
  })
})

test('server + connect with resolve', function (t) {
  t.plan(1)

  var connected = false

  const server = utp.createServer(function (socket) {
    connected = true
    socket.write('hello mike')
    socket.end()
  })

  server.listen(function () {
    const socket = utp.connect(server.address().port, 'localhost')

    socket.on('connect', function () {
      socket.destroy()
      server.close()
      t.ok(connected, 'connected successfully')
    })

    socket.write('hello joe')
  })
})

test('bad resolve', function (t) {
  t.plan(4)

  const socket = utp.connect(10000, 'domain.does-not-exist')

  socket.on('connect', function () {
    t.fail('should not connect')
  })

  socket.on('error', function () {
    t.pass('errored')
  })

  socket.on('close', function () {
    t.pass('closed')
  })
})

test('server immediate close', function (t) {
  t.plan(3)

  const server = utp.createServer(function (socket) {
    socket.write('hi')
    socket.end()
    server.close(function () {
      t.pass('closed')
    })
  })

  server.listen(0, function () {
    var socket = utp.connect(server.address().port)

    socket.write('hi')
    socket.once('connect', function () {
      socket.end()
    })

    socket.on('close', function () {
      t.pass('client closed')
    })
  })
})

test.skip('only server sends', function (t) {
  // this is skipped because it doesn't work.
  // utpcat has the same issue so this seems to be a bug
  // in libutp it self
  // in practice this is less of a problem as most protocols
  // exchange a handshake message. would be great to get fixed though
  var server = utp.createServer(function (socket) {
    socket.write('hi')
  })

  server.listen(0, function () {
    var socket = utp.connect(server.address().port)

    socket.on('data', function (data) {
      t.alike(data, Buffer.from('hi'))
      socket.destroy()
      server.close()
    })
  })
})

test('server listens on a port in use', function (t) {
  t.plan(1)

  const server = utp.createServer()
  server.listen(0, function () {
    const server2 = utp.createServer()
    server2.listen(server.address().port, function () {
      t.fail('should not be listening')
    })
    server2.on('error', function () {
      server.close()
      server2.close()
      t.pass('had error')
    })
  })
})

test('echo server', function (t) {
  t.plan(2)

  const server = utp.createServer(function (socket) {
    socket.pipe(socket)
    socket.on('data', function (data) {
      t.alike(data, Buffer.from('hello'))
    })
    socket.on('end', function () {
      socket.end()
    })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)

    socket.write('hello')
    socket.on('data', function (data) {
      socket.end()
      server.close()
      t.alike(data, Buffer.from('hello'))
    })
  })
})

test('echo server back and fourth', function (t) {
  t.plan(12)

  var echoed = 0

  const server = utp.createServer(function (socket) {
    socket.pipe(socket)
    socket.on('data', function (data) {
      echoed++
      t.alike(data, Buffer.from('hello'))
    })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)

    var rounds = 10

    socket.write('hello')
    socket.on('data', function (data) {
      if (--rounds) return socket.write(data)
      socket.end()
      server.close()
      t.is(echoed, 10)
      t.alike(Buffer.from('hello'), data)
    })
  })
})

test('echo big message', function (t) {
  t.plan(2)

  var packets = 0

  const big = Buffer.alloc(8 * 1024 * 1024)
  big.fill('yolo')

  const server = utp.createServer(function (socket) {
    socket.on('data', () => packets++)
    socket.pipe(socket)
  })

  server.listen(0, function () {
    const then = Date.now()
    const socket = utp.connect(server.address().port)
    const buffer = Buffer.alloc(big.length)

    var ptr = 0

    socket.write(big)
    socket.on('data', function (data) {
      packets++
      data.copy(buffer, ptr)
      ptr += data.length
      if (big.length === ptr) {
        socket.end()
        server.close()
        t.alike(buffer, big)
        t.pass('echo took ' + (Date.now() - then) + 'ms (' + packets + ' packets)')
      }
    })
  })
})

test('echo big message with setContentSize', function (t) {
  t.plan(2)

  var packets = 0

  const big = Buffer.alloc(8 * 1024 * 1024)
  big.fill('yolo')

  const server = utp.createServer(function (socket) {
    socket.setContentSize(big.length)
    socket.on('data', () => packets++)
    socket.pipe(socket)
  })

  server.listen(0, function () {
    const then = Date.now()
    const socket = utp.connect(server.address().port)
    const buffer = Buffer.alloc(big.length)

    var ptr = 0

    socket.setContentSize(big.length)
    socket.write(big)
    socket.on('data', function (data) {
      packets++
      data.copy(buffer, ptr)
      ptr += data.length
      if (big.length === ptr) {
        socket.end()
        server.close()
        t.alike(buffer, big)
        t.pass('echo took ' + (Date.now() - then) + 'ms (' + packets + ' packets)')
      }
    })
  })
})

test('two connections', function (t) {
  t.plan(5)

  var count = 0
  var gotA = false
  var gotB = false

  const server = utp.createServer(function (socket) {
    count++
    socket.pipe(socket)
  })

  server.listen(0, function () {
    const socket1 = utp.connect(server.address().port)
    const socket2 = utp.connect(server.address().port)

    socket1.write('a')
    socket2.write('b')

    socket1.on('data', function (data) {
      gotA = true
      t.alike(data, Buffer.from('a'))
      if (gotB) done()
    })

    socket2.on('data', function (data) {
      gotB = true
      t.alike(data, Buffer.from('b'))
      if (gotA) done()
    })

    function done () {
      socket1.end()
      socket2.end()
      server.close()
      t.ok(gotA)
      t.ok(gotB)
      t.alike(count, 2)
    }
  })
})

test('emits close', function (t) {
  t.plan(6)

  var serverClosed = false
  var clientClosed = false

  const server = utp.createServer(function (socket) {
    socket.resume()
    socket.on('end', function () {
      socket.end()
    })
    socket.on('close', function () {
      serverClosed = true
      if (clientClosed) done()
    })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    socket.write('hi')
    socket.end() // utp does not support half open
    socket.resume()
    socket.on('close', function () {
      clientClosed = true
      if (serverClosed) done()
    })
  })

  function done () {
    server.close()
    t.ok(serverClosed)
    t.ok(clientClosed)
  }
})

test('flushes', function (t) {
  t.plan(1)

  var sent = ''
  const server = utp.createServer(function (socket) {
    var buf = ''
    socket.setEncoding('utf-8')
    socket.on('data', function (data) {
      buf += data
    })
    socket.on('end', function () {
      server.close()
      socket.end()
      t.alike(buf, sent)
    })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    for (var i = 0; i < 50; i++) {
      socket.write(i + '\n')
      sent += i + '\n'
    }
    socket.end()
  })
})

test('close waits for connections to close', function (t) {
  t.plan(1)

  var sent = ''
  const server = utp.createServer(function (socket) {
    var buf = ''
    socket.setEncoding('utf-8')
    socket.on('data', function (data) {
      buf += data
    })
    socket.on('end', function () {
      socket.end()
      t.alike(buf, sent)
    })
    server.close()
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    for (var i = 0; i < 50; i++) {
      socket.write(i + '\n')
      sent += i + '\n'
    }
    socket.end()
  })
})

test('disable half open', function (t) {
  t.plan(3)
  const server = utp.createServer({ allowHalfOpen: false }, function (socket) {
    socket.on('data', function (data) {
      t.alike(data, Buffer.from('a'))
    })
    socket.on('close', function () {
      server.close(function () {
        t.pass('everything closed')
      })
    })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port, '127.0.0.1', { allowHalfOpen: true })

    socket.write('a')
    socket.end()
  })
})

test('timeout', async function (t) {
  const close = t.test('close')
  close.plan(4)

  const server = utp.createServer(function (socket) {
    socket.setTimeout(100, function () {
      t.pass('timed out')
      socket.destroy()
    })
    socket.resume()
    socket.write('hi')
    socket.on('close', function () {
      close.pass('server closed')
    })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    socket.write('hi')
    socket.resume()
    socket.on('end', function () {
      socket.destroy()
    })
    socket.on('close', function () {
      close.pass('client closed')
    })
  })

  await close
  server.close()
})

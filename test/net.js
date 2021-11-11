const test = require('brittle')
const utp = require('../')

test('server + connect', async function (t) {
  const connect = t.test('connect')
  connect.plan(1)

  const server = utp.createServer(function (socket) {
    socket.write('hello mike')
    socket.end()
  })

  server.listen(function () {
    const socket = utp.connect(server.address().port)
    socket
      .on('connect', function () {
        socket.destroy()
        connect.pass('client connected')
      })
      .write('hello joe')
  })

  await connect
  server.close()
})

test('server + connect with resolve', async function (t) {
  const connect = t.test('connect')
  connect.plan(1)

  const server = utp.createServer(function (socket) {
    socket.write('hello mike')
    socket.end()
  })

  server.listen(function () {
    const socket = utp.connect(server.address().port, 'localhost')
    socket
      .on('connect', function () {
        socket.destroy()
        connect.pass('client connected')
      })
      .write('hello joe')
  })

  await connect
  server.close()
})

test('bad resolve', function (t) {
  t.plan(4)

  const socket = utp.connect(10000, 'domain.does-not-exist')
  socket
    .on('connect', function () {
      t.fail('should not connect')
    })
    .on('error', function () {
      t.pass('errored')
    })
    .on('close', function () {
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
    const socket = utp.connect(server.address().port)
    socket
      .on('connect', function () {
        socket.end()
      })
      .on('close', function () {
        t.pass('client closed')
      })
      .write('hi')
  })
})

test.skip('only server sends', function (t) {
  // this is skipped because it doesn't work.
  // utpcat has the same issue so this seems to be a bug
  // in libutp it self
  // in practice this is less of a problem as most protocols
  // exchange a handshake message. would be great to get fixed though
  const server = utp.createServer(function (socket) {
    socket.write('hi')
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
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
    socket
      .on('data', function (data) {
        t.alike(data, Buffer.from('hello'))
      })
      .on('end', function () {
        socket.end()
      })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    socket
      .on('data', function (data) {
        socket.end()
        server.close()
        t.alike(data, Buffer.from('hello'))
      })
      .write('hello')
  })
})

test('echo server back and fourth', function (t) {
  t.plan(12)

  let echoed = 0

  const server = utp.createServer(function (socket) {
    socket.pipe(socket)
    socket.on('data', function (data) {
      echoed++
      t.alike(data, Buffer.from('hello'))
    })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)

    let rounds = 10

    socket
      .on('data', function (data) {
        if (--rounds) return socket.write(data)
        socket.end()
        server.close()
        t.is(echoed, 10)
        t.alike(Buffer.from('hello'), data)
      })
      .write('hello')
  })
})

test('echo big message', function (t) {
  t.plan(2)

  let packets = 0

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

    let ptr = 0

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

  let packets = 0

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

    let ptr = 0

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

  let count = 0
  let gotA = false
  let gotB = false

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

test('emits close', async function (t) {
  const close = t.test('close')
  close.plan(4)

  const server = utp.createServer(function (socket) {
    socket
      .on('end', function () {
        socket.end()
      })
      .on('close', function () {
        close.pass('server closed')
      })
      .resume()
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    socket.write('hi')
    socket.end() // utp does not support half open
    socket
      .on('close', function () {
        close.pass('client closed')
      })
      .resume()
  })

  await close
  server.close()
})

test('flushes', function (t) {
  t.plan(1)

  const sent = []
  const server = utp.createServer(function (socket) {
    const recv = []
    socket
      .on('data', function (data) {
        recv.push(data)
      })
      .on('end', function () {
        server.close()
        socket.end()
        t.alike(Buffer.concat(recv), Buffer.concat(sent))
      })
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    for (let i = 0; i < 50; i++) {
      const data = Buffer.from([0x30 + i])
      socket.write(data)
      sent.push(data)
    }
    socket.end()
  })
})

test('close waits for connections to close', function (t) {
  t.plan(1)

  const sent = []
  const server = utp.createServer(function (socket) {
    const recv = []
    socket
      .on('data', function (data) {
        recv.push(data)
      })
      .on('end', function () {
        socket.end()
        t.alike(Buffer.concat(recv), Buffer.concat(sent))
      })
    server.close()
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    for (let i = 0; i < 50; i++) {
      const data = Buffer.from([0x30 + i])
      socket.write(data)
      sent.push(data)
    }
    socket.end()
  })
})

test('disable half open', function (t) {
  t.plan(3)

  const server = utp.createServer({ allowHalfOpen: false }, function (socket) {
    socket
      .on('data', function (data) {
        t.alike(data, Buffer.from('a'))
      })
      .on('close', function () {
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
    socket
      .on('close', function () {
        close.pass('server closed')
      })
      .resume()
      .write('hi')
  })

  server.listen(0, function () {
    const socket = utp.connect(server.address().port)
    socket
      .on('end', function () {
        socket.destroy()
      })
      .on('close', function () {
        close.pass('client closed')
      })
      .resume()
      .write('hi')
  })

  await close
  server.close()
})

test.skip('exception in connection listener', async function (t) {
  t.plan(1)

  const server = utp.createServer(function (socket) {
    socket.destroy()
    throw new Error('disconnect')
  })

  process.once('uncaughtException', () => {
    server.close()
    t.pass()
  })

  server.listen(0, function () {
    utp.connect(server.address().port).destroy()
  })
})

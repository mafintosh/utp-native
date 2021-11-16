const test = require('brittle')
const utp = require('..')

test('server + connect', (t) => withServer(t, async (server) => {
  const close = t.test('connect and close sockets')
  close.plan(4)

  server.on('connection', (socket) => {
    close.pass('server socket connected')
    socket
      .on('close', () => close.pass('server socket closed'))
      .end()
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    socket
      .on('connect', () => {
        socket.end() // .destroy() hangs?
        close.pass('client socket connected')
      })
      .on('close', () => close.pass('client socket closed'))
  })

  await close
}))

test('server + connect with resolve', (t) => withServer(t, async (server) => {
  const close = t.test('connect and close sockets')
  close.plan(4)

  server.on('connection', (socket) => {
    close.pass('server socket connected')
    socket
      .on('close', () => close.pass('server socket closed'))
      .end()
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port, 'localhost')
    socket
      .on('connect', () => {
        socket.end() // .destroy() hangs?
        close.pass('client socket connected')
      })
      .on('close', () => close.pass('client socket closed'))
  })

  await close
}))

test('emits end and close', (t) => withServer(t, async (server) => {
  const end = t.test('end')
  end.plan(4)

  server.on('connection', (socket) => {
    socket
      .on('end', () => {
        end.pass('server socket ended')
        socket.end()
      })
      .on('close', () => {
        end.pass('server socket closed')
      })
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    socket
      .on('connect', () => socket.end())
      .on('end', () => end.pass('client socket ended'))
      .on('close', () => end.pass('client socket closed'))
  })

  await end
}))

test.skip('client immediately destroys', (t) => withServer(t, async (server) => {
  const close = t.test('close sockets')
  close.plan(2)

  server.on('connection', (socket) => {
    socket.on('close', () => close.pass('server socket closed'))
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    socket
      .on('close', () => close.pass('client socket closed'))
      .write('foo')
    socket.destroy()
  })

  await close
}))

test('server immediately destroys', (t) => withServer(t, async (server) => {
  const close = t.test('close sockets')
  close.plan(2)

  server.on('connection', (socket) => {
    socket
      .on('close', () => close.pass('server socket closed'))
      .destroy()
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    socket
      .on('close', () => close.pass('client socket closed'))
      .on('error', () => { /* UTP_ECONNRESET */ })
      .write('foo')
  })

  await close
}))

test('bad resolve', (t) => {
  t.plan(2)

  const socket = utp.connect(10000, 'domain.does-not-exist')
  socket
    .on('connect', () => t.fail('should not connect'))
    .on('error', () => t.pass('errored'))
    .on('close', () => t.pass('closed'))
})

test('server listens on a port in use', (t) => withServer(t, (a) => withServer(t, async (b) => {
  const error = t.test('error on listen')
  error.plan(1)

  a.listen(() => {
    b
      .on('error', () => error.pass('had error'))
      .listen(a.address().port, () => {
        error.fail('should not be listening')
      })
  })

  await error
})))

test('echo server', (t) => withServer(t, async (server) => {
  const writes = t.test('write and close sockets')
  writes.plan(4)

  server.on('connection', (socket) => {
    socket.pipe(socket)
    socket
      .on('data', (data) => writes.alike(data, Buffer.from('hello')))
      .on('close', () => writes.pass('server socket closed'))
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    socket
      .on('data', (data) => writes.alike(data, Buffer.from('hello')))
      .on('close', () => writes.pass('client socket closed'))
      .end('hello')
  })

  await writes
}))

test('echo server back and fourth', (t) => withServer(t, async (server) => {
  const writes = t.test('write and close sockets')
  writes.plan(22)

  let echoed = 0

  server.on('connection', (socket) => {
    socket
      .on('data', (data) => {
        echoed++
        writes.alike(data, Buffer.from('hello'))
      })
      .on('close', () => writes.pass('server socket closed'))
      .pipe(socket)
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)

    let rounds = 10

    socket
      .on('data', (data) => {
        writes.alike(data, Buffer.from('hello'))
        if (--rounds) socket.write(data)
        else socket.end()
      })
      .on('close', () => writes.pass('client socket closed'))
      .write('hello')
  })

  await writes

  t.is(echoed, 10)
}))

test('echo big message', (t) => withServer(t, async (server) => {
  const writes = t.test('write and close sockets')
  writes.plan(3)

  let packets = 0

  const sending = Buffer.alloc(8 * 1024 * 1024)
  sending.fill('yolo')

  server.on('connection', (socket) => {
    socket
      .on('data', () => packets++)
      .on('close', () => writes.pass('server socket closed'))
      .pipe(socket)
  })

  server.listen(() => {
    const then = Date.now()
    const socket = utp.connect(server.address().port)
    const buffer = Buffer.alloc(sending.length)

    let total = 0

    socket
      .on('data', (data) => {
        packets++
        data.copy(buffer, total)
        total += data.length

        if (sending.length === total) {
          writes.alike(buffer, sending)
          writes.comment('echo took ' + (Date.now() - then) + 'ms (' + packets + ' packets)')
          socket.end()
        }
      })
      .on('close', () => writes.pass('client socket closed'))
      .write(sending)
  })

  await writes
}))

test('echo big message with setContentSize', (t) => withServer(t, async (server) => {
  const writes = t.test('write and close sockets')
  writes.plan(3)

  let packets = 0

  const sending = Buffer.alloc(8 * 1024 * 1024)
  sending.fill('yolo')

  server.on('connection', (socket) => {
    socket.setContentSize(sending.length)
    socket
      .on('data', () => packets++)
      .on('close', () => writes.pass('server socket closed'))
      .pipe(socket)
  })

  server.listen(() => {
    const then = Date.now()
    const socket = utp.connect(server.address().port)
    const buffer = Buffer.alloc(sending.length)

    let total = 0

    socket.setContentSize(sending.length)
    socket
      .on('data', (data) => {
        packets++
        data.copy(buffer, total)
        total += data.length

        if (sending.length === total) {
          writes.alike(buffer, sending)
          writes.comment('echo took ' + (Date.now() - then) + 'ms (' + packets + ' packets)')
          socket.end()
        }
      })
      .on('close', () => writes.pass('client socket closed'))
      .write(sending)
  })

  await writes
}))

test('two connections', (t) => withServer(t, async (server) => {
  const writes = t.test('write and close sockets')
  writes.plan(6)

  server.on('connection', (socket) => {
    socket
      .on('close', () => writes.pass('server socket closed'))
      .pipe(socket)
  })

  server.listen(() => {
    const a = utp.connect(server.address().port)
    const b = utp.connect(server.address().port)

    a
      .on('data', (data) => writes.alike(data, Buffer.from('a')))
      .on('close', () => writes.pass('a closed'))
      .end('a')

    b
      .on('data', (data) => writes.alike(data, Buffer.from('b')))
      .on('close', () => writes.pass('b closed'))
      .end('b')
  })

  await writes
}))

test('flushes', (t) => withServer(t, async (server) => {
  const writes = t.test('writes')
  writes.plan(1)

  const sent = []
  server.on('connection', (socket) => {
    const recv = []
    socket
      .on('data', (data) => recv.push(data))
      .on('end', () => {
        socket.end()
        writes.alike(Buffer.concat(recv), Buffer.concat(sent))
      })
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    for (let i = 0; i < 50; i++) {
      const data = Buffer.from([0x30 + i])
      socket.write(data)
      sent.push(data)
    }
    socket.end()
  })

  await writes
}))

test('close waits for connections to close', (t) => withServer(t, async (server) => {
  const close = t.test('close')
  close.plan(2)

  const sent = []
  server.on('connection', (socket) => {
    const recv = []
    socket
      .on('data', (data) => recv.push(data))
      .on('end', () => {
        socket.end()
        close.alike(Buffer.concat(recv), Buffer.concat(sent))
      })
    server.close(() => close.pass('server closed'))
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    for (let i = 0; i < 50; i++) {
      const data = Buffer.from([0x30 + i])
      socket.write(data)
      sent.push(data)
    }
    socket.end()
  })

  await close
}))

test('disable half open', (t) => {
  t.plan(2)

  const server = utp.createServer({ allowHalfOpen: false }, (socket) => {
    socket
      .on('data', (data) => {
        t.alike(data, Buffer.from('a'))
      })
      .on('close', () => {
        server.close(() => {
          t.pass('everything closed')
        })
      })
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port, '127.0.0.1', { allowHalfOpen: true })

    socket.write('a')
    socket.end()
  })
})

test('timeout', (t) => withServer(t, async (server) => {
  const close = t.test('close')
  close.plan(2)

  server.on('connection', (socket) => {
    socket
      .on('close', () => close.pass('server closed'))
      .setTimeout(100, () => socket.destroy())
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    socket
      .on('end', () => socket.end())
      .on('close', () => close.pass('client closed'))
      .write('hello') // why required?
  })

  await close
}))

test.skip('exception in connection listener', async (t) => {
  t.plan(1)

  const server = utp.createServer((socket) => {
    socket.destroy()
    throw new Error('disconnect')
  })

  process.once('uncaughtException', () => {
    server.close()
    t.pass()
  })

  server.listen(() => {
    utp.connect(server.address().port).destroy()
  })
})

async function withServer (t, cb) {
  const server = utp.createServer()

  try {
    await cb(server)
  } finally {
    const close = t.test('close server')
    close.plan(2)

    close.is(server.connections.length, 0, 'connections closed')

    for (const connection of server.connections) connection.destroy()

    server.close(() => close.pass('server closed'))

    await close
  }
}

const test = require('brittle')
const utp = require('../')

test('server + connect', (t) => withServer(t, async (server) => {
  const close = t.test('connect and close sockets')
  close.plan(2)

  server.on('connection', (socket) => {
    socket.write('hello mike')
    socket
      .on('close', () => close.pass('server socket closed'))
      .destroy() // .end() hangs?
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port)
    socket
      .on('connect', () =>
        socket.destroy() // .end() hangs?
      )
      .on('close', () => close.pass('client socket closed'))
      .write('hello joe')
  })

  await close
}))

test('server + connect with resolve', (t) => withServer(t, async (server) => {
  const close = t.test('connect and close sockets')
  close.plan(2)

  server.on('connection', (socket) => {
    socket.write('hello mike')
    socket
      .on('close', () => close.pass('server socket closed'))
      .destroy() // .end() hangs?
  })

  server.listen(() => {
    const socket = utp.connect(server.address().port, 'localhost')
    socket
      .on('connect', () =>
        socket.destroy() // .end() hangs?
      )
      .on('close', () => close.pass('client socket closed'))
      .write('hello joe')
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

test.skip('server immediate close', (t) => withServer(t, async (server) => {
  const close = t.test('connect and close server')
  close.plan(2)

  server.on('connection', (socket) => {
    socket.write('hi')
    socket.destroy() // .end() does not remove connection?
    server.close(() => close.pass('server closed'))
  })

  server.listen(0, () => {
    const socket = utp.connect(server.address().port)
    socket
      .on('connect', () =>
        socket.destroy() // .end() hangs?
      )
      .on('close', () => close.pass('client closed'))
      .write('hi')
  })

  await close
}))

test('server listens on a port in use', (t) => withServer(t, (a) => withServer(t, async (b) => {
  const error = t.test('error on listen')
  error.plan(1)

  a.listen(0, () => {
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
      .on('end', () => socket.destroy())
      .on('close', () => writes.pass('server socket closed'))
  })

  server.listen(0, () => {
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
  writes.plan(14)

  let echoed = 0

  server.on('connection', (socket) => {
    socket.pipe(socket)
    socket
      .on('data', (data) => {
        echoed++
        writes.alike(data, Buffer.from('hello'))
      })
      .on('close', () => writes.pass('server socket closed'))
  })

  server.listen(0, () => {
    const socket = utp.connect(server.address().port)

    let rounds = 10

    socket
      .on('data', (data) => {
        if (--rounds) return socket.write(data)
        socket.end()
        writes.is(echoed, 10)
        writes.alike(Buffer.from('hello'), data)
      })
      .on('close', () => writes.pass('client socket closed'))
      .write('hello')
  })

  await writes
}))

test('echo big message', (t) => {
  t.plan(2)

  let packets = 0

  const big = Buffer.alloc(8 * 1024 * 1024)
  big.fill('yolo')

  const server = utp.createServer((socket) => {
    socket.on('data', () => packets++)
    socket.pipe(socket)
  })

  server.listen(0, () => {
    const then = Date.now()
    const socket = utp.connect(server.address().port)
    const buffer = Buffer.alloc(big.length)

    let ptr = 0

    socket.write(big)
    socket.on('data', (data) => {
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

test('echo big message with setContentSize', (t) => {
  t.plan(2)

  let packets = 0

  const big = Buffer.alloc(8 * 1024 * 1024)
  big.fill('yolo')

  const server = utp.createServer((socket) => {
    socket.setContentSize(big.length)
    socket.on('data', () => packets++)
    socket.pipe(socket)
  })

  server.listen(0, () => {
    const then = Date.now()
    const socket = utp.connect(server.address().port)
    const buffer = Buffer.alloc(big.length)

    let ptr = 0

    socket.setContentSize(big.length)
    socket.write(big)
    socket.on('data', (data) => {
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

test.skip('two connections', async (t) => {
  const writes = t.test('writes')
  writes.plan(5)

  const server = utp.createServer((socket) => {
    socket.pipe(socket)
  })

  server.listen(0, () => {
    const a = utp.connect(server.address().port)
    const b = utp.connect(server.address().port)

    a.write('a')
    b.write('b')

    a.on('data', (data) => {
      writes.alike(data, Buffer.from('a'))
      a.end()
    })

    b.on('data', (data) => {
      writes.alike(data, Buffer.from('b'))
      b.end()
    })
  })

  await writes.then(() => server.close())
})

test('emits close', (t) => withServer(t, async (server) => {
  const close = t.test('close')
  close.plan(2)

  server.on('connection', (socket) => {
    socket
      .on('end', () => {
        socket.end()
      })
      .on('close', () => {
        close.pass('server closed')
      })
      .resume()
  })

  server.listen(0, () => {
    const socket = utp.connect(server.address().port)
    socket.write('hi')
    socket.end() // utp does not support half open
    socket
      .on('close', () => {
        close.pass('client closed')
      })
      .resume()
  })

  await close
}))

test('flushes', (t) => {
  t.plan(1)

  const sent = []
  const server = utp.createServer((socket) => {
    const recv = []
    socket
      .on('data', (data) => {
        recv.push(data)
      })
      .on('end', () => {
        server.close()
        socket.end()
        t.alike(Buffer.concat(recv), Buffer.concat(sent))
      })
  })

  server.listen(0, () => {
    const socket = utp.connect(server.address().port)
    for (let i = 0; i < 50; i++) {
      const data = Buffer.from([0x30 + i])
      socket.write(data)
      sent.push(data)
    }
    socket.end()
  })
})

test.skip('close waits for connections to close', (t) => withServer(t, async (server) => {
  const close = t.test('close')
  close.plan(2)

  const sent = []
  server.on('connection', (socket) => {
    const recv = []
    socket
      .on('data', (data) => {
        recv.push(data)
      })
      .on('end', () => {
        socket.end()
        t.alike(Buffer.concat(recv), Buffer.concat(sent))
      })
    server.close(() => close.pass('server closed'))
  })

  server.listen(0, () => {
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

  server.listen(0, () => {
    const socket = utp.connect(server.address().port, '127.0.0.1', { allowHalfOpen: true })

    socket.write('a')
    socket.end()
  })
})

test.skip('timeout', (t) => withServer(t, async (server) => {
  const close = t.test('close')
  close.plan(4)

  server.on('connection', (socket) => {
    socket.setTimeout(100, () => {
      t.pass('timed out')
      socket.destroy()
    })
    socket
      .on('close', () => {
        close.pass('server closed')
      })
      .resume()
      .write('hi')
  })

  server.listen(0, () => {
    const socket = utp.connect(server.address().port)
    socket
      .on('end', () => {
        socket.destroy()
      })
      .on('close', () => {
        close.pass('client closed')
      })
      .resume()
      .write('hi')
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

  server.listen(0, () => {
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

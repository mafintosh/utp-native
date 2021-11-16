const test = require('brittle')
const dgram = require('dgram')
const utp = require('../')

test('connection timeout. this may take >20s', (t) => {
  t.plan(1)

  const socket = dgram.createSocket('udp4')
  socket.bind(0, () => {
    const connection = utp.connect(socket.address().port)
    connection.on('error', function (err) {
      socket.close()
      t.is(err.message, 'UTP_ETIMEDOUT')
    })
  })
})

test('write timeout. this may take >20s', (t) => {
  t.plan(3)

  const server = utp.createServer()
  let connection

  server.on('connection', function (socket) {
    t.pass('server received connection')
    server.close()
    socket.destroy()
  })

  server.on('close', () => {
    connection.write('hello?')
  })

  server.listen(() => {
    connection = utp.connect(server.address().port)
    connection.on('connect', () => {
      t.pass('connected to server')
    })
    connection.on('error', function (err) {
      t.is(err.message, 'UTP_ETIMEDOUT')
    })
  })
})

test('server max connections. this may take >20s', (t) => {
  t.plan(4)

  let inc = 0
  const server = utp.createServer({ allowHalfOpen: false }, function (socket) {
    inc++
    t.ok(inc < 3)
    socket.write('hi')
  })

  server.maxConnections = 2
  server.listen(0, () => {
    const a = utp.connect(server.address().port)
    a.write('hi')
    a.on('connect', () => {
      const b = utp.connect(server.address().port)
      b.write('hi')
      b.on('connect', () => {
        const c = utp.connect(server.address().port)
        c.write('hi')
        c.on('connect', () => {
          t.fail('only 2 connections')
        })
        c.on('error', () => {
          a.destroy()
          b.destroy()
          c.destroy()
          server.close()
          t.pass('should error')
        })
      })
    })
  })
})

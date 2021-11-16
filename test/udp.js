const test = require('brittle')
const utp = require('../')

test('bind', (t) => {
  t.plan(4)

  const sock = new utp.Socket()

  sock.bind(() => {
    const { port, address } = sock.address()
    t.is(address, '0.0.0.0')
    t.is(typeof port, 'number')
    t.ok(port > 0 && port < 65536)
    sock.close(() => t.pass())
  })
})

test('bind, close, bind', (t) => {
  t.plan(6)

  const sock = new utp.Socket()

  sock.bind(() => {
    const { port, address } = sock.address()
    t.is(address, '0.0.0.0')
    t.is(typeof port, 'number')
    t.ok(port > 0 && port < 65536)
    sock.close(() => {
      const otherSock = new utp.Socket()

      otherSock.bind(port, () => {
        const addr = otherSock.address()
        t.is(addr.port, port)
        t.is(addr.address, address)
        otherSock.close(() => t.pass())
      })
    })
  })
})

test('bind after error', (t) => {
  t.plan(3)

  const a = new utp.Socket()
  const b = new utp.Socket()

  a.listen(() => {
    b
      .once('error', (err) => {
        t.ok(err, 'should error')
        b.listen(() => {
          t.pass('should still bind')
          a.close(() => b.close(() => t.pass()))
        })
      })
      .listen(a.address().port)
  })
})

test('send message', (t) => {
  t.plan(4)

  const sock = new utp.Socket()

  sock.bind(0, '127.0.0.1', () => {
    const addr = sock.address()

    sock.on('message', (message, rinfo) => {
      t.alike(rinfo, addr)
      t.alike(message, Buffer.from('hello'))
      sock.close(() => t.pass())
    })

    sock.send(Buffer.from('hello'), 0, 5, addr.port, addr.address, (err) => {
      t.absent(err, 'no error')
    })
  })
})

test('send after close', (t) => {
  t.plan(2)

  const sock = new utp.Socket()

  sock.bind(0, '127.0.0.1', () => {
    const { port, address } = sock.address()
    sock.send(Buffer.from('hello'), 0, 5, port, address, (err) => {
      t.absent(err, 'no error')
      sock.close(() => {
        sock.send(Buffer.from('world'), 0, 5, port, address, (err) => {
          t.ok(err, 'should error')
        })
      })
    })
  })
})

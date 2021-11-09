const test = require('brittle')
const utp = require('../')

test('bind', function (t) {
  t.plan(4)

  const sock = new utp.Socket()

  sock.bind(function () {
    const { port, address } = sock.address()
    t.is(address, '0.0.0.0')
    t.is(typeof port, 'number')
    t.ok(port > 0 && port < 65536)
    sock.close(() => t.pass())
  })
})

test('bind, close, bind', function (t) {
  t.plan(6)

  const sock = new utp.Socket()

  sock.bind(function () {
    const { port, address } = sock.address()
    t.is(address, '0.0.0.0')
    t.is(typeof port, 'number')
    t.ok(port > 0 && port < 65536)
    sock.close(function () {
      const otherSock = new utp.Socket()

      otherSock.bind(port, function () {
        const addr = otherSock.address()
        t.is(addr.port, port)
        t.is(addr.address, address)
        otherSock.close(() => t.pass())
      })
    })
  })
})

test('bind after error', function (t) {
  t.plan(3)

  const a = new utp.Socket()
  const b = new utp.Socket()

  a.listen(function () {
    b.once('error', function (err) {
      t.ok(err, 'should error')
      b.listen(function () {
        t.pass('should still bind')
        a.close(() => b.close(() => t.pass()))
      })
    })
    b.listen(a.address().port)
  })
})

test('send message', function (t) {
  t.plan(4)

  const sock = new utp.Socket()

  sock.bind(0, '127.0.0.1', function () {
    const addr = sock.address()

    sock.on('message', function (message, rinfo) {
      t.alike(rinfo, addr)
      t.alike(message, Buffer.from('hello'))
      sock.close(() => t.pass())
    })

    sock.send(Buffer.from('hello'), 0, 5, addr.port, addr.address, function (err) {
      t.absent(err, 'no error')
    })
  })
})

test('send after close', function (t) {
  t.plan(2)

  const sock = new utp.Socket()

  sock.bind(0, '127.0.0.1', function () {
    const { port, address } = sock.address()
    sock.send(Buffer.from('hello'), 0, 5, port, address, function (err) {
      t.absent(err, 'no error')
      sock.close(function () {
        sock.send(Buffer.from('world'), 0, 5, port, address, function (err) {
          t.ok(err, 'should error')
        })
      })
    })
  })
})

const tape = require('tape')
const utp = require('../')

tape('bind', function (t) {
  const sock = utp()

  sock.bind(function () {
    const { port, address } = sock.address()
    t.same(address, '0.0.0.0')
    t.same(typeof port, 'number')
    t.ok(port > 0 && port < 65536)
    sock.close(() => t.end())
  })
})

tape('bind, close, bind', function (t) {
  const sock = utp()

  sock.bind(function () {
    const { port, address } = sock.address()
    t.same(address, '0.0.0.0')
    t.same(typeof port, 'number')
    t.ok(port > 0 && port < 65536)
    sock.close(function () {
      const otherSock = utp()

      otherSock.bind(port, function () {
        const addr = otherSock.address()
        t.same(addr.port, port)
        t.same(addr.address, address)
        otherSock.close(() => t.end())
      })
    })
  })
})

tape('send message', function (t) {
  const sock = utp()

  sock.bind(0, '127.0.0.1', function () {
    const addr = sock.address()

    sock.on('message', function (message, rinfo) {
      t.same(rinfo, addr)
      t.same(message, Buffer.from('hello'))
      sock.close(() => t.end())
    })

    sock.send(Buffer.from('hello'), 0, 5, addr.port, addr.address, function (err) {
      t.error(err, 'no error')
    })
  })
})

var tape = require('tape')
var utp = require('../../index.js')

tape('net-api connection', function (t) {
  t.test('connect', function (t) {
    var connected = false

    var server = utp.createServer(function () {
      connected = true
    })

    server.listen(0, function () {
      var socket = utp.connect(server.address().port)

      socket.on('connect', function () {
        t.ok(connected, 'connected successfully')
        t.end()
      })
    })
  })

  t.test('connect deferred', function (t) {
    var connected = false

    setTimeout(function () {
      utp.createServer(function () {
        connected = true
      }).listen(55500)
    }, 100)

    var socket = utp.connect(55500)
    socket.on('connect', function () {
      t.ok(connected, 'connected successfully')
      t.end()
    })
  })

  t.test('close', function (t) {
    var server = utp.createServer(function (socket) {
      socket.resume()
      socket.end()
      server.close(function () {
        t.pass('closed')
        t.end()
      })
    })

    server.listen(0, function () {
      var socket = utp.connect(server.address().port)

      socket.once('connect', function () {
        socket.end()
      })
    })
  })

  t.skip('on close', function (t) {
    var closed = 0

    var onclose = function () {
      closed++
      if (closed === 2) {
        t.end()
      }
    }
    var server = utp.createServer(function (socket) {
      socket.resume()
      socket.on('end', function () {
        socket.end()
      })
      socket.on('close', onclose)
    })

    server.listen(0, function () {
      var socket = utp.connect(server.address().port)

      socket.resume()
      socket.on('close', onclose)
      socket.on('error', function (err) {
        // TODO fix: ending from the server side is causing a ECONNRESET to be
        // thrown on the client
        console.log(err)
      })
      socket.end()
    })
  })

  t.skip('end', function (t) {
    var ended = false

    var server = utp.createServer(function (socket) {
      socket.resume()
      socket.on('end', function () {
        ended = true
        socket.end()
      })
    })

    server.listen(0, function () {
      var socket = utp.connect(server.address().port)

      socket.resume()
      socket.on('end', function () {
        // TODO fix: socket is ending before the server sock actually call .end()
        // this would require half open sockets
        // https://github.com/diasdavid/utp-native/commit/f2f92e4be3dd687a5dc95e74d5943c40f5632a95#commitcomment-15882309
        t.ok(ended)
        t.end()
      })

      socket.end()
    })
  })
})

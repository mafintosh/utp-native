var tape = require('tape')
var dgram = require('dgram')
var utp = require('../../')

tape('net-api timeouts', function (t) {
  t.test('connection timeout. this may take >20s', function (t) {
    var socket = dgram.createSocket('udp4')
    socket.bind(0, function () {
      var connection = utp.connect(socket.address().port)
      connection.on('error', function (err) {
        socket.close()
        t.same(err.message, 'UTP_ETIMEDOUT')
        t.end()
      })
    })
  })

  t.test('write timeout. this may take >20s', function (t) {
    var server = utp.createServer()
    var connection

    server.on('connection', function (socket) {
      t.pass('server received connection')
      server.close()
      socket.destroy()
    })

    server.on('close', function () {
      connection.write('hello?')
    })

    server.listen(function () {
      connection = utp.connect(server.address().port)
      connection.on('connect', function () {
        t.pass('connected to server')
      })
      connection.on('error', function (err) {
        t.same(err.message, 'UTP_ETIMEDOUT')
        t.end()
      })
    })
  })
})


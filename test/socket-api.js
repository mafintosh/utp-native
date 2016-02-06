var tape = require('tape')
var dgram = require('dgram')
var utp = require('../')

tape('dgram-like socket', function (t) {
  var socket = utp()

  socket.on('message', function (buf, rinfo) {
    t.same(rinfo.port, socket.address().port)
    t.same(rinfo.address, '127.0.0.1')
    t.same(buf, Buffer('hello'))
    socket.close()
    t.end()
  })

  socket.bind(function () {
    socket.send(Buffer('hello'), 0, 5, socket.address().port)
  })
})

tape('echo socket', function (t) {
  var socket = utp()

  socket.on('message', function (buf, rinfo) {
    socket.send(buf, 0, buf.length, rinfo.port, rinfo.address)
  })

  socket.bind(function () {
    var other = dgram.createSocket('udp4')
    other.on('message', function (buf, rinfo) {
      t.same(rinfo.port, socket.address().port)
      t.same(rinfo.address, '127.0.0.1')
      t.same(buf, Buffer('hello'))
      socket.close()
      other.close()
      t.end()
    })
    other.send(Buffer('hello'), 0, 5, socket.address().port)
  })
})

tape('echo socket with resolve', function (t) {
  var socket = utp()

  socket.on('message', function (buf, rinfo) {
    socket.send(buf, 0, buf.length, rinfo.port, 'localhost')
  })

  socket.bind(function () {
    var other = dgram.createSocket('udp4')
    other.on('message', function (buf, rinfo) {
      t.same(rinfo.port, socket.address().port)
      t.same(rinfo.address, '127.0.0.1')
      t.same(buf, Buffer('hello'))
      socket.close()
      other.close()
      t.end()
    })
    other.send(Buffer('hello'), 0, 5, socket.address().port)
  })
})

tape('combine server and connection', function (t) {
  var socket = utp()
  var gotClient = false

  socket.on('connection', function (client) {
    gotClient = true
    client.pipe(client)
  })

  socket.listen(function () {
    var client = socket.connect(socket.address().port)
    client.write('hi')
    client.on('data', function (data) {
      socket.close()
      client.destroy()
      t.same(data, Buffer('hi'))
      t.ok(gotClient)
      t.end()
    })
  })
})

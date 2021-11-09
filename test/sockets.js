const test = require('brittle')
const dgram = require('dgram')
const utp = require('../')

test('dgram-like socket', function (t) {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('message', function (buf, rinfo) {
    t.is(rinfo.port, socket.address().port)
    t.is(rinfo.address, '127.0.0.1')
    t.alike(buf, Buffer.from('hello'))
    socket.close()
  })

  socket.bind(function () {
    socket.send(Buffer.from('hello'), 0, 5, socket.address().port, '127.0.0.1')
  })
})

test('double close', function (t) {
  t.plan(1)

  const socket = new utp.Socket()

  socket.on('close', function () {
    socket.close(function () {
      t.pass('closed twice')
    })
  })

  socket.bind(0, function () {
    socket.close()
  })
})

test('echo socket', function (t) {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('message', function (buf, rinfo) {
    socket.send(buf, 0, buf.length, rinfo.port, rinfo.address)
  })

  socket.bind(function () {
    var other = dgram.createSocket('udp4')
    other.on('message', function (buf, rinfo) {
      t.is(rinfo.port, socket.address().port)
      t.is(rinfo.address, '127.0.0.1')
      t.alike(buf, Buffer.from('hello'))
      socket.close()
      other.close()
    })
    other.send(Buffer.from('hello'), 0, 5, socket.address().port, '127.0.0.1')
  })
})

test('echo socket with resolve', function (t) {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('message', function (buf, rinfo) {
    socket.send(buf, 0, buf.length, rinfo.port, 'localhost')
  })

  socket.bind(function () {
    const other = dgram.createSocket('udp4')
    other.on('message', function (buf, rinfo) {
      t.is(rinfo.port, socket.address().port)
      t.is(rinfo.address, '127.0.0.1')
      t.alike(buf, Buffer.from('hello'))
      socket.close()
      other.close()
    })
    other.send(Buffer.from('hello'), 0, 5, socket.address().port, '127.0.0.1')
  })
})

test('combine server and connection', function (t) {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('connection', function (client) {
    t.is(client.remotePort, socket.address().port)
    t.is(client.remoteAddress, '127.0.0.1')
    client.pipe(client)
  })

  socket.listen(function () {
    var client = socket.connect(socket.address().port)
    client.write('hi')
    client.on('data', function (data) {
      client.end()
      socket.close()
      t.alike(data, Buffer.from('hi'))
    })
  })
})

test('both ends write first', async function (t) {
  const close = t.test('close')
  close.plan(2)

  const socket = new utp.Socket()

  socket.on('connection', function (connection) {
    connection.write('a')
    connection.on('data', function (data) {
      close.alike(data, Buffer.from('b'))
      connection.end()
    })
  })

  socket.listen(0, function () {
    var connection = socket.connect(socket.address().port)
    connection.write('b')
    connection.on('data', function (data) {
      close.alike(data, Buffer.from('a'))
      connection.end()
    })
  })

  await close
  socket.close()
})

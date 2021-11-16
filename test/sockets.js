const test = require('brittle')
const dgram = require('dgram')
const utp = require('../')

test('dgram-like socket', (t) => {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('message', function (buf, rinfo) {
    t.is(rinfo.port, socket.address().port)
    t.is(rinfo.address, '127.0.0.1')
    t.alike(buf, Buffer.from('hello'))
    socket.close()
  })

  socket.bind(() => {
    socket.send(Buffer.from('hello'), 0, 5, socket.address().port, '127.0.0.1')
  })
})

test('double close', (t) => {
  t.plan(1)

  const socket = new utp.Socket()

  socket.on('close', () => {
    socket.close(() => {
      t.pass('closed twice')
    })
  })

  socket.bind(0, () => {
    socket.close()
  })
})

test('echo socket', (t) => {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('message', function (buf, rinfo) {
    socket.send(buf, 0, buf.length, rinfo.port, rinfo.address)
  })

  socket.bind(() => {
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

test('echo socket with resolve', (t) => {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('message', function (buf, rinfo) {
    socket.send(buf, 0, buf.length, rinfo.port, 'localhost')
  })

  socket.bind(() => {
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

test('combine server and connection', (t) => {
  t.plan(3)

  const socket = new utp.Socket()

  socket.on('connection', function (client) {
    t.is(client.remotePort, socket.address().port)
    t.is(client.remoteAddress, '127.0.0.1')
    client.pipe(client)
  })

  socket.listen(() => {
    const client = socket.connect(socket.address().port)
    client.write('hi')
    client.on('data', function (data) {
      client.end()
      socket.close()
      t.alike(data, Buffer.from('hi'))
    })
  })
})

test.skip('both ends write first', async (t) => {
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

  socket.listen(0, () => {
    const connection = socket.connect(socket.address().port)
    connection.write('b')
    connection.on('data', function (data) {
      close.alike(data, Buffer.from('a'))
      connection.end()
    })
  })

  await close
  socket.close()
})

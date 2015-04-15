var utpSocket = require('./')

var socket = utpSocket()

socket.handlers({
  onconnect: function () {
    console.log('[js] we are connected!')
    var b = new Buffer('I am client!\n')
    socket.write(b, b.length)
    process.stdin.on('data', function (data) {
      socket.write(data, data.length)
    })
  },
  onread: function (data, length) {
    process.stdout.write('[js] remote: ' + data.toString('utf-8', 0, length))
  },
  oneof: function () {
    console.log('[js] eof received')
  },
  ondestroying: function () {
    console.log('[js] destroying')
  },
  onsocket: function (sock) {
    console.log('[js] new socket!')

    sock.handlers({
      onconnect: function () {
        console.log('[js] we are connected!')
      },
      onread: function (data, length) {
        process.stdout.write('[js] remote: ' + data.toString('utf-8', 0, length))
      },
      oneof: function () {
        console.log('[js] eof received')
      },
      ondestroying: function () {
        console.log('[js] destroying')
      },
      onsocket: function () {
        console.log('[js] SHOULD NOT HAPPEN')
      }
    })

    var b = new Buffer('I am server!\n')
    sock.write(b, b.length)

    process.stdin.on('data', function (data) {
      sock.write(data, data.length)
    })
  }
})

if (process.argv[2] === 'listen') {
  socket.listen(process.argv[3] || '10000')
} else {
  socket.connect(process.argv[2] || '10000', process.argv[3] || '127.0.0.1')
}

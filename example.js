var utp = require('./')

if (process.argv[2] === 'listen') {
  var server = utp.createServer()

  server.on('connection', function (socket) {
    process.stdout.pipe(socket).pipe(process.stdout)
  })

  server.listen(process.argv[3] || 10000)
} else {
  var socket = utp.connect(process.argv[3] || 10000, process.argv[4])
  process.stdin.pipe(socket).pipe(process.stdout)
}
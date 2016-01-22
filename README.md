# utp-native

Native bindings for libutp.

```
npm install utp-native
```

## Usage

``` js
var utp = require('utp-native')

var server = utp.createServer(function (socket) {
  socket.pipe(socket) // echo server
})

server.listen(10000, function () {
  var socket = utp.connect(10000)

  socket.write('hello world')
  socket.on('data', function (data) {
    console.log('echo: ' + data)
  })
})
```

## API

The main goal of the API is to mirror the net core module in Node as much as possible so this can act as a drop in replacement.

#### `server = utp.createServer([onconnection])`

Create a new utp server instance.

#### `server.listen([port], [address], [onlistening])`

Listen for on port. If you don't provide a port or pass in `0` a free port will be used. Optionally you can provide an interface address as well, defaults to `0.0.0.0`.

#### `var addr = server.address()`

Returns an address object, `{port, address}` that tell you which port / address this server is bound to.

#### `server.on('listening')`

Emitted when the server is listening

#### `server.on('connection', connection)`

Emitted when a client has connected to this server

#### `server.on('error', err)`

Emitted when a critical error happened

#### `connection = utp.connect(port, [host])`

Create a new client connection. host defaults to localhost.
The client connection is a duplex stream that you can write / read from.

## Known Issues

* Currently readable backpressure is not implemented
* Needs timeouts
* Needs tests
* Windows support is untested

## License

MIT

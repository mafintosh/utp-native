# utp-native

Native bindings for libutp. For more information about utp read [BEP 29](http://www.bittorrent.org/beps/bep_0029.html).

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

There two APIs available. One that mimicks the net core module in Node as much as possible and another one that allows you to reuse the same udp socket for both the client and server. The last one is useful if you plan on using this in combination with NAT hole punching.

## [net](http://nodejs.org/api/net.html)-like API

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

#### `server.close()`

Closes the server.

#### `server.on('close')`

Emitted when the server is fully closed. Note that this will only happen after all connections to the server are closed.

#### `server.connections`

An array of all the connections the server has.

#### `server.ref()`

Opposite of unref.

#### `server.unref()`

Unreferences the server from the node event loop.

#### `connection = utp.connect(port, [host])`

Create a new client connection. host defaults to localhost.
The client connection is a duplex stream that you can write / read from.

#### `address = connection.address()`

Similar to `server.address`.

#### `connection.ref()`

Similar to `server.ref()`

#### `connection.unref()`

Similar to `server.unref()`

#### `connection.on('close')`

Emitted when the connection is fully closed.

#### `connection.on('error', err)`

Emitted if an unexpected error happens.

#### `connection.destroy()`

Forcefully destroys the connection.

In addition to this the connection has all the classic stream methods such as `.write` etc.

## Socket API

The socket api allows you to reuse the same underlying UDP socket to both connect to other clients on accept incoming connections. It also mimicks the node core [dgram socket](https://nodejs.org/api/dgram.html#dgram_class_dgram_socket) api.

#### `socket = utp()`

#### `socket.bind([port], [host], [onlistening])`

#### `socket.on('listening')`

#### `socket.send(buf, offset, len, port, host, [callback])`

#### `socket.on('message', buffer, rinfo)`

#### `socket.close()`

#### `socket.on('close')`

#### `socket.on('error')`

#### `socket.listen()`

#### `address = connection.address()`

#### `connection = socket.connect(port, host)`

#### `socket.on('connection', connection)`

#### `socket.ref()`

#### `socket.unref()`

## License

MIT

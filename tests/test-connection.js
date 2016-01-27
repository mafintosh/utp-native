/* globals describe, it */

var utp = require('../')
var expect = require('chai').expect

describe('connection', function () {
  it('start server', function (done) {
    utp.createServer(function () {
    }).listen(53405, function () {
      done()
    })
  })

  it('start server with port as string should throw', function (done) {
    var server = utp.createServer(function () {
    })
    try {
      server.listen('53305', function () {})
    } catch (err) {
      expect(err).to.exist
      done()
    }
  })

  it('connect', function (done) {
    var connected = false

    utp.createServer(function () {
      connected = true
    }).listen(53410)

    var socket = utp.connect(53410)
    socket.on('connect', function () {
      expect(connected).to.equal(true)
      done()
    })
  })

  it('connect deferred', function (done) {
    var connected = false

    setTimeout(function () {
      utp.createServer(function () {
        connected = true
      }).listen(53400)
    }, 100)

    var socket = utp.connect(53400)
    socket.on('connect', function () {
      expect(connected).to.equal(true)
      done()
    })
  })

  it('close', function (done) {
    var onclose = function () {
      done()
    }

    var server = utp.createServer(function (socket) {
      socket.resume()
      socket.end()
      server.close(onclose)
    })

    server.listen(53454, function () {
      var socket = utp.connect(53454)

      socket.once('connect', function () {
        socket.end()
      })
    })
  })

  it('on close', function (done) {
    var closed = 0
    var onclose = function () {
      closed++
      if (closed === 2) {
        done()
      }
    }

    utp.createServer(function (socket) {
      socket.resume()
      socket.on('end', function () {
        socket.end()
      })
      socket.on('close', onclose)
    }).listen(53455)

    var socket = utp.connect(53455)

    socket.resume()
    socket.on('close', onclose)
    socket.end()
  })

  it('end', function (done) {
    var ended = false

    utp.createServer(function (socket) {
      socket.resume()
      socket.on('end', function () {
        ended = true
        socket.end()
      })
    }).listen(53454)

    var socket = utp.connect(53454)

    socket.resume()
    socket.on('end', function () {
      expect(ended).to.equal(true)
      done()
    })
    socket.end()
  })
})

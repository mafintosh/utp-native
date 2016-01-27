/* globals describe, it */

var utp = require('../')
var expect = require('chai').expect

describe('write', function () {
  it('simple', function (done) {
    utp.createServer(function (socket) {
      socket.on('data', function (data) {
        expect(data.toString()).to.equal('client')
        socket.write('server')
      })
    }).listen(53500)

    var socket = utp.connect(53500)
    socket.write('client')
    socket.on('data', function (data) {
      expect(data.toString()).to.equal('server')
      done()
    })
  })

  it('big', function (done) {
    this.timeout(5000)
    var big = new Buffer(100 * 1024)
    big.fill(1)

    utp.createServer(function (socket) {
      socket.on('data', function (data) {
        socket.write(data)
      })
      socket.on('end', function () {
        socket.end()
      })
    }).listen(53510)

    var socket = utp.connect(53510)
    var recv = 0

    socket.write(big)
    socket.end()

    socket.on('data', function (data) {
      recv += data.length
    })
    socket.on('end', function () {
      expect(recv).to.equal(big.length)
      done()
    })
  })

  it('end', function (done) {
    var ended = false
    var dataed = false

    utp.createServer(function (socket) {
      socket.on('data', function (data) {
        expect(data.toString()).to.equal('client')
        socket.write('server')
      })
      socket.on('end', function () {
        ended = true
        socket.end()
      })
    }).listen(53520)

    var socket = utp.connect(53520)

    socket.on('data', function (data) {
      expect(data.toString()).to.equal('server')
      dataed = true
    })
    socket.on('end', function () {
      expect(ended).to.equal(true)
      expect(dataed).to.equal(true)
      done()
    })
    socket.write('client')
    socket.end()
  })

  it('sequence', function (done) {
    this.timeout(50000)
    var max = 100

    utp.createServer(function (socket) {
      var prev = 0
      socket.on('data', function (data) {
        expect('' + prev).to.equal(data.toString())
        prev++
        socket.write(data)
        if (prev === max) socket.end()
      })
    }).listen(53630)

    var socket = utp.connect(53630)
    var prev = 0

    for (var i = 0; i < max; i++) {
      socket.write('' + i)
    }

    socket.on('data', function (data) {
      expect('' + (prev++)).to.equal(data.toString())
    })
    socket.on('end', function () {
      done()
    })
  })
})

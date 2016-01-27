/* globals describe, it */

var utp = require('../')
var expect = require('chai').expect
var nexpect = require('nexpect')

var ucat = 'ucat-static'

describe('interop - listener', function () {
  it('incoming connection and close', function (done) {
    this.timeout(5000)
    utp.createServer(function (socket) {
      socket.end()
    }).listen(5500)

    nexpect.spawn(ucat, ['127.0.0.1', '5500'])
     .run(function (err, output, exitcode) {
       expect(err).to.not.exist
       expect(exitcode).to.equal(0)
       done()
     })
  })

  it('send small amount of data', function (done) {
    this.timeout(5000)
    utp.createServer(function (socket) {
      socket.on('data', function (data) {
        expect(data.toString()).to.equal('ucat-static dialer')
      })
      socket.write('node-utp listener')
      socket.end()
    }).listen(5501)

    var proc = nexpect.spawn(ucat, ['127.0.0.1', '5501'])
     .run(function (err, output, exitcode) {
       expect(err).to.not.exist
       expect(exitcode).to.equal(0)
       done()
     })

    proc.stdin.write('ucat-static dialer')

    proc.stdout.on('data', function (data) {
      expect(data.toString()).to.equal('node-utp listener')
    })
  })

  it('send big amount of data', function (done) {
    this.timeout(5000)
    var big = new Buffer(1000 * 1024)
    big.fill(1)
    var recv = 0

    utp.createServer(function (socket) {
      socket.write(big)
      socket.end()
    }).listen(5502)

    var proc = nexpect.spawn(ucat, ['127.0.0.1', '5502'])
     .run(function (err, output, exitcode) {
       expect(err).to.not.exist
       expect(exitcode).to.equal(0)
     })

    proc.stdout.on('data', function (data) {
      recv += data.length
    })

    proc.stdout.on('end', function (data) {
      expect(recv).to.equal(big.length)
      done()
    })
  })
})

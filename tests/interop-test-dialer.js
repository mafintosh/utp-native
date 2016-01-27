/* globals describe, it */

var utp = require('../')
var expect = require('chai').expect
var nexpect = require('nexpect')

var ucat = 'ucat-static'

describe('interop - dialer', function () {
  // Making sure that setup was done
  it('help menu', function (done) {
    nexpect.spawn(ucat, ['-h'], { stream: 'stderr' })
     .run(function (err, output, exitcode) {
       // ucat-static exists with exit code 1 when prints help menu
       // and prints the output to stderr
       var help = [
         'Usage:',
         '    ucat-static [options] <destination-IP> <destination-port>',
         '    ucat-static [options] -l -p <listening-port>',
         'Options:',
         '    -h          Help',
         '    -d          Debug mode; use multiple times to increase verbosity.',
         '    -l          Listen mode',
         '    -p <port>   Local port',
         '    -s <IP>     Source IP',
         '    -B <size>   Buffer size',
         '    -n          Don\'t resolve hostnames']
       expect(help).to.deep.equal(output)
       expect(exitcode).to.equal(1)
       expect(err).to.not.exist
       done()
     })
  })

  it('dial connection and close', function (done) {
    // proc is a standard require('child_process').spawn obj
    // with stdio, stdout and stderr streams
    var proc = nexpect.spawn(ucat, ['-l', '-p 5430'])
     .run(function (err, output, exitcode) {
       expect(err).to.not.exist
       expect(exitcode).to.equal(1)
     })

    var socket = utp.connect(5430)
    socket.once('connect', function () {
      socket.end()
      process.kill(proc.pid)
      done()
    })
  })

  it('send small amount of data', function (done) {
    var proc = nexpect.spawn(ucat, ['-l', '-p 5431'])
     .run(function (err, output, exitcode) {
       expect(err).to.not.exist
       expect(exitcode).to.equal(1)
     })

    var socket = utp.connect(5431)
    socket.once('connect', function () {
      proc.stdout.on('data', function (data) {
        expect(data.toString()).to.equal('node-utp dialer')
        proc.stdin.write('ucat-static listener')
      })

      socket.write('node-utp dialer')

      socket.on('data', function (data) {
        expect(data.toString()).to.equal('ucat-static listener')
        socket.end()
        process.kill(proc.pid)
        done()
      })
    })
  })

  it('send 1MB of data', function (done) {
    this.timeout(5000)
    var big = new Buffer(1000 * 1024)
    big.fill(1)
    var recv = 0

    var proc = nexpect.spawn(ucat, ['-l', '-p 5432'])
     .run(function (err, output, exitcode) {
       expect(err).to.not.exist
       expect(exitcode).to.equal(1)
     })

    proc.stdout.on('data', function (data) {
      recv += data.length
      if (recv === big.length) {
        process.kill(proc.pid)
        done()
      }
    })

    var socket = utp.connect(5432)
    socket.write(big)
  })
})

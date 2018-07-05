var timeout = setTimeout(noop, 1000)

if (timeout.refresh) {
  exports.enroll = function (inst, ms) {
    if (inst._timeout) exports.unenroll(inst)
    inst._timeout = setTimeout(ontimeout, ms, inst)
    inst._timeout.unref()
  }
  exports.unenroll = function (inst) {
    if (!inst._timeout) return
    clearTimeout(inst._timeout)
    inst._timeout = null
  }
  exports.active = function (inst) {
    if (inst._timeout) inst._timeout.refresh()
  }
} else {
  var timers = require('timers')
  exports.enroll = timers.enroll || noop
  exports.active = timers._unrefActive || timers.active || noop
  exports.unenroll = timers.unenroll || noop
}

clearTimeout(timeout)

function ontimeout (inst) {
  inst._timeout = null
  inst.emit('timeout')
}

function noop () {}

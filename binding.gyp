{
  'targets': [
    {
      'target_name': 'utp',
      'dependencies': [
        'deps/libutp.gyp:libutp',
      ],
      'include_dirs' : [
        "<!(node -e \"require('nan')\")",
        'deps/libutp',
      ],
      'sources': [
        'src/utp_uv.cc',
        'src/socket_wrap.cc',
        'src/utp_wrap.cc',
        'binding.cc',
      ],
      'conditions': [
        ['OS=="win"', {
          "libraries": ["ws2_32.lib"],
        }],
      ],
      'xcode_settings': {
        'OTHER_CFLAGS': [
          '-O3',
        ]
      },
      'cflags': [
        '-O3',
      ],
    }
  ]
}

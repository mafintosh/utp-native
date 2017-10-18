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
      'xcode_settings': {
        'OTHER_CFLAGS': [
          '-O3',
        ]
      },
      'cflags': [
        '-O3',
      ],
      'conditions': [
        ['OS=="win"', {
          'link_settings': {
            'libraries': [
              '-lws2_32.lib'
            ]
          }
        }]
      ],      
    }
  ]
}

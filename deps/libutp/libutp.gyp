{
  'variables': {
    'libutp_target_type%': 'static_library',
  },
  'target_defaults': {
    'defines': [
      'POSIX',
      'UTP_DEBUG_LOGGING'
    ],
  },
  'targets': [
    {
      'target_name': 'libutp',
      'type': 'static_library',
      'sources': [
        'utp_internal.cpp',
        'utp_utils.cpp',
        'utp_hash.cpp',
        'utp_callbacks.cpp',
        'utp_api.cpp',
        'utp_packedsockaddr.cpp',
      ],
      'conditions': [
        ['OS=="mac"', {
          'xcode_settings': {
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++98',
          },
        }],
      ],
    },
  ],
}

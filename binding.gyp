{
  'targets': [
    {
      'target_name': 'utp',
      'dependencies': [
        '<(module_root_dir)/deps/libutp/libutp.gyp:libutp',
      ],
      'include_dirs' : [
        "<!(node -e \"require('nan')\")",
        '<(module_root_dir)/deps/libutp',
      ],
      'sources': [
        'src/utp_uv.cc',
        'src/socket_wrap.cc',
        'src/utp_wrap.cc',
        'binding.cc',
      ],
   }
  ]
}

{
  'targets': [
    {
      'target_name': 'utp',
      'sources': [
        'src/utp_uv.cc',
        'src/socket_wrap.cc',
        'src/utp_wrap.cc',
        'binding.cc',
      ],
      "libraries": [
        "<!(node -e \"process.stdout.write(require('fs').realpathSync('deps/libutp/libutp.a'))\")",
      ],
      'include_dirs' : [
        "<!(node -e \"require('nan')\")",
      ],
   }
  ]
}

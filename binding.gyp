{
  'targets': [
    {
      'target_name': 'utp',
      'sources': [
        'src/utp.cc',
        'src/socket.cc',
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
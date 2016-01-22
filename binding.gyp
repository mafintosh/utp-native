{
  'targets': [
    {
      'target_name': 'utp',
      'sources': [
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

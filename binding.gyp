{
  "targets": [
    {
      "target_name": "node_fs_meta",
      "sources": [
        "src/binding.cpp",
        "src/windows/fs_meta.cpp",
        "src/linux/fs_meta.cpp",
        "src/darwin/fs_meta.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='linux'", {
          "sources!": [
            "src/windows/fs_meta.cpp",
            "src/darwin/fs_meta.cpp"
          ],
          "libraries": [
            "-lblkid"
          ],
          "cflags": [
            "-fPIC"
          ],
          "cflags_cc": [
            "-fexceptions",
            "-fPIC"
          ]
        }],
        ["OS=='win'", {
          "sources!": [
            "src/linux/fs_meta.cpp",
            "src/darwin/fs_meta.cpp"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          }
        }],
        ["OS=='mac'", {
          "sources!": [
            "src/windows/fs_meta.cpp",
            "src/linux/fs_meta.cpp"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }]
      ]
    }
  ]
}
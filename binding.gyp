{
  "variables": {
    "enable_gio%": "false"
  },
  "targets": [
    {
      "target_name": "node_fs_meta",
      "sources": [
        "src/binding.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS=='linux'",
          {
            "sources": [
              "src/linux/blkid_cache.cpp",
              "src/linux/fs_meta.cpp"
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
            ],
            "conditions": [
              [
                "enable_gio=='true'",
                {
                  "sources": [
                    "src/linux/gio_utils.cpp",
                    "src/linux/gio_worker.cpp"
                  ],
                  "defines": [
                    "ENABLE_GIO=1"
                  ],
                  "libraries": [
                    "<!@(pkg-config --libs gio-2.0)"
                  ],
                  "cflags": [
                    "<!@(pkg-config --cflags gio-2.0)"
                  ]
                }
              ]
            ]
          }
        ],
        [
          "OS=='win'",
          {
            "sources": [
              "src/windows/fs_meta.cpp"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "RuntimeTypeInfo": "true"
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "sources": [
              "src/darwin/fs_meta.cpp"
            ],
            "link_settings": {
              "libraries": [
                "DiskArbitration.framework",
                "Foundation.framework",
                "IOKit.framework"
              ]
            }
          }
        ]
      ]
    }
  ]
}

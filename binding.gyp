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
        "NAPI_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS=='linux'",
          {
            "sources": [
              "src/linux/blkid_cache.cpp",
              "src/linux/volume_metadata.cpp"
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
              "src/windows/volume_mount_points.cpp",
              "src/windows/volume_metadata.cpp",
              "src/windows/hidden_attr.cpp"
            ],
            "libraries": [
              "-lMpr.lib"
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
              "src/darwin/volume_mount_points.cpp",
              "src/darwin/volume_metadata.cpp"
            ],
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            },
            "cflags": [
              "-fexceptions",
              "-fPIC"
            ],
            "cflags_cc": [
              "-fexceptions"
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

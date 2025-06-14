{
  "variables": {
    "enable_gio%": "false"
  },
  "targets": [
    {
      "target_name": "fs_metadata",
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
        "NAPI_CPP_EXCEPTIONS",
        "NAPI_VERSION=9"
      ],
      "configurations": {
        "Debug": {
          "defines": [
            "DEBUG",
            "_DEBUG"
          ]
        }
      },
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
                    "src/linux/gio_mount_points.cpp",
                    "src/linux/gio_volume_metadata.cpp"
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
              "src/windows/hidden.cpp"
            ],
            "libraries": [
              "-lMpr.lib",
              "-lPathcch.lib"
            ],
            "conditions": [
              [
                "target_arch=='x64'",
                {
                  "defines": [
                    "_M_X64",
                    "_WIN64"
                  ],
                  "msvs_settings": {
                    "VCCLCompilerTool": {
                      "AdditionalOptions": [
                        "/Qspectre",
                        "/guard:cf",
                        "/ZH:SHA_256",
                        "/sdl"
                      ],
                      "ExceptionHandling": 1,
                      "RuntimeTypeInfo": "true"
                    },
                    "VCLinkerTool": {
                      "AdditionalOptions": [
                        "/guard:cf",
                        "/DYNAMICBASE",
                        "/CETCOMPAT"
                      ]
                    }
                  }
                }
              ],
              [
                "target_arch=='arm64'",
                {
                  "defines": [
                    "_M_ARM64",
                    "_WIN64"
                  ],
                  "msvs_settings": {
                    "VCCLCompilerTool": {
                      "AdditionalOptions": [
                        "/guard:cf",
                        "/ZH:SHA_256",
                        "/sdl"
                      ],
                      "ExceptionHandling": 1,
                      "RuntimeTypeInfo": "true"
                    },
                    "VCLinkerTool": {
                      "AdditionalOptions": [
                        "/guard:cf",
                        "/DYNAMICBASE"
                      ]
                    }
                  }
                }
              ],
              [
                "target_arch=='ia32'",
                {
                  "defines": [
                    "_M_IX86"
                  ],
                  "msvs_settings": {
                    "VCCLCompilerTool": {
                      "AdditionalOptions": [
                        "/guard:cf",
                        "/ZH:SHA_256",
                        "/sdl"
                      ],
                      "ExceptionHandling": 1,
                      "RuntimeTypeInfo": "true"
                    },
                    "VCLinkerTool": {
                      "AdditionalOptions": [
                        "/guard:cf",
                        "/DYNAMICBASE"
                      ]
                    }
                  }
                }
              ]
            ],
            "configurations": {
              "Debug": {
                "defines": [
                  "_CRTDBG_MAP_ALLOC"
                ],
                "msvs_settings": {
                  "VCCLCompilerTool": {
                    "AdditionalOptions": [
                      "/MDd",
                      "/Zi",
                      "/Od",
                      "/RTC1",
                      "/fsanitize=address"
                    ],
                    "RuntimeLibrary": "3",
                    "BasicRuntimeChecks": "3",
                    "Optimization": "0",
                    "DebugInformationFormat": "3"
                  },
                  "VCLinkerTool": {
                    "AdditionalOptions": [
                      "/DEBUG:FULL",
                      "/INCREMENTAL:NO"
                    ],
                    "GenerateDebugInformation": "true"
                  }
                }
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "sources": [
              "src/darwin/volume_mount_points.cpp",
              "src/darwin/volume_metadata.cpp",
              "src/darwin/hidden.cpp"
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

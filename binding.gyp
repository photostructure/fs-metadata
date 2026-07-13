{
  "variables": {
    # Sanitizer builds (ASan/UBSan/TSan) must NOT enable _FORTIFY_SOURCE: its
    # libc interceptors collide with the sanitizers' own, producing both false
    # positives and false negatives. The OpenSSF Compiler Options Hardening
    # Guide is explicit that FORTIFY should be off for instrumented builds.
    #
    # Sanitizer test runners export FS_METADATA_SANITIZE=1 so this flips to
    # "on" for instrumented builds only.
    # Relying on env CFLAGS ordering to override binding.gyp is fragile; this
    # makes the intent explicit and deterministic.
    #
    # The value is deliberately "on"/"off" rather than 1/0: gyp coerces
    # numeric-looking strings to ints, so a `fs_sanitize=="0"` test would
    # silently compare int 0 against str "0" and always be false -- which
    # inverts the condition and ships _FORTIFY_SOURCE=0 in the release build.
    "fs_sanitize%": "<!(node -p \"process.env.FS_METADATA_SANITIZE ? 'on' : 'off'\")",

    # Absolute path to node-addon-api's headers, for -isystem.
    #
    # node-addon-api is also in include_dirs (-I), but -Wformat=2 makes clang
    # emit -Wformat-nonliteral inside napi-inl.h -- a third-party header we
    # cannot fix. Passing the same directory with -isystem marks it a SYSTEM
    # include, which suppresses its warnings while keeping the full warning set
    # on our own code. (GCC/Clang: when a directory is given with both -I and
    # -isystem, the -I is ignored and the directory is treated as a system one.)
    #
    # `.include_dir` is RELATIVE; the build runs from build/, so it must be
    # resolved to an absolute path here.
    "napi_include_dir": "<!(node -p \"require('path').resolve(require('node-addon-api').include_dir)\")"
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
            # OpenSSF Compiler Options Hardening Guide baseline.
            #
            # Every flag below was verified against the OLDEST toolchain we ship
            # from -- Debian 11 Bullseye / GCC 10.2 (see prebuild-linux-glibc.sh)
            # -- on both x64 and arm64, and against Alpine/musl (GCC 14).
            #
            # NOTE: gyp's `cflags` are passed to BOTH C and C++ compiles
            # (GYP_CXXFLAGS = ... $(CFLAGS_$(BUILDTYPE)) $(CFLAGS_CC_$(BUILDTYPE))),
            # so these must NOT be duplicated into cflags_cc.
            "cflags": [
              "-fPIC",
              "-Wall",
              "-Wextra",
              # -Wformat=2 implies -Wformat. This pairing is REQUIRED:
              # -Werror=format-security on its own hard-errors with
              # "-Wformat-security ignored without -Wformat".
              "-Wformat=2",
              "-Werror=format-security",
              "-fstack-protector-strong",
              "-fstack-clash-protection",
              "-fvisibility=hidden",
              # Silence -Wformat-nonliteral from node-addon-api's napi-inl.h
              # without weakening -Wformat=2 on our own code. See the
              # napi_include_dir variable above.
              "-isystem<(napi_include_dir)"
            ],
            "cflags_cc": [
              # Pin the project standard instead of inheriting a Node-major-
              # dependent value from common.gypi.
              "-std=gnu++20",
              "-fexceptions",
              "-fvisibility-inlines-hidden",
              # libstdc++ bounds/precondition assertions. Independent of FORTIFY;
              # safe to leave on under sanitizers.
              "-D_GLIBCXX_ASSERTIONS"
            ],
            # ELF/GNU-ld only. These are deliberately absent from the macOS
            # branch: Apple's ld64 rejects -z outright ("ld: unknown options: -z").
            # -Wl,-z,nodlopen must NEVER be added: Node dlopen()s this .node.
            "ldflags": [
              "-Wl,-z,relro",
              "-Wl,-z,now",
              "-Wl,-z,noexecstack"
            ],
            "conditions": [
              [
                "fs_sanitize=='off'",
                {
                  # _FORTIFY_SOURCE requires -O1+ (Release gives -O3).
                  #
                  # Level 3 is deliberately NOT used: it needs GCC 12 +
                  # glibc 2.34 for __builtin_dynamic_object_size. On our
                  # GCC 10.2 / glibc 2.31 floor it silently degrades to level 2
                  # (verified: __USE_FORTIFY_LEVEL=2), so =2 is the honest value.
                  # Revisit if the glibc prebuild floor moves past Bullseye.
                  #
                  # -U first: many distros predefine _FORTIFY_SOURCE, which would
                  # otherwise emit a macro-redefinition warning.
                  "cflags": [
                    "-U_FORTIFY_SOURCE",
                    "-D_FORTIFY_SOURCE=2"
                  ]
                },
                {
                  # Sanitizer build: FORTIFY must be OFF.
                  "cflags": [
                    "-U_FORTIFY_SOURCE",
                    "-D_FORTIFY_SOURCE=0"
                  ]
                }
              ],
              [
                "target_arch=='x64'",
                {
                  # Intel CET. x86-only: hard-errors on aarch64
                  # ("'-fcf-protection=full' is not supported for this target").
                  "cflags": ["-fcf-protection=full"]
                }
              ],
              [
                "target_arch=='arm64'",
                {
                  # AArch64 PAC/BTI. arm64-only: unknown option on x86.
                  "cflags": ["-mbranch-protection=standard"]
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
            "defines": [
              "WIN32",
              "_WINDOWS"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "WarningLevel": 4,
                "AdditionalOptions": [
                  "/std:c++20",   # Pin independently of Node's common.gypi
                  "/guard:cf",     # Control Flow Guard (forward-edge CFI), all arches
                  "/Qspectre",     # Spectre v1. NOT x64-only: MSVC supports ARM64
                                   # since VS 2017 15.7 (Microsoft Learn /Qspectre).
                  "/ZH:SHA_256",   # SHA-256 source hashing in the PDB
                  "/sdl"           # SDL checks (superset of /GS)
                ],
                "ExceptionHandling": 1,
                "RuntimeTypeInfo": "true"
              },
              "VCLinkerTool": {
                "AdditionalOptions": [
                  "/guard:cf",      # Must pair with the compiler /guard:cf, or we
                                    # pay the cost with none of the protection.
                  "/DYNAMICBASE",   # ASLR (default on)
                  "/HIGHENTROPYVA", # 64-bit ASLR. NOT x64-only: applies to any
                                    # 64-bit image incl. ARM64 (default on).
                  "/NXCOMPAT"       # DEP (default on)
                ]
              }
            },
            "conditions": [
              [
                "target_arch=='x64'",
                {
                  "defines": [
                    "_M_X64",
                    "_WIN64"
                  ],
                  "msvs_settings": {
                    "VCLinkerTool": {
                      # CET shadow stack (backward-edge CFI). Genuinely x64-only:
                      # ARM64 uses signed returns below instead.
                      "AdditionalOptions": ["/CETCOMPAT"]
                    }
                  }
                }
              ],
              [
                "target_arch=='arm64'",
                {
                  # See doc/WINDOWS_ARM64_SECURITY.md.
                  # /guard:cf, /Qspectre, /sdl, /ZH:SHA_256, /DYNAMICBASE,
                  # /HIGHENTROPYVA and /NXCOMPAT all apply here and are set above.
                  "defines": [
                    "_M_ARM64",
                    "_WIN64"
                  ],
                  "msvs_settings": {
                    "VCCLCompilerTool": {
                      # ARM64 signed returns (PAC-based backward-edge CFI).
                      # /CETCOMPAT is x64-only and intentionally absent here.
                      "AdditionalOptions": ["/guard:signret"]
                    }
                  }
                }
              ]
            ]
          }
        ],
        [
          "OS=='mac'",
          {
            "sources": [
              "src/darwin/get_mount_point.cpp",
              "src/darwin/volume_mount_points.cpp",
              "src/darwin/volume_metadata.cpp",
              "src/darwin/hidden.cpp"
            ],
            # IMPORTANT: on macOS, gyp's make generator takes compile flags ONLY
            # from xcode_settings -- target-level `cflags`/`cflags_cc` are
            # ignored outright (see gyp/generator/make.py: `if flavor == "mac"`).
            # This branch previously carried cflags/cflags_cc that were dead
            # code. Put every macOS flag in xcode_settings or it does nothing.
            "xcode_settings": {
              # Match the C++20 pinned above on Linux (-std=gnu++20) and
              # Windows (/std:c++20). Kept STRICT
              # (c++20, not gnu++20) on purpose: Linux is the permissive one, so
              # a GNU extension that slips into the code fails here first. This
              # is the same portability guard the previous c++17 pin provided.
              #
              # Verified against MACOSX_DEPLOYMENT_TARGET 10.15: libc++ marks a
              # few C++20 library features unavailable on older deployment
              # targets, but none that this addon uses.
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15",
              # == -fvisibility=hidden / -fvisibility-inlines-hidden
              "GCC_SYMBOLS_PRIVATE_EXTERN": "YES",
              "GCC_INLINES_ARE_PRIVATE_EXTERN": "YES",
              "OTHER_CFLAGS": [
                "-Wall",
                "-Wextra",
                # Same pairing requirement as Linux: -Werror=format-security
                # alone hard-errors without -Wformat (supplied by -Wformat=2).
                "-Wformat=2",
                "-Werror=format-security",
                "-fstack-protector-strong",
                # Silence -Wformat-nonliteral from node-addon-api's napi-inl.h
                # without weakening -Wformat=2 on our own code.
                "-isystem<(napi_include_dir)"
                # No -Wl,-z,* here: ld64 rejects them.
                # No -fstack-clash-protection here: accepted by current Apple
                # clang but NOT verified on the older clang shipped by the
                # macos-14/macos-15 CI images, where it would hard-error.
              ],
              "OTHER_CPLUSPLUSFLAGS": [
                # "$(inherited)" is LOAD-BEARING. gyp defaults
                # OTHER_CPLUSPLUSFLAGS to ["$(inherited)"], which is what pulls
                # OTHER_CFLAGS into C++ compiles. Setting this key without
                # $(inherited) would silently drop every OTHER_CFLAGS hardening
                # flag above from the C++ TUs -- i.e. all of our code.
                "$(inherited)",
                # libc++ bounds/precondition assertions (libc++ 18+). Verified
                # effective on Apple clang (traps out-of-bounds access). A no-op
                # on older libc++ that does not know the macro, never an error.
                "-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_FAST"
              ]
            },
            "link_settings": {
              "libraries": [
                "DiskArbitration.framework",
                "Foundation.framework",
                "IOKit.framework"
              ]
            },
            "conditions": [
              [
                "fs_sanitize=='off'",
                {
                  "xcode_settings": {
                    "OTHER_CFLAGS": [
                      "-U_FORTIFY_SOURCE",
                      "-D_FORTIFY_SOURCE=2"
                    ]
                  }
                },
                {
                  # Sanitizer build: FORTIFY must be OFF (see top-of-file note).
                  "xcode_settings": {
                    "OTHER_CFLAGS": [
                      "-U_FORTIFY_SOURCE",
                      "-D_FORTIFY_SOURCE=0"
                    ]
                  }
                }
              ]
            ]
          }
        ]
      ]
    }
  ]
}

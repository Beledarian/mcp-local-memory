# Bundled sqlite-vec binary

`windows-arm64/vec0.dll` is `sqlite-vec` v0.1.9 compiled for native Windows
ARM64 from the official upstream amalgamation.

- Upstream: https://github.com/asg017/sqlite-vec
- Source archive:
  `sqlite-vec-0.1.9-amalgamation.zip`
- Source SHA-256:
  `b87cdda12112657ba5ab8842f0088a4090982eaf41f22b2bd6d495b81765a8c9`
- Binary SHA-256:
  `995e679c4098d5e266719637c86a85bead623bf9850f4b250c6180593047723c`
- Toolchain used for the checked-in binary:
  MSVC 19.44.35219 for ARM64 and Windows SDK 10.0.26100.0
- Build flags: `/O2 /LD`, linker `/Brepro`

The upstream npm package does not publish a Windows ARM64 platform binary.
This is an unmodified build of upstream's dependency-free amalgamated C source,
not a fork. Rebuild it from the repository root with:

```powershell
.\scripts\build-sqlite-vec-windows-arm64.ps1
```

The upstream project is dual-licensed under MIT or Apache-2.0. Both license
files are included beside this notice.

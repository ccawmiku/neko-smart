# Source and licensing

neko-smart is a fork of [foru17/neko-master](https://github.com/foru17/neko-master). The upstream Web, Collector and Go agent retain the MIT license and original copyright in LICENSE.

The merged router engine in `apps/router/` is GPL-3.0-or-later, imported from `ccawmiku/openclash-modern`. Its license is `apps/router/COPYING`. The accounting engine in `apps/router/vendor/nlbwmon/` is ISC; see its COPYING and original source headers.

`tools/run-limited.ps1`, `tools/migrate-router.lua` and `tools/cutover-router.sh` are GPL-3.0-or-later. New Web/Collector/shared monitoring code uses the upstream MIT license. Router and central services communicate through a versioned metadata protocol.

MetaCubeXD control functions are adapted under MIT from MetaCubeX/metacubexd; see packages/shared/src/metacubexd/{LICENSE,upstream.json}. The native React views are maintained by neko-smart.

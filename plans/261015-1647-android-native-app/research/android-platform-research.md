# Reviewed Android Platform Research

Status: static research complete; native integrations untested. Parent-curated from completed `AndroidPlatformResearch` result and checked primary/repository evidence. No application files changed.

## Decisions

- Android 10+ / minSdk29; ARM64 device and x86_64 emulator; signed private APK.
- Kotlin shared Android/JVM foundation, Compose ordinary UI, platform terminal/editor adapters.
- Use platform Keystore-backed encryption for session credentials; do not persist passwords, MFA setup secrets or PAKE state. Do not copy Doggo's old security-crypto alpha version by default.
- Pin an actually compatible toolchain in Phase 02; Doggo's Kotlin2.1.10/Compose1.7.3/AGP8.7.3/Ktor3.1.0 is historical reference, not a certified current set.

## Candidate constraints

| Area | Evidence / consequence |
| --- | --- |
| ConnectBot termlib | Android Compose + libvterm JNI, caller-managed I/O. Inspected latest release 0.3.13 explicitly says “Untested build”. Treat it as first evaluation candidate, not certified pin. |
| Terminal behavior | IME, Unicode/emoji width, mouse/paste/search, scrollback/reflow, lifecycle disposal and raw-output compatibility require device evidence. Published artifacts do not prove them. |
| JediTerm | Established JVM core/widget; independent Android adapters exist. Java source compatibility and an Android display layer remain work. Never promise a tiny custom renderer or 100% shared rendering. |
| Termux | Root GPLv3 has Apache-origin exceptions for terminal libraries. Exact selected component/source/version needs review; neither blanket exclusion nor blanket permissive licensing is justified. TerminalView couples to TerminalSession. |
| Sora Editor | Android View integration through AndroidView is native, not WebView. LGPL-2.1-or-later obligations require review. Syntax/completion APIs do not supply current diff/merge/blame/language-service parity automatically. |
| JSON/TS services | Current app ships Monaco JSON/TypeScript workers. No existing Rust LSP route has been established. Native-equivalent implementation is a Phase 05 hard decision gate; no assumed server-side language service. |
| Native binaries | Audit every selected AAR/JNI/crypto ABI, ELF and APK packaging alignment; exercise an actual 16 KiB environment. Correctness is device-dependent, not a blanket claim about every Android15 device. |
| Lifecycle | Doze can suspend network and process death loses local state. No fixed socket-kill deadline; foreground reconstruction must revalidate server sessions and offsets. Do not use WorkManager as socket keepalive. |
| IME | Text composition uses InputConnection, not only hardware key events. Choose library input modes by composition tests; TYPE_NULL is not a universal fix. Preserve non-Latin input. |
| Background services | No FCM/backend push or foreground-service subsystem included by assumption. Notifications from observed events are best effort; no guaranteed delivery while process/network is suspended. |
| TLS | Keep platform trust/hostname checks. No trust-all or certificate-import/pinning feature added without explicit scope/design. Debug-only transport exceptions are isolated from release. |

## Rejected claims from delegated draft

- Old termlib 0.1.0 recommendation superseded by checked 0.3.13 release evidence; no current artifact was built.
- No blanket GPL blocker for every Termux terminal component.
- No claim Java/JediTerm can be imported directly into commonMain.
- No evidence current Rust server already hosts/routes LSP.
- No fixed 60–180 second Android socket termination guarantee.
- No guarantee a custom Canvas renderer is ~400 lines or provides complete desktop/Android parity.
- No permanent storage of MFA secrets, guaranteed hardware-backed keys, external dynamic DEX loading, automatic push stack or TLS importer adopted.
- No `cat /dev/urandom` terminal/performance smoke; use bounded deterministic output and actual TUIs.

## Required proof

1. Phase02: locked reproducible dependencies/toolchain, both ABI assemblies, no browser runtime, license inventory.
2. Phase05: real authenticated server terminal/editor/OPAQUE adapter evaluation; exact pinned APIs and ownership/disposal behavior.
3. Phase18: named physical device and emulator, IME variants, process death/Doze/network changes, native binary/page-size, throughput/memory and integrated security evidence.
4. Phase19: installed signed release APK, clean install/upgrade, backup/extraction/minification/signing checks.

## Primary sources

- [Compose supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html)
- [Compose packaging](https://kotlinlang.org/docs/multiplatform/compose-native-distribution.html)
- [ConnectBot release 0.3.13](https://github.com/connectbot/termlib/releases/tag/0.3.13)
- [ConnectBot tagged API](https://github.com/connectbot/termlib/blob/0.3.13/lib/api.txt)
- [JediTerm](https://github.com/JetBrains/jediterm)
- [Termux license exceptions](https://github.com/termux/termux-app/blob/master/LICENSE.md)
- [Sora Editor](https://github.com/Rosemoe/sora-editor)
- [Android 16 KiB guidance](https://developer.android.com/guide/practices/page-sizes)
- [Android Doze/network restrictions](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Android cryptography guidance](https://developer.android.com/privacy-and-security/cryptography)

## Unresolved questions

Exact pins/licenses, JSON/TS native-service implementation, native terminal API gaps and crypto ABI proof remain explicit implementation gates; none are silently waived.

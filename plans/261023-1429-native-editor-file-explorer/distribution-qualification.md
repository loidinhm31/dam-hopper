# Phase 08 — Distribution and LGPL-2.1 Qualification

## 1. Executive Summary & Release Gate Status

This document records the exact licensing inventory, copyright notices, and LGPL-2.1 Section 6 compliance mechanism for the native Android editor implementation in DamHopper.

- **Gate Status:** **DOCUMENTED & PACKAGED; DISTRIBUTION RELEASE GATED.**
- **Prerequisite Feasibility:** Qualified in Phase 01 (`dependency-qualification.md`, SHA-256 verified).
- **License Text Assets:** Packaged into APK under `assets/licenses/sora-editor.txt`, `assets/licenses/editor-language-assets.txt`, and `assets/licenses/jetbrains-mono.txt`.
- **DEX Packaging Clarification:** Standard Android AAR consumption merges compiled bytecode into APK DEX files (`classes.dex`). AAR packaging does **not** constitute runtime dynamic linking (`.so`). True compliance with LGPL-2.1 Section 6 on Android is satisfied via Section 6(a) user reverse engineering and DEX replacement/repackaging.

---

## 2. Artifact & Transitive Licensing Inventory

| Coordinate | Packaging | Version | License | SHA-256 Checksum | In-App Role |
|---|---|---|---|---|---|
| `io.github.Rosemoe.sora-editor:editor:0.23.4` | AAR | `0.23.4` | LGPL-2.1-or-later | `ab676f8c3f19b6e3351bed4706c9095d59191dfc2d720f7f90f96bb9e4a43392` | Core `CodeEditor`, `Content`, `UndoManager`, `Cursor` |
| `io.github.Rosemoe.sora-editor:language-java:0.23.4` | AAR | `0.23.4` | LGPL-2.1-or-later | `ce092684e47ded1ac610aef753612f6bbdb7aaac3e970a4e6b5c764b84415dd3` | Incremental Java tokenizer & lexer (`JavaLanguage`) |
| `androidx.annotation:annotation` | AAR | `1.8.1` | Apache-2.0 | Maven Google | Transitive annotation support |
| `androidx.collection:collection` | AAR | `1.4.2` | Apache-2.0 | Maven Google | Transitive collection utilities |
| `org.jetbrains.kotlin:kotlin-stdlib` | JAR | `2.1.10` | Apache-2.0 | Maven Central | Kotlin runtime standard library |
| JetBrains Mono Font | TTF | `2.304` | SIL OFL 1.1 | Pinned font asset | Terminal and editor monospace typography |

### Excluded Grammar & Transitive Components
- `language-textmate:0.23.4`: Excluded. Requires third-party TextMate bundles (`plist`/`json`) and external TextMate themes with diverse licensing.
- `language-treesitter:0.23.4`: Excluded. Requires per-ABI native `.so` binaries (`arm64-v8a`, `x86_64`, `armeabi-v7a`, `x86`).
- `editor-lsp:0.23.4`: Excluded. Server provides no LSP daemon; semantic language services are out of scope.

---

## 3. License Notice & Asset Packaging

1. **APK Asset Inclusion:**
   - Full LGPL-2.1 text and copyright notice: `native-app/androidApp/src/main/assets/licenses/sora-editor.txt`.
   - Grammar and asset provenance inventory: `native-app/androidApp/src/main/assets/licenses/editor-language-assets.txt`.
   - JetBrains Mono OFL 1.1 notice: `native-app/androidApp/src/main/assets/licenses/jetbrains-mono.txt`.
2. **Resource Packaging Invariant (`native-app/androidApp/build.gradle.kts`):**
   ```kotlin
   packaging {
       resources {
           pickFirsts += setOf("/META-INF/AL2.0", "/META-INF/LGPL2.1")
       }
   }
   ```
3. **Obfuscation & Minification Status:**
   - Current `androidApp/build.gradle.kts` sets `isMinifyEnabled = false` for release builds, meaning bytecode is not currently obfuscated or shrunk by R8.
   - For any future minified distribution builds, adding `-keep class io.github.rosemoe.sora.** { *; }` to `proguard-rules.pro` is an identified requirement to ensure Sora Editor package symbols remain stable and unmangled for user relinking.

### 4.1 Legal & Technical Reality on Android
Under Android's compilation model, Java/Kotlin libraries packaged as `.aar` or `.jar` are desugared and compiled into Dalvik Executable (`.dex`) format by the `d8`/`r8` compiler. Unlike C/C++ shared objects (`.so`) loaded via `dlopen()`, DEX classes are embedded directly in the application's bytecode image.

Therefore, claiming that an AAR dependency is "dynamically linked at runtime" by the OS dynamic linker is technically inaccurate. Compliance with **LGPL-2.1 Section 6** requires providing the customer/user with:
1. Prominent notice of LGPL-2.1 licensing and inclusion of the license text (satisfied via `assets/licenses/`).
2. Complete machine-readable source code or a written offer for the Library (upstream tag `0.23.4` at `https://github.com/Rosemoe/sora-editor`).
3. A practical mechanism allowing the user to modify the Library and relink or replace it in the distributed executable (Section 6a).

### 4.2 Verified Relinking / Replacement Runbook

Users who wish to modify `sora-editor` and run their modified version within the distributed DamHopper Android application may use the following standard procedure:

```bash
# Step 1: Disassemble the distributed APK
apktool d dam-hopper-debug.apk -o dam-hopper-unpacked

# Step 2: Compile modified sora-editor classes to DEX
# (Assuming user modifies sora-editor source and produces updated class files)
d8 --min-api 29 --output replacement-dex/ path/to/modified/classes/io/github/rosemoe/sora/**/*.class

# Step 3: Convert replacement DEX to Smali or replace corresponding smali files
baksmali d replacement-dex/classes.dex -o replacement-smali/
cp -r replacement-smali/io/github/rosemoe/sora/* dam-hopper-unpacked/smali/io/github/rosemoe/sora/

# Step 4: Rebuild the APK
apktool b dam-hopper-unpacked -o dam-hopper-relinked.apk

# Step 5: Sign the modified APK with a local debug key
keytool -genkey -v -keystore test-debug.keystore -alias debug -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android -dname "CN=Debug,O=Local,C=US"
apksigner sign --ks test-debug.keystore --ks-pass pass:android dam-hopper-relinked.apk

# Step 6: Install and verify on device
adb install -r dam-hopper-relinked.apk
```

Because release minification is currently disabled (`isMinifyEnabled = false`), bytecode symbols, public methods, and field layouts remain completely unmangled in distributed APKs. For any future minified builds, `-keep class io.github.rosemoe.sora.** { *; }` must be configured in `proguard-rules.pro` to ensure symbols match the upstream library interfaces.

---

## 5. Release Constraints & Final Acceptance

1. **Prerelease tag constraint:** Upstream version `0.23.4` is explicitly marked as a prerelease. The pin `0.23.4` is preserved without silent upgrade.
2. **Distribution Release Gate:** While license texts and the relinking procedure are in place, official binary distribution release remains gated on physical/emulator runtime qualification and demonstrated relinking verification on a production release artifact.

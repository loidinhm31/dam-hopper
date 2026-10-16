#!/usr/bin/env bash
set -euo pipefail

# Native Terminal, Editor & Crypto Proof Gates Verification for Phase 05
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS_COUNT=0
FAIL_COUNT=0

assert_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if grep -Fq "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (pattern '$pattern' not found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_not_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if ! grep -Fq "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (prohibited pattern '$pattern' found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo "=== Suite 1: Terminal Candidate & Surface Contract Invariants ==="
TERM_SURFACE="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/AndroidTerminalSurface.kt"
assert_contains "CandidateTerminalAdapter pins ConnectBot termlib" 'val name: String = "ConnectBot termlib"' "$TERM_SURFACE"
assert_contains "CandidateTerminalAdapter pins version 0.3.13" 'val version: String = "0.3.13"' "$TERM_SURFACE"
assert_contains "CandidateTerminalAdapter notes libvterm.so JNI" 'val jniLibrary: String = "libvterm.so"' "$TERM_SURFACE"
assert_contains "CandidateTerminalAdapter specifies Apache-2.0 and MIT" 'Apache-2.0 (termlib) / MIT (libvterm)' "$TERM_SURFACE"
assert_contains "CandidateTerminalAdapter targets 16 KiB alignment" 'val is16KiBPageAlignedTarget: Boolean = true' "$TERM_SURFACE"
assert_contains "NativeTerminalSurface declares attachView" "fun attachView(hostView: Any?)" "$TERM_SURFACE"
assert_contains "NativeTerminalSurface declares detachView" "fun detachView()" "$TERM_SURFACE"
assert_contains "NativeTerminalSurface declares feedOutput" "fun feedOutput(data: ByteArray, offset: Long, reset: Boolean = false)" "$TERM_SURFACE"
assert_contains "NativeTerminalSurface declares resize" "fun resize(cols: Int, rows: Int)" "$TERM_SURFACE"
assert_contains "NativeTerminalSurface declares search" "fun search(query: String, matchCase: Boolean = false): TerminalSearchResult" "$TERM_SURFACE"
assert_contains "AndroidTerminalSurface implements NativeTerminalSurface" "class AndroidTerminalSurface(" "$TERM_SURFACE"
assert_contains "TerminalSessionController manages session lifecycle" "class TerminalSessionController(" "$TERM_SURFACE"
assert_contains "TerminalSessionController gates input on panel active" "if (!isPanelActive) {" "$TERM_SURFACE"
assert_contains "TerminalSessionController gates input on replay completion" "if (!isReplayCompleted) {" "$TERM_SURFACE"
assert_contains "TerminalSessionController encodes Ctrl and Alt modifiers" "fun encodeKey(char: Char): ByteArray" "$TERM_SURFACE"
assert_contains "TerminalSessionController encodes special navigation keys" "fun encodeSpecialKey(name: String): ByteArray" "$TERM_SURFACE"

echo "=== Suite 2: Editor Candidate & Surface Contract Invariants ==="
EDIT_SURFACE="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt"
assert_contains "CandidateEditorAdapter pins Sora Editor" 'val name: String = "Sora Editor"' "$EDIT_SURFACE"
assert_contains "CandidateEditorAdapter pins version 0.23.4" 'val version: String = "0.23.4"' "$EDIT_SURFACE"
assert_contains "CandidateEditorAdapter pins artifact coordinate" 'io.github.rosemoe.sora-editor:editor:0.23.4' "$EDIT_SURFACE"
assert_contains "CandidateEditorAdapter records LGPL-2.1 license" 'val license: String = "LGPL-2.1-or-later"' "$EDIT_SURFACE"
assert_contains "CandidateEditorAdapter explains dynamic linkage compliance" "AAR distribution operates via dynamic linkage" "$EDIT_SURFACE"
assert_contains "NativeEditorSurface declares setText with modelVersion" "fun setText(text: String, modelVersion: Long = 1L)" "$EDIT_SURFACE"
assert_contains "NativeEditorSurface declares applyEdit" "fun applyEdit(edit: EditorTextEdit)" "$EDIT_SURFACE"
assert_contains "NativeEditorSurface declares undo and redo" "fun undo(): Boolean" "$EDIT_SURFACE"
assert_contains "NativeEditorSurface declares read-only mode" "fun setReadOnly(readOnly: Boolean)" "$EDIT_SURFACE"
assert_contains "NativeEditorSurface declares gutter decorations" "fun setGutterDecorations(decorations: List<EditorGutterDecoration>)" "$EDIT_SURFACE"
assert_contains "AndroidEditorSurface implements NativeEditorSurface" "class AndroidEditorSurface(" "$EDIT_SURFACE"
assert_contains "EditorSession tracks file path and project target" "class EditorSession(" "$EDIT_SURFACE"
assert_contains "EditorSession tracks server mtime" "var serverMtime: Long? = null" "$EDIT_SURFACE"
assert_contains "EditorSession tracks dirty state" "var isDirty: Boolean = false" "$EDIT_SURFACE"
assert_contains "EditorSession guards save operations" "fun canSave(): Boolean" "$EDIT_SURFACE"

echo "=== Suite 3: Language Service Contract & Stale Request Fencing ==="
LANG_SERVICE="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LanguageService.kt"
assert_contains "LanguageService interface declared" "interface LanguageService {" "$LANG_SERVICE"
assert_contains "LanguageService declares validateDocument" "fun validateDocument(request: LanguageServiceRequest): LanguageServiceResponse<List<Diagnostic>>" "$LANG_SERVICE"
assert_contains "LanguageService declares getCompletions" "fun getCompletions(" "$LANG_SERVICE"
assert_contains "LanguageService declares getSymbols" "fun getSymbols(request: LanguageServiceRequest): LanguageServiceResponse<List<DocumentSymbol>>" "$LANG_SERVICE"
assert_contains "JsonLanguageService implements offline validation" "class JsonLanguageService(" "$LANG_SERVICE"
assert_contains "JsonLanguageService sets isAvailableOffline true" "override val isAvailableOffline: Boolean = true" "$LANG_SERVICE"
assert_contains "TypeScriptLanguageServiceAudit marks BLOCKED_PENDING_RUNTIME_DECISION" 'const val STATUS = "BLOCKED_PENDING_RUNTIME_DECISION"' "$LANG_SERVICE"
assert_contains "TypeScriptLanguageServiceAudit notes absence of server LSP" "does not host a Language Server Protocol (LSP) daemon" "$LANG_SERVICE"
assert_contains "LanguageServiceCoordinator fences stale responses" "class LanguageServiceCoordinator {" "$LANG_SERVICE"

echo "=== Suite 4: OPAQUE Crypto Bridge & JNI Invariants ==="
CRYPTO_TOML="native-app/crypto-bridge/Cargo.toml"
CRYPTO_RS="native-app/crypto-bridge/src/lib.rs"
CRYPTO_KT="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/crypto/OpaqueClientBridge.kt"
assert_contains "Cargo.toml defines cdylib crate type" 'crate-type = ["cdylib", "rlib"]' "$CRYPTO_TOML"
assert_contains "Cargo.toml pins opaque-ke 4.0.1" 'opaque-ke = "4.0.1"' "$CRYPTO_TOML"
assert_contains "DamHopperOpaqueSuite declared in Rust" "pub struct DamHopperOpaqueSuite;" "$CRYPTO_RS"
assert_contains "DamHopperOpaqueSuite uses Ristretto255" "type OprfCs = opaque_ke::Ristretto255;" "$CRYPTO_RS"
assert_contains "DamHopperOpaqueSuite uses TripleDH" "type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;" "$CRYPTO_RS"
assert_contains "DamHopperOpaqueSuite uses Identity KSF" "type Ksf = opaque_ke::ksf::Identity;" "$CRYPTO_RS"
assert_contains "HKDF info matches server string" 'pub const HKDF_INFO: &[u8] = b"dam-hopper-aes-256-gcm-v1";' "$CRYPTO_RS"
assert_contains "AES key length is 32 bytes" "pub const AES_KEY_LEN: usize = 32;" "$CRYPTO_RS"
assert_contains "Rust exports nativeRegisterStart JNI" "Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeRegisterStart" "$CRYPTO_RS"
assert_contains "Rust exports nativeRegisterFinish JNI" "Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeRegisterFinish" "$CRYPTO_RS"
assert_contains "Rust exports nativeLoginStart JNI" "Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeLoginStart" "$CRYPTO_RS"
assert_contains "Rust exports nativeLoginFinish JNI" "Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeLoginFinish" "$CRYPTO_RS"
assert_contains "Rust exports nativeCloseHandle JNI" "Java_dev_damhopper_nativeapp_platform_crypto_OpaqueClientBridge_nativeCloseHandle" "$CRYPTO_RS"
assert_contains "Rust uses LazyLock for state stores" "std::sync::LazyLock::new" "$CRYPTO_RS"
assert_contains "Kotlin OpaqueCipherSuiteMetadata defines SUITE_NAME" 'const val SUITE_NAME = "DamHopperOpaqueSuite"' "$CRYPTO_KT"
assert_contains "Kotlin OpaqueCipherSuiteMetadata defines HKDF_INFO" 'const val HKDF_INFO = "dam-hopper-aes-256-gcm-v1"' "$CRYPTO_KT"
assert_contains "Kotlin OpaqueClientBridge masks aesKey in toString" "[REDACTED]" "$CRYPTO_KT"
assert_contains "Kotlin OpaqueClientBridge implements deriveAesKey" "fun deriveAesKey(sessionKey: ByteArray): ByteArray" "$CRYPTO_KT"

echo "=== Suite 5: Packaging & License Compliance Invariants ==="
APP_BUILD_GRADLE="native-app/androidApp/build.gradle.kts"
DECISIONS_DOC="docs/android-native-dependency-decisions.md"
assert_contains "androidApp build.gradle preserves AL2.0 and LGPL2.1 notices" 'pickFirsts += setOf("/META-INF/AL2.0", "/META-INF/LGPL2.1")' "$APP_BUILD_GRADLE"
assert_not_contains "androidApp build.gradle does not strip license files" 'excludes += "/META-INF/{AL2.0,LGPL2.1}"' "$APP_BUILD_GRADLE"
assert_contains "Dependency decisions doc exists and records ConnectBot" "ConnectBot termlib 0.3.13" "$DECISIONS_DOC"
assert_contains "Dependency decisions doc records Sora Editor" "Sora Editor 0.23.4" "$DECISIONS_DOC"
assert_contains "Dependency decisions doc records LGPL-2.1 compliance" "LGPL-2.1" "$DECISIONS_DOC"
assert_contains "Dependency decisions doc records TypeScript blocker" "BLOCKED_PENDING_RUNTIME_DECISION" "$DECISIONS_DOC"
assert_contains "Dependency decisions doc records 16 KiB alignment target" "16 KiB" "$DECISIONS_DOC"
assert_contains "Dependency decisions doc records crypto suite verification" "DamHopperOpaqueSuite" "$DECISIONS_DOC"

echo "============================================="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "Phase 05 Proof Gates verification FAILED"
    exit 1
else
    echo "Phase 05 Proof Gates verification PASSED (100%)"
    exit 0
fi

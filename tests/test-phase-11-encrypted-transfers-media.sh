#!/usr/bin/env bash
set -euo pipefail

# Encrypted Transfers, Media Streaming and Android Storage Invariant Verification for Phase 11
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

echo "=== Suite 1: OPAQUE Cryptographic Session & Envelope Invariants (X01) ==="
CRYPTO_ENV="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/CryptoEnvelope.kt"
CRYPTO_SESS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/CryptoSession.kt"
PLATFORM_CRYPTO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/PlatformCrypto.kt"
BRIDGE_RS="native-app/crypto-bridge/src/lib.rs"

assert_contains "CryptoEnvelope object declared" "object CryptoEnvelope" "$CRYPTO_ENV"
assert_contains "IV_LENGTH 12 bytes defined" "const val IV_LENGTH: Int = 12" "$CRYPTO_ENV"
assert_contains "TAG_LENGTH 16 bytes defined" "const val TAG_LENGTH: Int = 16" "$CRYPTO_ENV"
assert_contains "METADATA_MAX_LENGTH 4096 bytes defined" "const val METADATA_MAX_LENGTH: Int = 4096" "$CRYPTO_ENV"
assert_contains "FileBlobMetadata model declared" "data class FileBlobMetadata(" "$CRYPTO_ENV"
assert_contains "TextBlobMetadata model declared" "data class TextBlobMetadata(" "$CRYPTO_ENV"
assert_contains "packPlaintext function declared" "fun packPlaintext(" "$CRYPTO_ENV"
assert_contains "unpackPlaintext function declared" "fun unpackPlaintext(" "$CRYPTO_ENV"
assert_contains "CryptoSession class declared" "class CryptoSession(" "$CRYPTO_SESS"
assert_contains "CryptoSession AutoCloseable" ": AutoCloseable" "$CRYPTO_SESS"
assert_contains "Key zeroization on close" "keyBytes.fill(0)" "$CRYPTO_SESS"
assert_contains "Owner generation validation" "fun assertValid(" "$CRYPTO_SESS"
assert_contains "CryptoSessionManager declared" "class CryptoSessionManager" "$CRYPTO_SESS"
assert_contains "PlatformCrypto expect object declared" "expect object PlatformCrypto" "$PLATFORM_CRYPTO"
assert_contains "Rust encrypt_envelope function declared" "pub fn encrypt_envelope(" "$BRIDGE_RS"
assert_contains "Rust decrypt_envelope function declared" "pub fn decrypt_envelope(" "$BRIDGE_RS"
assert_contains "Rust METADATA_MAX defined" "pub const METADATA_MAX: usize = 4096;" "$BRIDGE_RS"

echo "=== Suite 2: Transfer Coordinator & Chunked Binary State Machine (X01) ==="
TRANSFER_COORD="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinator.kt"
FILE_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt"

assert_contains "TransferCoordinator class declared" "class TransferCoordinator(" "$TRANSFER_COORD"
assert_contains "TransferResult sealed class declared" "sealed class TransferResult" "$TRANSFER_COORD"
assert_contains "TransferResult Success declared" "data class Success(" "$TRANSFER_COORD"
assert_contains "TransferResult Conflict declared" "data class Conflict(" "$TRANSFER_COORD"
assert_contains "TransferResult UnknownOutcome declared" "data class UnknownOutcome(" "$TRANSFER_COORD"
assert_contains "DEFAULT_CHUNK_SIZE 64 KiB defined" "const val DEFAULT_CHUNK_SIZE: Int = 64 * 1024" "$TRANSFER_COORD"
assert_contains "MAX_FILE_SIZE 100 MiB defined" "const val MAX_FILE_SIZE: Long = 100 * 1024 * 1024" "$TRANSFER_COORD"
assert_contains "uploadPlain function declared" "suspend fun uploadPlain(" "$TRANSFER_COORD"
assert_contains "uploadEncrypted function declared" "suspend fun uploadEncrypted(" "$TRANSFER_COORD"
assert_contains "uploadPlainStream declared" "suspend fun uploadPlainStream(" "$TRANSFER_COORD"
assert_contains "Uses sendAtomicPair for chunk streaming" "wsConnection.sendAtomicPair(" "$TRANSFER_COORD"
assert_contains "Registers ack listener before chunk transmission" "filterIsInstance<ServerMsg.FsUploadChunkAck>()" "$TRANSFER_COORD"
assert_contains "Registers put ack listener before chunk transmission" "filterIsInstance<ServerMsg.FsPutChunkAck>()" "$TRANSFER_COORD"
assert_contains "FileRepository exposes uploadPlain" "suspend fun uploadPlain(" "$FILE_REPO"
assert_contains "FileRepository exposes uploadEncrypted" "suspend fun uploadEncrypted(" "$FILE_REPO"

echo "=== Suite 3: Encrypted Save Coordinator & Conflict-Aware Saves (X01) ==="
ENC_SAVE_COORD="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinator.kt"
EDITOR_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt"

assert_contains "EncryptedSaveCoordinator class declared" "class EncryptedSaveCoordinator(" "$ENC_SAVE_COORD"
assert_contains "saveEncrypted function declared" "suspend fun saveEncrypted(" "$ENC_SAVE_COORD"
assert_contains "forceOverwriteEncrypted function declared" "suspend fun forceOverwriteEncrypted(" "$ENC_SAVE_COORD"
assert_contains "Uses sendAtomicPair for single-blob force overwrite" "wsConnection.sendAtomicPair(putSaveHeader, envelopeBytes)" "$ENC_SAVE_COORD"
assert_contains "EditorRepository wires encryptedSaveCoordinator" "val encryptedSaveCoordinator: EncryptedSaveCoordinator" "$EDITOR_REPO"
assert_contains "EditorRepository accepts cryptoSessionProvider" "val cryptoSessionProvider: (() -> dev.damhopper.nativeapp.core.security.CryptoSession?)? = null" "$EDITOR_REPO"
assert_contains "saveFile enforces encryptedRequested without plaintext downgrade" "if (encryptedRequested)" "$EDITOR_REPO"
assert_contains "forceOverwrite enforces encryptedRequested without plaintext downgrade" "if (encryptedRequested)" "$EDITOR_REPO"

echo "=== Suite 4: Android SAF Document Storage & Size Cap Enforcement (SAF-01) ==="
DOC_STORAGE="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidDocumentStorage.kt"

assert_contains "DocumentStorage interface declared" "interface DocumentStorage" "$DOC_STORAGE"
assert_contains "AndroidDocumentStorage class declared" "class AndroidDocumentStorage(" "$DOC_STORAGE"
assert_contains "MAX_DOCUMENT_BYTES 100 MiB cap" "const val MAX_DOCUMENT_BYTES: Long = 100 * 1024 * 1024" "$DOC_STORAGE"
assert_contains "queryMetadata function declared" "override suspend fun queryMetadata(" "$DOC_STORAGE"
assert_contains "readBytes function declared" "override suspend fun readBytes(" "$DOC_STORAGE"
assert_contains "writeBytes function declared" "override suspend fun writeBytes(" "$DOC_STORAGE"
assert_contains "streamFromUri function declared" "override suspend fun streamFromUri(" "$DOC_STORAGE"
assert_contains "streamToUri function declared" "override suspend fun streamToUri(" "$DOC_STORAGE"
assert_contains "sanitizeFilename helper declared" "fun sanitizeFilename(raw: String): String" "$DOC_STORAGE"

echo "=== Suite 5: Media Lease, Origin-Bound Client & Cookie Isolation (M01) ==="
MEDIA_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaModels.kt"
MEDIA_CLIENT="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClient.kt"

assert_contains "MediaKind enum declared" "enum class MediaKind" "$MEDIA_MODELS"
assert_contains "MediaPurpose enum declared" "enum class MediaPurpose" "$MEDIA_MODELS"
assert_contains "IssueImageTicketRequest model declared" "data class IssueImageTicketRequest(" "$MEDIA_MODELS"
assert_contains "IssueImageTicketResponse model declared" "data class IssueImageTicketResponse(" "$MEDIA_MODELS"
assert_contains "IssueVideoTicketRequest model declared" "data class IssueVideoTicketRequest(" "$MEDIA_MODELS"
assert_contains "IssueVideoTicketResponse model declared" "data class IssueVideoTicketResponse(" "$MEDIA_MODELS"
assert_contains "MediaLease model declared" "data class MediaLease(" "$MEDIA_MODELS"
assert_contains "MediaLease assertValidOwner declared" "fun assertValidOwner(" "$MEDIA_MODELS"
assert_contains "AndroidMediaClient class declared" "class AndroidMediaClient(" "$MEDIA_CLIENT"
assert_contains "followRedirects false configured" ".followRedirects(false)" "$MEDIA_CLIENT"
assert_contains "followSslRedirects false configured" ".followSslRedirects(false)" "$MEDIA_CLIENT"
assert_contains "assertSameOrigin validation declared" "internal fun assertSameOrigin(" "$MEDIA_CLIENT"
assert_contains "MEDIA_SESSION_COOKIE_PREFIX defined" "const val MEDIA_SESSION_COOKIE_PREFIX" "$MEDIA_CLIENT"
assert_contains "mediaSessionCookieName helper declared" "fun mediaSessionCookieName(" "$MEDIA_CLIENT"
assert_contains "assertValidMediaClientId helper declared" "fun assertValidMediaClientId(" "$MEDIA_CLIENT"
assert_contains "Rust nativeEncryptEnvelope JNI export declared" "nativeEncryptEnvelope" "$BRIDGE_RS"
assert_contains "Rust nativeDecryptEnvelope JNI export declared" "nativeDecryptEnvelope" "$BRIDGE_RS"
assert_contains "issueImageTicket function declared" "suspend fun issueImageTicket(" "$MEDIA_CLIENT"
assert_contains "revokeImageTicket function declared" "suspend fun revokeImageTicket(" "$MEDIA_CLIENT"
assert_contains "issueVideoTicket function declared" "suspend fun issueVideoTicket(" "$MEDIA_CLIENT"
assert_contains "revokeVideoTicket function declared" "suspend fun revokeVideoTicket(" "$MEDIA_CLIENT"
assert_contains "revokeMediaSession function declared" "suspend fun revokeMediaSession(" "$MEDIA_CLIENT"
assert_contains "fetchImageBytes function declared" "suspend fun fetchImageBytes(" "$MEDIA_CLIENT"
assert_contains "fetchMediaHeader function declared" "suspend fun fetchMediaHeader(" "$MEDIA_CLIENT"
assert_contains "readRangeSync function declared" "fun readRangeSync(" "$MEDIA_CLIENT"
assert_contains "downloadMediaStream function declared" "suspend fun downloadMediaStream(" "$MEDIA_CLIENT"
assert_contains "LeaseMediaDataSource class declared" "class LeaseMediaDataSource(" "$MEDIA_CLIENT"
assert_contains "LeaseMediaDataSource extends MediaDataSource" ": MediaDataSource()" "$MEDIA_CLIENT"

echo "=== Suite 6: Native Media Presentation & Zero FABs Invariant (NAV-01, M01) ==="
VIDEO_SURFACE="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidVideoSurface.kt"
PREVIEW_CARD="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/MediaPreviewCard.kt"

assert_contains "AndroidVideoSurface composable declared" "fun AndroidVideoSurface(" "$VIDEO_SURFACE"
assert_contains "SurfaceView used in AndroidVideoSurface" "SurfaceView(context)" "$VIDEO_SURFACE"
assert_contains "MediaPreviewCard accepts onDownloadClicked" "onDownloadClicked: (() -> Unit)? = null" "$PREVIEW_CARD"
assert_not_contains "Zero FloatingActionButton in AndroidVideoSurface" "FloatingActionButton" "$VIDEO_SURFACE"
assert_not_contains "Zero ExtendedFloatingActionButton in AndroidVideoSurface" "ExtendedFloatingActionButton" "$VIDEO_SURFACE"
assert_not_contains "Zero FloatingActionButton in MediaPreviewCard" "FloatingActionButton" "$PREVIEW_CARD"
assert_not_contains "Zero ExtendedFloatingActionButton in MediaPreviewCard" "ExtendedFloatingActionButton" "$PREVIEW_CARD"

echo ""
echo "=== Phase 11 Invariant Verification Summary ==="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "✅ Verification PASSED: All $PASS_COUNT assertions satisfied"
    exit 0
else
    echo "❌ Verification FAILED: $FAIL_COUNT assertion(s) failed"
    exit 1
fi

#!/usr/bin/env bash
set -euo pipefail

# Transport & Ownership Verification for Phase 03 (Contracts ownership and live transport)
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

echo "=== Suite 1: Core Models & Generation Scoping ==="
CONN_REF="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/ConnectionRef.kt"
assert_contains "ConnectionRef defines deterministic key format" '"""["${ref.profileId}",${ref.generation}]"""' "$CONN_REF"
assert_contains "ConnectionRef provides parseKey helper" "fun parseKey(key: String): ConnectionRef?" "$CONN_REF"
assert_contains "SocketInstanceRef separates socket attempt from connection generation" "data class SocketInstanceRef(" "$CONN_REF"

TARGET_REF="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/ProjectTargetRef.kt"
assert_contains "ProjectTargetRef projects to ServerProjectTarget" "fun toServerPayload(): ServerProjectTarget" "$TARGET_REF"
assert_contains "ServerProjectTarget data class declared" "data class ServerProjectTarget(" "$TARGET_REF"
assert_contains "normalizeProjectTargetPath handles leading and trailing slashes" "fun normalizeProjectTargetPath(path: String?): String?" "$TARGET_REF"

ERRORS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/ConnectionOwnerError.kt"
assert_contains "ConnectionOwnerError defines STALE reason" "STALE," "$ERRORS"
assert_contains "ConnectionOwnerError defines UNAVAILABLE reason" "UNAVAILABLE," "$ERRORS"
assert_contains "ConnectionOwnerError defines OWNER_MISMATCH reason" "OWNER_MISMATCH," "$ERRORS"

echo "=== Suite 2: ConnectionRegistry Lifecycle Fences ==="
REGISTRY="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistry.kt"
assert_contains "ConnectionRegistry manages activeGenerations map" "private val activeGenerations = mutableMapOf<ProfileId, Long>()" "$REGISTRY"
assert_contains "ConnectionRegistry provides getOrCreateConnection" "suspend fun getOrCreateConnection(profileId: ProfileId): ConnectionRef" "$REGISTRY"
assert_contains "ConnectionRegistry increments generation on retirement" "val nextGen = currentGen + 1" "$REGISTRY"
assert_contains "ConnectionRegistry enforces assertCurrentOwner" "suspend fun assertCurrentOwner(ref: ConnectionRef" "$REGISTRY"
assert_contains "ConnectionRegistry notifies retirement listeners" "retirementListeners.add(listener)" "$REGISTRY"

echo "=== Suite 3: Wire Protocol & Serialization Invariants ==="
WIRE_COMMON="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WireCommon.kt"
assert_contains "ProtocolJson configures kind class discriminator" 'classDiscriminator = "kind"' "$WIRE_COMMON"
assert_contains "ProtocolJson ignores unknown keys" "ignoreUnknownKeys = true" "$WIRE_COMMON"

CLIENT_MSG="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ClientMsg.kt"
assert_contains "ClientMsg declares terminal:write" '@SerialName("terminal:write")' "$CLIENT_MSG"
assert_contains "ClientMsg declares fs:subscribe_tree" '@SerialName("fs:subscribe_tree")' "$CLIENT_MSG"
assert_contains "ClientMsg declares fs:write_chunk_binary" '@SerialName("fs:write_chunk_binary")' "$CLIENT_MSG"
assert_contains "ClientMsg maps watchOnly" '@SerialName("watchOnly")' "$CLIENT_MSG"

SERVER_MSG="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ServerMsg.kt"
assert_contains "ServerMsg declares terminal:output" '@SerialName("terminal:output")' "$SERVER_MSG"
assert_contains "ServerMsg declares terminal:exit" '@SerialName("terminal:exit")' "$SERVER_MSG"
assert_contains "ServerMsg declares host:uiConnection" '@SerialName("host:uiConnection")' "$SERVER_MSG"
assert_contains "ServerMsg redacts decisionCapability in toString" "decisionCapability=[REDACTED]" "$SERVER_MSG"
assert_contains "ServerMsgSerializer handles unknown kinds gracefully" "else -> ServerMsg.Unknown.serializer()" "$SERVER_MSG"

echo "=== Suite 4: REST & Live SSE Transport ==="
API_CLIENT="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt"
assert_contains "ApiClient checks owner on start" 'assertActiveOwner("GET $path")' "$API_CLIENT"
assert_contains "ApiClient checks owner on completion" 'assertActiveOwner("$method $url completion")' "$API_CLIENT"
assert_contains "ApiClient disables redirect following" "followRedirects = false" "$API_CLIENT"

API_ERRORS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiErrors.kt"
assert_contains "redactUrl strips query token" '([?&]token=)[^&]+' "$API_ERRORS"
assert_contains "redactUrl strips user-info password" '((?:https?|wss?)://[^:/@]+:)[^@]+(@)' "$API_ERRORS"
assert_contains "ApiRequestError carries status and retryAfterSeconds" "val retryAfterSeconds: Long? = null" "$API_ERRORS"

SSE_CLIENT="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/HostResourceSseClient.kt"
assert_contains "HostResourceSseClient caps data events at 256 KiB" "MAX_DATA_EVENT_BYTES = 262_144" "$SSE_CLIENT"
assert_contains "HostResourceSseClient caps control events at 4 KiB" "MAX_CONTROL_EVENT_BYTES = 4_096" "$SSE_CLIENT"
assert_contains "HostResourceSseClient pairs status with matching data revision" "lastStatus.revision == dataEvent.revision" "$SSE_CLIENT"
assert_contains "HostResourceSseClient breaks adjacency on SSE comment" "lastStatus = null" "$SSE_CLIENT"

echo "=== Suite 5: WebSocket Live Transport & Writer ==="
WS_URL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsHandshakeUrl.kt"
assert_contains "buildWsHandshakeUrl targets /ws" 'builder.encodedPath = "/ws"' "$WS_URL"
assert_contains "buildWsHandshakeUrl admits origin-less query token" 'builder.parameters["token"] = token' "$WS_URL"

WS_WRITER="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/SerializedWsWriter.kt"
assert_contains "SerializedWsWriter guards atomic pair with lock" "writeMutex.withLock" "$WS_WRITER"
assert_contains "SerializedWsWriter aborts on partial send failure" "CloseReason.Codes.PROTOCOL_ERROR" "$WS_WRITER"

WS_CORRELATOR="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRequestCorrelator.kt"
assert_contains "WsRequestCorrelator bounds max in-flight requests" "maxInFlight: Int = 256" "$WS_CORRELATOR"
assert_contains "WsRequestCorrelator cancels all on socket replacement" "cancelAllLocked" "$WS_CORRELATOR"

WS_TYPES="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsTypes.kt"
assert_contains "WsCloseCodes maps 4403 MFA required" "CLOSE_MFA_REQUIRED: Short = 4403" "$WS_TYPES"
assert_contains "WsCloseCodes maps 4401 login required" "CLOSE_FULL_LOGIN_REQUIRED: Short = 4401" "$WS_TYPES"
assert_contains "WsCloseCodes maps 1013 auth unavailable" "CLOSE_AUTH_UNAVAILABLE: Short = 1013" "$WS_TYPES"
assert_contains "WsCloseCodes maps 4001 overflow" "CLOSE_OVERFLOW: Short = 4001" "$WS_TYPES"

echo "=== Suite 6: Android Platform Network Factory ==="
ANDROID_NET="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidHttpClientFactory.kt"
assert_contains "AndroidHttpClientFactory disables redirects" "followRedirects(false)" "$ANDROID_NET"
assert_contains "AndroidHttpClientFactory configures 15s ping interval" "pingInterval(15, TimeUnit.SECONDS)" "$ANDROID_NET"
assert_contains "AndroidHttpClientFactory installs WebSockets" "install(WebSockets)" "$ANDROID_NET"

echo "============================================="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "Phase 03 Transport verification FAILED!"
    exit 1
fi
echo "Phase 03 Transport verification PASSED (100%)"

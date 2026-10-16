package dev.damhopper.nativeapp.features.editor

/**
 * Handles language service dispatch and fenced diagnostic updates for editor sessions.
 */
class EditorDiagnosticsManager(
    private val coordinator: LanguageServiceCoordinator,
    private val jsonService: JsonLanguageService,
    private val tsService: TsJsLanguageService,
    private val jsService: TsJsLanguageService,
) {
    fun triggerDiagnostics(
        profileId: String,
        session: EditorSession,
        onDiagnostics: (List<Diagnostic>) -> Unit
    ) {
        val service: LanguageService? = when {
            session.path.endsWith(".json", ignoreCase = true) -> jsonService
            session.path.endsWith(".ts", ignoreCase = true) || session.path.endsWith(".tsx", ignoreCase = true) -> tsService
            session.path.endsWith(".js", ignoreCase = true) || session.path.endsWith(".jsx", ignoreCase = true) -> jsService
            else -> null
        }
        if (service == null) return

        val reqId = coordinator.registerQualifiedRequest(
            documentKey = session.key,
            sessionIncarnation = session.sessionIncarnation,
            ownerProfileId = profileId,
            modelVersion = session.modelVersion,
            editEpoch = session.editEpoch
        )
        val req = LanguageServiceRequest(
            requestId = reqId,
            filePath = session.path,
            languageId = service.languageId,
            content = session.getText(),
            modelVersion = session.modelVersion,
            documentKey = session.key,
            sessionIncarnation = session.sessionIncarnation,
            ownerProfileId = profileId,
            editEpoch = session.editEpoch
        )
        val resp = service.validateDocument(req)
        if (coordinator.isQualifiedResponseValid(session.key, session.sessionIncarnation, profileId, resp.modelVersion, resp.editEpoch)) {
            onDiagnostics(resp.data)
        }
    }
}

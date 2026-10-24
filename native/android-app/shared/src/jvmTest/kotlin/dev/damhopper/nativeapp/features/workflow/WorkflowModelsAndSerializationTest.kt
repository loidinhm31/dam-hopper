package dev.damhopper.nativeapp.features.workflow

import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkflowModelsAndSerializationTest {

    @Test
    fun testPatchItemRequestSerializationOmittedSummary() {
        val request = PatchItemRequest(
            requestId = "req-1",
            updatedAt = "2026-09-02T10:00:00.000Z",
            title = "New title",
            summarySpecified = false,
            summary = null
        )
        val json = ProtocolJson.encodeToString(PatchItemRequest.serializer(), request)
        assertTrue(json.contains("\"requestId\":\"req-1\""))
        assertTrue(json.contains("\"updatedAt\":\"2026-09-02T10:00:00.000Z\""))
        assertTrue(json.contains("\"title\":\"New title\""))
        assertFalse(json.contains("\"summary\""))
    }

    @Test
    fun testPatchItemRequestSerializationExplicitNullSummary() {
        val request = PatchItemRequest(
            requestId = "req-2",
            updatedAt = "2026-09-02T10:00:00.000Z",
            title = null,
            summarySpecified = true,
            summary = null
        )
        val json = ProtocolJson.encodeToString(PatchItemRequest.serializer(), request)
        assertTrue(json.contains("\"requestId\":\"req-2\""))
        assertTrue(json.contains("\"summary\":null"))
        assertFalse(json.contains("\"title\""))
    }

    @Test
    fun testPatchItemRequestSerializationConcreteSummary() {
        val request = PatchItemRequest(
            requestId = "req-3",
            updatedAt = "2026-09-02T10:00:00.000Z",
            summarySpecified = true,
            summary = "Clear description",
            status = ItemStatus.IN_PROGRESS
        )
        val json = ProtocolJson.encodeToString(PatchItemRequest.serializer(), request)
        assertTrue(json.contains("\"summary\":\"Clear description\""))
        assertTrue(json.contains("\"status\":\"in_progress\""))
    }

    @Test
    fun testEnumSpellingsWorkflowVsFilePlans() {
        // Invariant: Workflow uses in_progress and canceled
        assertEquals("in_progress", ItemStatus.IN_PROGRESS.wireName)
        assertEquals("canceled", ItemStatus.CANCELED.wireName)

        // Invariant: File plans use in-progress and cancelled
        assertEquals("in-progress", PlanStatus.IN_PROGRESS.wireName)
        assertEquals("cancelled", PlanStatus.CANCELLED.wireName)
    }

    @Test
    fun testItemDtoSerializationAndPreservedCasTimestamp() {
        val rawJson = """
            {
              "id": "item-uuid-1",
              "target": { "project": "api", "worktreePath": null },
              "parentId": null,
              "kind": "plan",
              "title": "Release v1",
              "summary": "Full release",
              "status": "in_progress",
              "sortOrder": 0,
              "source": "manual",
              "createdAt": "2026-09-02T10:00:00.000Z",
              "updatedAt": "2026-09-02T10:05:00.123Z",
              "completedAt": null
            }
        """.trimIndent()

        val item = ProtocolJson.decodeFromString(ItemDto.serializer(), rawJson)
        assertEquals("item-uuid-1", item.id)
        assertEquals("api", item.target.project)
        assertNull(item.target.worktreePath)
        assertEquals(ItemKind.PLAN, item.kind)
        assertEquals(ItemStatus.IN_PROGRESS, item.status)
        assertEquals("2026-09-02T10:05:00.123Z", item.updatedAt) // Preserved verbatim
    }

    @Test
    fun testOverviewDtoDeserialization() {
        val rawJson = """
            {
              "workspace": { "id": "ws-1", "name": "my-workspace" },
              "serverTime": "2026-09-02T10:00:00.000Z",
              "projects": [
                {
                  "project": "api",
                  "target": { "project": "api" },
                  "planCount": 1,
                  "taskCount": 5,
                  "runningSessionCount": 1,
                  "lastActivityAt": "2026-09-02T09:50:00.000Z"
                }
              ],
              "plans": [
                {
                  "item": {
                    "id": "p-1",
                    "target": { "project": "api" },
                    "kind": "plan",
                    "title": "Plan 1",
                    "status": "in_progress",
                    "createdAt": "2026-09-02T09:00:00.000Z",
                    "updatedAt": "2026-09-02T09:00:00.000Z"
                  },
                  "progress": { "totalTrackedTasks": 10, "completedTrackedTasks": 4 },
                  "notes": [],
                  "activeSessions": [],
                  "children": []
                }
              ],
              "standaloneTasks": [],
              "runningSessions": [
                {
                  "id": "sess-1",
                  "target": { "project": "api" },
                  "status": "running",
                  "startedAt": "2026-09-02T09:30:00.000Z",
                  "createdAt": "2026-09-02T09:30:00.000Z",
                  "updatedAt": "2026-09-02T09:30:00.000Z"
                }
              ],
              "recentEvents": [],
              "truncated": false
            }
        """.trimIndent()

        val overview = ProtocolJson.decodeFromString(WorkflowOverviewDto.serializer(), rawJson)
        assertEquals("ws-1", overview.workspace.id)
        assertEquals(1, overview.projects.size)
        assertEquals(1, overview.plans.size)
        assertEquals("4/10 tracked tasks done", WorkflowDomainHelpers.formatTrackedTasksProgress(overview.plans.first().progress))
        assertEquals(1, overview.runningSessions.size)
        assertFalse(overview.truncated)
    }
    @Test
    fun testEventDtoNullableTarget() {
        val rawJson = """
            {
              "id": "event-1",
              "eventType": "workspace_purged",
              "source": "manual",
              "target": null,
              "occurredAt": "2026-09-02T10:00:00.000Z",
              "recordedAt": "2026-09-02T10:00:00.000Z"
            }
        """.trimIndent()

        val event = ProtocolJson.decodeFromString(EventDto.serializer(), rawJson)
        assertEquals("event-1", event.id)
        assertEquals("workspace_purged", event.eventType)
        assertNull(event.target)
    }

    @Test
    fun testDomainHelpersHierarchyAndTransitions() {
        // Hierarchy rules
        assertTrue(WorkflowDomainHelpers.isValidParentKind(null, ItemKind.PLAN))
        assertTrue(WorkflowDomainHelpers.isValidParentKind(null, ItemKind.TASK))
        assertFalse(WorkflowDomainHelpers.isValidParentKind(null, ItemKind.PHASE))

        assertTrue(WorkflowDomainHelpers.isValidParentKind(ItemKind.PLAN, ItemKind.PHASE))
        assertTrue(WorkflowDomainHelpers.isValidParentKind(ItemKind.PLAN, ItemKind.TASK))

        assertTrue(WorkflowDomainHelpers.isValidParentKind(ItemKind.PHASE, ItemKind.TASK))
        assertFalse(WorkflowDomainHelpers.isValidParentKind(ItemKind.PHASE, ItemKind.PHASE))

        assertFalse(WorkflowDomainHelpers.isValidParentKind(ItemKind.TASK, ItemKind.TASK))

        // Status transitions
        assertTrue(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.BACKLOG, ItemStatus.NEXT))
        assertTrue(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.BACKLOG, ItemStatus.IN_PROGRESS))
        assertTrue(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.BACKLOG, ItemStatus.CANCELED))
        assertFalse(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.BACKLOG, ItemStatus.DONE))

        assertTrue(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.IN_PROGRESS, ItemStatus.DONE))
        assertTrue(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.IN_PROGRESS, ItemStatus.BLOCKED))
        assertTrue(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.BLOCKED, ItemStatus.IN_PROGRESS))
        assertTrue(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.DONE, ItemStatus.IN_PROGRESS))
        assertFalse(WorkflowDomainHelpers.isValidStatusTransition(ItemStatus.DONE, ItemStatus.BLOCKED))
    }
}

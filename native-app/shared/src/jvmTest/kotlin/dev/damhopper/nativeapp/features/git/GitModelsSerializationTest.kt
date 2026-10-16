package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlin.test.*

class GitModelsSerializationTest {

    @Test
    fun testVcsRootSerialization() {
        val json = """
            {
                "rootId": ".",
                "path": ".",
                "absolutePath": "/abs/path",
                "kind": "primary",
                "status": {
                    "branch": "main",
                    "headCommit": "abc1234",
                    "isDetached": false,
                    "hasLocalChanges": true
                },
                "warnings": ["warning 1"]
            }
        """.trimIndent()
        val root = ProtocolJson.decodeFromString(VcsRoot.serializer(), json)
        assertEquals(".", root.rootId)
        assertEquals("primary", root.kind)
        assertEquals("main", root.status?.branch)
        assertTrue(root.status?.hasLocalChanges == true)
        assertEquals(1, root.warnings.size)

        val encoded = ProtocolJson.encodeToString(VcsRoot.serializer(), root)
        assertTrue(encoded.contains("\"rootId\":\".\""))
    }

    @Test
    fun testGitBranchLocalAndRefHelpers() {
        val branchLocal = GitBranch(name = "feature/alpha", isCurrent = true, isRemote = false)
        assertTrue(branchLocal.isLocal)
        assertEquals("refs/heads/feature/alpha", branchLocal.fullRef)

        val branchRemote = GitBranch(name = "origin/main", isCurrent = false, isRemote = true)
        assertFalse(branchRemote.isLocal)

        val canonicalRef = GitBranch(name = "refs/heads/main", isCurrent = false, isRemote = false)
        assertEquals("refs/heads/main", canonicalRef.fullRef)
    }

    @Test
    fun testGitLogEntryAndCommitDetails() {
        val logJson = """
            {
                "hash": "06e52d719f2bdf7fb96891b8c09d7f7a4a816cba",
                "parents": ["78be05fd4e2291fb9eb0b5f9e1cf560bc8e14f7d"],
                "authorName": "Alice Dev",
                "authorEmail": "alice@example.com",
                "timestamp": 1790000000,
                "message": "feat: initial commit",
                "refs": ["HEAD -> main"],
                "isPushed": true
            }
        """.trimIndent()
        val log = ProtocolJson.decodeFromString(GitLogEntry.serializer(), logJson)
        assertEquals("06e52d719f2bdf7fb96891b8c09d7f7a4a816cba", log.hash)
        assertTrue(log.isPushed)
        assertEquals("Alice Dev", log.authorName)

        val detailsJson = """
            {
                "hash": "06e52d719f2bdf7fb96891b8c09d7f7a4a816cba",
                "authorName": "Alice Dev",
                "authorEmail": "alice@example.com",
                "authorTimestamp": 1790000000,
                "authorTimezoneOffsetMinutes": -420,
                "committerName": "Integration Bot",
                "committerEmail": "integration@example.com",
                "committerTimestamp": 1790000100,
                "committerTimezoneOffsetMinutes": 0,
                "subject": "feat: initial commit",
                "fullMessage": "feat: initial commit\n\nFull detailed message."
            }
        """.trimIndent()
        val details = ProtocolJson.decodeFromString(GitCommitDetails.serializer(), detailsJson)
        assertEquals("feat: initial commit", details.subject)
        assertEquals(-420, details.authorTimezoneOffsetMinutes)
        assertEquals("Integration Bot", details.committerName)
    }

    @Test
    fun testGitActionResultPolymorphism() {
        val blockedJson = """
            {
                "ok": false,
                "message": "Working tree has local changes",
                "branch": "feature/git-flow",
                "dirty": true,
                "blockedReason": "dirty-worktree",
                "recommendation": "Commit or stash changes before rewrite"
            }
        """.trimIndent()
        val result = ProtocolJson.decodeFromString(GitActionResult.serializer(), blockedJson)
        assertFalse(result.ok)
        assertTrue(result.dirty)
        assertTrue(result.isBlocked)
        assertEquals("dirty-worktree", result.blockedReason)

        val rewriteSuccessJson = """
            {
                "ok": true,
                "message": "Squashed 2 commits",
                "branch": "refs/heads/feature",
                "hash": "new-squash-oid-1234",
                "oldTargetOid": "old-newest-oid",
                "newTargetOid": "new-squash-oid-1234",
                "oldHeadOid": "old-head-oid",
                "newHeadOid": "new-head-oid",
                "rewrittenCount": 3,
                "noOp": false,
                "signaturesRemoved": true
            }
        """.trimIndent()
        val rewriteRes = ProtocolJson.decodeFromString(GitActionResult.serializer(), rewriteSuccessJson)
        assertTrue(rewriteRes.ok)
        assertEquals("new-squash-oid-1234", rewriteRes.hash)
        assertEquals(3, rewriteRes.rewrittenCount)
        assertTrue(rewriteRes.signaturesRemoved)
    }

    @Test
    fun testPublishModelsSerialization() {
        val snapshot = PublishSnapshot(
            branch = "refs/heads/feature",
            sourceOid = "1111111111111111111111111111111111111111",
            remoteName = "origin",
            destinationRef = "refs/heads/feature",
            expectedRemoteOid = "2222222222222222222222222222222222222222",
        )
        val preview = PublishPreview(status = "ready", snapshot = snapshot)
        assertTrue(preview.isReady)

        val res = PublishResult(status = "published", actualRemoteOid = "1111111111111111111111111111111111111111")
        assertTrue(res.isPublished)
        assertFalse(res.isStaleRemote)

        val stale = PublishResult(status = "stale-remote", message = "Remote changed")
        assertFalse(stale.isPublished)
        assertTrue(stale.isStaleRemote)
    }
}

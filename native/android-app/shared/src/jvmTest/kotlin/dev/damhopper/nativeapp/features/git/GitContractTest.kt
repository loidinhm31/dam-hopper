package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.*

class GitContractTest {

    private val sampleOwner1 = WorkspaceFileOwner(
        profileId = "profile-1",
        baseUrl = "https://example.com/api",
        accountUser = "dev-alice",
        project = "repo-alpha",
        worktreePath = null,
    )

    private val sampleOwner2 = WorkspaceFileOwner(
        profileId = "profile-2",
        baseUrl = "https://example.com/api",
        accountUser = "dev-bob",
        project = "repo-beta",
        worktreePath = "worktrees/feature-x",
    )

    @Test
    fun testGitRequestIdentityEqualityAndFencingProperties() {
        val baseIdentity = GitRequestIdentity(
            owner = sampleOwner1,
            generation = 10L,
            root = "sub-root",
            ref = "refs/heads/main",
            search = "fix(auth)",
            offset = 0,
            sequence = 1L,
        )

        val identical = GitRequestIdentity(
            owner = sampleOwner1,
            generation = 10L,
            root = "sub-root",
            ref = "refs/heads/main",
            search = "fix(auth)",
            offset = 0,
            sequence = 1L,
        )
        assertEquals(baseIdentity, identical)
        assertEquals(baseIdentity.hashCode(), identical.hashCode())

        // Distinct owner
        assertNotEquals(baseIdentity, baseIdentity.copy(owner = sampleOwner2))

        // Distinct generation
        assertNotEquals(baseIdentity, baseIdentity.copy(generation = 11L))

        // Distinct root
        assertNotEquals(baseIdentity, baseIdentity.copy(root = null))
        assertNotEquals(baseIdentity, baseIdentity.copy(root = "other-root"))

        // Distinct ref
        assertNotEquals(baseIdentity, baseIdentity.copy(ref = "refs/heads/feature"))

        // Distinct search query
        assertNotEquals(baseIdentity, baseIdentity.copy(search = "feat(auth)"))

        // Distinct offset (pagination)
        assertNotEquals(baseIdentity, baseIdentity.copy(offset = 25))

        // Distinct sequence
        assertNotEquals(baseIdentity, baseIdentity.copy(sequence = 2L))
    }

    @Test
    fun testGitWorkspaceRelativePathWithPrimaryRoot() {
        // Empty or "." root implies root-relative path equals workspace-relative path
        assertEquals("src/main/kotlin/App.kt", gitWorkspaceRelativePath(".", "src/main/kotlin/App.kt"))
        assertEquals("src/main/kotlin/App.kt", gitWorkspaceRelativePath("", "src/main/kotlin/App.kt"))
        assertEquals("README.md", gitWorkspaceRelativePath("  ", "README.md"))
        assertEquals("docs/architecture.md", gitWorkspaceRelativePath("./", "docs/architecture.md"))

        // Separator normalization on Windows slashes
        assertEquals("src/common/File.kt", gitWorkspaceRelativePath(".", "src\\common\\File.kt"))
    }

    @Test
    fun testGitWorkspaceRelativePathWithNestedRoots() {
        // Nested subproject roots
        assertEquals(
            "packages/core/src/index.ts",
            gitWorkspaceRelativePath("packages/core", "src/index.ts")
        )
        assertEquals(
            "modules/sub/README.md",
            gitWorkspaceRelativePath("modules/sub/", "./README.md")
        )
        assertEquals(
            "nested/feature/src/test.kt",
            gitWorkspaceRelativePath("nested\\feature", "src\\test.kt")
        )

        // Traversal within root boundaries is normalized
        assertEquals(
            "modules/sub/src/App.kt",
            gitWorkspaceRelativePath("modules/sub", "other/../src/App.kt")
        )
    }

    @Test
    fun testGitWorkspaceRelativePathRejections() {
        // NUL rejection in rootPath
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("root\u0000path", "src/file.kt")
        }

        // NUL rejection in gitPath
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("root", "src/file\u0000.kt")
        }

        // Empty/blank gitPath rejection
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath(".", "")
        }
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("sub", "   ")
        }
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("sub", ".")
        }

        // Absolute path rejection (leading slash)
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath(".", "/etc/passwd")
        }
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("/var/root", "file.kt")
        }

        // Drive-letter path rejection (Windows colon)
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath(".", "C:/repo/file.kt")
        }
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("D:/repo", "file.kt")
        }

        // Traversal escaping root rejection
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("sub", "../escape.kt")
        }
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("sub/dir", "../../escape.kt")
        }
        assertFailsWith<IllegalArgumentException> {
            gitWorkspaceRelativePath("../escaping-root", "file.kt")
        }
    }

    @Test
    fun testCanonicalBranchRefsDisambiguation() {
        val localBranch = GitBranch(name = "main", isRemote = false)
        val remoteBranch = GitBranch(name = "origin/main", isRemote = true)
        val alreadyQualified = GitBranch(name = "refs/tags/v1.0.0", isRemote = false)

        assertEquals("refs/heads/main", localBranch.fullRef)
        assertEquals("refs/remotes/origin/main", remoteBranch.fullRef)
        assertEquals("refs/tags/v1.0.0", alreadyQualified.fullRef)

        val localIdentity = GitRequestIdentity(
            owner = sampleOwner1,
            generation = 1L,
            root = null,
            ref = localBranch.fullRef,
            search = "",
            offset = 0,
            sequence = 1L,
        )
        val remoteIdentity = localIdentity.copy(ref = remoteBranch.fullRef)

        assertNotEquals(localIdentity.ref, remoteIdentity.ref)
        assertEquals("refs/heads/main", localIdentity.ref)
        assertEquals("refs/remotes/origin/main", remoteIdentity.ref)
    }

    @Test
    fun testGitGraphModelsDataContract() {
        val p1 = GitGraphPoint(row = 0f, lane = 0)
        val p2 = GitGraphPoint(row = 1f, lane = 0)
        val p3 = GitGraphPoint(row = 2f, lane = 1)

        val segment1 = GitGraphSegment(
            from = p1,
            to = p2,
            parentOid = "commit-2",
            parentIndex = 0,
            unresolved = false,
        )
        val segment2 = GitGraphSegment(
            from = p2,
            to = p3,
            parentOid = "commit-3",
            parentIndex = 1,
            unresolved = true,
        )

        val row0 = GitGraphRow(
            oid = "commit-1",
            rowIndex = 0,
            lane = 0,
            segments = listOf(segment1),
        )
        val row1 = GitGraphRow(
            oid = "commit-2",
            rowIndex = 1,
            lane = 0,
            segments = listOf(segment2),
        )

        val layout = GitGraphLayout(
            rows = listOf(row0, row1),
            laneCount = 2,
        )

        assertEquals(2, layout.rows.size)
        assertEquals(2, layout.laneCount)
        assertEquals("commit-1", layout.rows[0].oid)
        assertEquals(0, layout.rows[0].lane)
        assertEquals(1, layout.rows[0].segments.size)
        assertFalse(layout.rows[0].segments[0].unresolved)
        assertTrue(layout.rows[1].segments[0].unresolved)
    }

    @Test
    fun pathAndIdentityConsumerSmoke() {
        // Consumer smoke validating helper and model usage with realistic consumer flows
        val owner = WorkspaceFileOwner(
            profileId = "prof-qa",
            baseUrl = "https://damhopper.internal/api",
            accountUser = "qa-bot",
            project = "multi-repo-root",
            worktreePath = null,
        )

        // 1. Root relative mapping across primary and nested roots
        val primaryPath = gitWorkspaceRelativePath(".", "settings.gradle.kts")
        val nestedPath = gitWorkspaceRelativePath("native/android-app", "build.gradle.kts")
        val deepPath = gitWorkspaceRelativePath("core/platform/src", "commonMain/Engine.kt")

        assertEquals("settings.gradle.kts", primaryPath)
        assertEquals("native/android-app/build.gradle.kts", nestedPath)
        assertEquals("core/platform/src/commonMain/Engine.kt", deepPath)

        // 2. Request identity creation for consumer query pagination
        val initialRequest = GitRequestIdentity(
            owner = owner,
            generation = 5L,
            root = "native/android-app",
            ref = "refs/heads/feature/focused-git",
            search = "",
            offset = 0,
            sequence = 100L,
        )
        val pagedRequest = initialRequest.copy(
            offset = 50,
            sequence = 101L,
        )
        assertNotEquals(initialRequest, pagedRequest)
        assertEquals(initialRequest.owner, pagedRequest.owner)
        assertEquals(initialRequest.root, pagedRequest.root)
        assertEquals(50, pagedRequest.offset)
        assertEquals(101L, pagedRequest.sequence)

        // 3. Graph layout consumer representation
        val graphPointA = GitGraphPoint(row = 0.0f, lane = 0)
        val graphPointB = GitGraphPoint(row = 1.0f, lane = 0)
        val commitSegment = GitGraphSegment(
            from = graphPointA,
            to = graphPointB,
            parentOid = "oid-parent-1",
            parentIndex = 0,
            unresolved = false,
        )
        val graphRow = GitGraphRow(
            oid = "oid-child-1",
            rowIndex = 0,
            lane = 0,
            segments = listOf(commitSegment),
        )
        val graphLayout = GitGraphLayout(
            rows = listOf(graphRow),
            laneCount = 1,
        )

        assertEquals(1, graphLayout.laneCount)
        assertEquals("oid-child-1", graphLayout.rows[0].oid)
        assertEquals("oid-parent-1", graphLayout.rows[0].segments[0].parentOid)
    }
}

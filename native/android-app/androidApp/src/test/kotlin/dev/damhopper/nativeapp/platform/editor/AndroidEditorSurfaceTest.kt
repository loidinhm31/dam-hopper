package dev.damhopper.nativeapp.platform.editor

import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import dev.damhopper.nativeapp.features.editor.FileTierPolicy
import io.github.rosemoe.sora.lang.EmptyLanguage
import io.github.rosemoe.sora.lang.analysis.IncrementalAnalyzeManager.LineTokenizeResult
import io.github.rosemoe.sora.lang.styling.CodeBlock
import io.github.rosemoe.sora.lang.styling.TextStyle
import io.github.rosemoe.sora.langs.java.JavaLanguage
import io.github.rosemoe.sora.widget.schemes.EditorColorScheme
import kotlin.test.assertIs
import kotlin.test.assertNull

class AndroidEditorSurfaceTest {

    private fun testOwner(): WorkspaceFileOwner = WorkspaceFileOwner(
        profileId = "profile-1",
        baseUrl = "https://127.0.0.1:4801",
        accountUser = "test-user",
        project = "project-1",
        worktreePath = null
    )

    private fun testDocId(path: String = "src/Main.java"): DocumentId = DocumentId(
        owner = testOwner(),
        relativePath = path,
        tabIncarnation = 1L
    )

    @Test
    fun testFactoryCreatesDocumentWithCorrectInitialState() {
        val factory = AndroidEditorDocumentFactory()
        val docId = testDocId()
        val doc = factory.createDocument(
            id = docId,
            initialText = "public class Main {\n}\n",
            initialMtime = 1700000000L,
            readOnly = false
        )

        assertEquals(docId, doc.id)
        assertEquals(1L, doc.revision.value)
        assertEquals(22, doc.length.value)
        assertEquals(3, doc.lineCount.value)
        assertFalse(doc.isDirty.value)
        assertFalse(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        assertFalse(doc.isReadOnly.value)

        val snapshot = doc.snapshotForSave()
        assertEquals(docId, snapshot.id)
        assertEquals(1L, snapshot.revision)
        assertEquals(1700000000L, snapshot.mtime)
        assertContentEquals("public class Main {\n}\n".encodeToByteArray(), snapshot.utf8Bytes)
        doc.close()
    }

    @Test
    fun testTextEditAndRevisionLifecycle() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "line 1\nline 2\nline 3",
            initialMtime = 1000L
        )

        assertEquals(1L, doc.revision.value)
        assertFalse(doc.isDirty.value)

        // Replace "line 2" with "line two updated" (lines are 1-indexed in applyEdit)
        doc.applyEdit(
            startLine = 2,
            startCol = 1,
            endLine = 2,
            endCol = 7,
            replacement = "line two updated"
        )

        assertEquals(2L, doc.revision.value)
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        assertFalse(doc.canRedo.value)

        val snapshot = doc.snapshotForSave()
        assertContentEquals("line 1\nline two updated\nline 3".encodeToByteArray(), snapshot.utf8Bytes)
        doc.close()
    }

    @Test
    fun testUndoRedoStackAndSavePointTracking() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "initial text",
            initialMtime = 2000L
        )

        doc.applyEdit(1, 1, 1, 8, "modified")
        assertEquals(2L, doc.revision.value)
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)

        // Mark revision 2 as saved baseline
        doc.markSaved(savedRevision = 2L, newMtime = 2100L)
        assertFalse(doc.isDirty.value)

        // Undo edit -> reverts to initial text, revision revisits 1L, dirty is true because != saved revision (2L)
        doc.undo()
        assertFalse(doc.canUndo.value)
        assertTrue(doc.canRedo.value)
        assertTrue(doc.isDirty.value)
        assertContentEquals("initial text".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)

        // Redo edit -> restored to revision 2L, dirty becomes false
        doc.redo()
        assertTrue(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        assertFalse(doc.isDirty.value)
        assertContentEquals("modified text".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        doc.close()
    }

    @Test
    fun testNativeContentUndoUpdatesRevisionAndDirtyState() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "base text",
            initialMtime = 1000L
        )

        doc.applyEdit(1, 1, 1, 5, "updated")
        assertEquals(2L, doc.revision.value)
        assertTrue(doc.isDirty.value)

        // Mark revision 2 as saved baseline
        doc.markSaved(2L, 1100L)
        assertFalse(doc.isDirty.value)

        // Native widget calling content.undo() directly (bypassing doc.undo())
        assertTrue(doc.content.canUndo())
        doc.content.undo()
        // Verify state is published even when triggered directly from native Content
        assertEquals(1L, doc.revision.value)
        assertTrue(doc.isDirty.value)
        assertFalse(doc.canUndo.value)
        assertTrue(doc.canRedo.value)

        // Native widget calling content.redo() directly
        doc.content.redo()
        assertEquals(2L, doc.revision.value)
        assertFalse(doc.isDirty.value)
        assertTrue(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        doc.close()
    }

    @Test
    fun testReadOnlyGuard() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "readonly content",
            initialMtime = 3000L,
            readOnly = true
        )

        assertTrue(doc.isReadOnly.value)
        doc.applyEdit(1, 1, 1, 9, "writable")

        // Content unchanged
        assertContentEquals("readonly content".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        assertEquals(1L, doc.revision.value)
        assertFalse(doc.isDirty.value)

        // Unlocking readOnly allows editing
        doc.setReadOnly(false)
        assertFalse(doc.isReadOnly.value)
        doc.applyEdit(1, 1, 1, 9, "writable")
        assertContentEquals("writable content".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        assertTrue(doc.isDirty.value)
        doc.close()
    }

    @Test
    fun testReplaceFromLoadResetsUndoAndEstablishesBaseline() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "old text",
            initialMtime = 4000L
        )

        doc.applyEdit(1, 1, 1, 4, "edited")
        assertTrue(doc.isDirty.value)
        assertTrue(doc.canUndo.value)

        // Programmatic replace from reload
        doc.replaceFromLoad(text = "reloaded fresh content from server", expectedMtime = 4500L)

        assertFalse(doc.isDirty.value)
        assertFalse(doc.canUndo.value)
        assertFalse(doc.canRedo.value)
        assertContentEquals("reloaded fresh content from server".encodeToByteArray(), doc.snapshotForSave().utf8Bytes)
        assertEquals(4500L, doc.snapshotForSave().mtime)
        doc.close()
    }

    @Test
    fun testBudgetMetricsAccounting() {
        val doc = AndroidEditorDocument(
            id = testDocId(),
            initialText = "short",
            initialMtime = 5000L,
            maxUndoStackSize = 50,
            maxUndoBytes = 1024L
        )

        val metrics0 = doc.getBudgetMetrics()
        assertEquals(5L, metrics0.utf8Length)
        assertEquals(0L, metrics0.undoStackBytes)
        assertEquals(0, metrics0.undoStackSize)

        doc.applyEdit(1, 1, 1, 6, "longer text for metrics")
        val metrics1 = doc.getBudgetMetrics()
        assertEquals(23L, metrics1.utf8Length)
        assertTrue(metrics1.undoStackBytes > 0L)
        assertEquals(1, metrics1.undoStackSize)
        doc.close()
    }

    // ---- UniversalLanguage ------------------------------------------------------------------

    private class Lexed(val lines: List<String>, val results: List<LineTokenizeResult<Int, Token>>) {
        fun tokens(line: Int): List<Token> = results[line].tokens

        /** Style id covering the first occurrence of [needle] on [line]. */
        fun colorOf(line: Int, needle: String): Int {
            val column = lines[line].indexOf(needle)
            assertTrue(column >= 0, "'$needle' not found on line $line: ${lines[line]}")
            return tokens(line).first { it.start <= column && column < it.end }.colorId
        }
    }

    private fun managerFor(filename: String): UniversalAnalyzeManager {
        val language = UniversalLanguage.forFile(filename)
        assertIs<UniversalLanguage>(language)
        return language.getAnalyzeManager() as UniversalAnalyzeManager
    }

    private fun lex(filename: String, text: String): Lexed {
        val manager = managerFor(filename)
        val lines = text.split('\n')
        var state = manager.getInitialState()
        val results = lines.mapIndexed { index, line ->
            manager.tokenizeLine(line, state, index).also { state = it.state }
        }
        return Lexed(lines, results)
    }

    private class ExpectedStructure(val blocks: List<CodeBlock>, val pairs: List<Pair<Int, Int>>)

    private fun structure(filename: String, text: String, isActive: () -> Boolean = { true }): ExpectedStructure? {
        val language = UniversalLanguage.forFile(filename)
        assertIs<UniversalLanguage>(language)
        val lexed = lex(filename, text)
        val source = object : StructureSource {
            override val lineCount: Int get() = lexed.lines.size
            override fun tokens(line: Int): List<Token>? = lexed.tokens(line)
            override fun stateAfter(line: Int): Int? = lexed.results[line].state
            override fun lineLength(line: Int): Int = lexed.lines[line].length
            override fun lineBreakLength(line: Int): Int = if (line < lexed.lines.lastIndex) 1 else 0
            override fun firstContentColumn(line: Int): Int = lexed.lines[line].indexOfFirst { !it.isWhitespace() }
        }
        val pairs = ArrayList<Pair<Int, Int>>()
        val blocks = computeStructure(language.spec, source, isActive) { open, close -> pairs.add(open to close) }
            ?: return null
        return ExpectedStructure(blocks, pairs)
    }

    @Test
    fun testForFileRecognizesLanguagesAndFallsBackToEmpty() {
        val expected = mapOf(
            "Main.kt" to Dialect.KOTLIN,
            "build.gradle.kts" to Dialect.KOTLIN,
            "src/App.java" to Dialect.JAVA,
            "app.js" to Dialect.JAVASCRIPT,
            "app.mjs" to Dialect.JAVASCRIPT,
            "view.tsx" to Dialect.TYPESCRIPT,
            "lib.rs" to Dialect.RUST,
            "data.json" to Dialect.JSON,
            "tool.py" to Dialect.PYTHON,
            "run.sh" to Dialect.SHELL,
            "run.bash" to Dialect.SHELL,
            "Cargo.toml" to Dialect.TOML,
            "ci.yml" to Dialect.YAML,
            "ci.yaml" to Dialect.YAML,
            "README.md" to Dialect.MARKDOWN,
            "Dockerfile" to Dialect.DOCKERFILE,
            "docker/Dockerfile" to Dialect.DOCKERFILE,
            "Dockerfile.dev" to Dialect.DOCKERFILE,
            "web.dockerfile" to Dialect.DOCKERFILE,
        )
        for ((name, dialect) in expected) {
            val language = UniversalLanguage.forFile(name)
            assertIs<UniversalLanguage>(language, name)
            assertEquals(dialect, language.dialect, name)
        }
        for (name in listOf("data.xyz", "Makefile", "noextension", "archive.tar.gz")) {
            assertIs<EmptyLanguage>(UniversalLanguage.forFile(name), name)
        }
    }

    @Test
    fun testKotlinTokens() {
        val lexed = lex("Main.kt", "fun main() { val x = 42 + y // note\n    val s = \"text\"\n}")
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "fun"))
        assertEquals(EditorColorScheme.FUNCTION_NAME, lexed.colorOf(0, "main"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "val"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(0, "42"))
        assertEquals(EditorColorScheme.OPERATOR, lexed.colorOf(0, "+"))
        assertEquals(EditorColorScheme.TEXT_NORMAL, lexed.colorOf(0, "y"))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(0, "// note"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(1, "\"text\""))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(1, "text"))
    }

    @Test
    fun testPythonTokensAndTripleQuoteState() {
        val lexed = lex(
            "tool.py",
            "@cache\ndef run(x):  # go\n    s = \"\"\"doc\n    body\n    \"\"\"\n    return None",
        )
        assertEquals(EditorColorScheme.ANNOTATION, lexed.colorOf(0, "@cache"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(1, "def"))
        assertEquals(EditorColorScheme.FUNCTION_NAME, lexed.colorOf(1, "run"))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(1, "# go"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(2, "doc"))
        assertEquals(LexState.STRING, LexState.mode(lexed.results[2].state))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(3, "body"))
        assertEquals(LexState.NORMAL, LexState.mode(lexed.results[4].state))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(5, "return"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(5, "None"))
    }

    @Test
    fun testTypeScriptTemplateLiteralSpansLines() {
        val lexed = lex("view.ts", "const a: string = `one\ntwo ${'$'}{x}\nthree`; // end")
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "const"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "string"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(0, "one"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(1, "two"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(2, "three"))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(2, "// end"))
        assertEquals(LexState.NORMAL, LexState.mode(lexed.results[2].state))
    }

    @Test
    fun testRustRawStringLifetimeAndMacro() {
        val lexed = lex(
            "lib.rs",
            "fn show<'a>(s: &'a str) { println!(\"x\"); let r = r#\"a\"b\"#; let c = 'z'; } /* a /* b */ c */",
        )
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "fn"))
        assertEquals(EditorColorScheme.ANNOTATION, lexed.colorOf(0, "'a str"))
        assertEquals(EditorColorScheme.FUNCTION_NAME, lexed.colorOf(0, "println"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(0, "\"x\""))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(0, "r#\"a\"b\"#"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(0, "'z'"))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(0, "c */"))
        assertEquals(LexState.NORMAL, LexState.mode(lexed.results[0].state))
    }

    @Test
    fun testJsonKeysAndValues() {
        val lexed = lex("data.json", "{\"key\": \"value\", \"n\": -1.5, \"ok\": true, \"none\": null}")
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "\"key\""))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(0, "\"value\""))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(0, "1.5"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(0, "true"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(0, "null"))
    }

    @Test
    fun testShellTokens() {
        val lexed = lex("run.sh", "if [ -n \"\$X\" ]; then echo \$HOME \${PATH}; fi # done\necho it's#fine")
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "if"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "then"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(0, "\"\$X\""))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(0, "\$HOME"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(0, "\${PATH}"))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(0, "# done"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(1, "'s#fine"))
    }

    @Test
    fun testTomlTokens() {
        val lexed = lex("Cargo.toml", "[package]\nname = \"demo\" # c\nport = 8080\nok = true")
        assertEquals(EditorColorScheme.ANNOTATION, lexed.colorOf(0, "[package]"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(1, "name"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(1, "\"demo\""))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(1, "# c"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(2, "port"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(2, "8080"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(3, "true"))
    }

    @Test
    fun testYamlTokens() {
        val lexed = lex("ci.yml", "name: demo # c\nitems:\n  - key: 'v'\n  - don't stop\nenabled: true")
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "name"))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(0, "# c"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(1, "items"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(2, "key"))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(2, "'v'"))
        // An apostrophe inside a plain scalar must not open a string.
        assertEquals(EditorColorScheme.TEXT_NORMAL, lexed.colorOf(3, "stop"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(4, "true"))
    }

    @Test
    fun testMarkdownTokensAndFenceState() {
        val lexed = lex("README.md", "# Title\ntext `code` and **bold**\n- item\n```kotlin\nval x = 1\n```\nafter")
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "Title"))
        assertTrue(lexed.tokens(0).all { it.bold })
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(1, "code"))
        assertEquals(EditorColorScheme.TEXT_NORMAL, lexed.colorOf(1, "bold"))
        assertTrue(lexed.tokens(1).any { it.bold })
        assertEquals(EditorColorScheme.ANNOTATION, lexed.colorOf(2, "-"))
        assertEquals(LexState.FENCE, LexState.mode(lexed.results[3].state))
        assertEquals(EditorColorScheme.LITERAL, lexed.colorOf(4, "val"))
        assertEquals(LexState.NORMAL, LexState.mode(lexed.results[5].state))
        assertEquals(EditorColorScheme.TEXT_NORMAL, lexed.colorOf(6, "after"))
    }

    @Test
    fun testDockerfileTokensAndContinuation() {
        val lexed = lex(
            "Dockerfile",
            "FROM node:20 AS build\nrun apt-get \\\n  COPY x\n# comment\nENV A=\$B",
        )
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "FROM"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(0, "AS"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(1, "run"))
        assertEquals(LexState.CONTINUATION, LexState.mode(lexed.results[1].state))
        // Continuation lines never start a new instruction.
        assertEquals(EditorColorScheme.TEXT_NORMAL, lexed.colorOf(2, "COPY"))
        assertEquals(EditorColorScheme.COMMENT, lexed.colorOf(3, "# comment"))
        assertEquals(EditorColorScheme.KEYWORD, lexed.colorOf(4, "ENV"))
        assertEquals(EditorColorScheme.IDENTIFIER_VAR, lexed.colorOf(4, "\$B"))
    }

    @Test
    fun testMultilineStatePropagationAcrossIncrementalEdit() {
        val manager = managerFor("Main.kt")
        val initial = manager.getInitialState()
        val first = manager.tokenizeLine("/* start /* nested", initial, 0)
        assertEquals(LexState.BLOCK_COMMENT, LexState.mode(first.state))
        assertEquals(2, LexState.depth(first.state))

        val second = manager.tokenizeLine("middle */", first.state, 1)
        assertEquals(LexState.BLOCK_COMMENT, LexState.mode(second.state))
        assertEquals(1, LexState.depth(second.state))
        assertTrue(second.tokens.all { it.colorId == EditorColorScheme.COMMENT })

        val third = manager.tokenizeLine("*/ val x", second.state, 2)
        assertEquals(LexState.NORMAL, LexState.mode(third.state))
        assertEquals(EditorColorScheme.COMMENT, third.tokens.first().colorId)
        assertTrue(third.tokens.any { it.colorId == EditorColorScheme.KEYWORD })

        // Editing line 1 to close the remaining comment changes its outgoing state, so the
        // incremental driver must re-lex line 2 with the new incoming state.
        val editedSecond = manager.tokenizeLine("middle */ */", first.state, 1)
        assertFalse(manager.stateEquals(second.state, editedSecond.state))
        assertEquals(LexState.NORMAL, LexState.mode(editedSecond.state))
        val relexedThird = manager.tokenizeLine("*/ val x", editedSecond.state, 2)
        assertEquals(EditorColorScheme.OPERATOR, relexedThird.tokens.first().colorId)
        assertTrue(manager.stateEquals(third.state, relexedThird.state))
    }

    @Test
    fun testLongLinesPreserveOutgoingStateWithSingleSpan() {
        val manager = managerFor("Main.kt")
        val initial = manager.getInitialState()
        val filler = "a".repeat(LONG_LINE_CHARS + 1)

        val normal = manager.tokenizeLine("val a = 1 /* open", initial, 0)
        assertTrue(normal.tokens.size > 1)

        val longOpen = manager.tokenizeLine("$filler /* open", initial, 0)
        assertEquals(1, longOpen.tokens.size)
        assertEquals(Token(0, filler.length + 8, EditorColorScheme.TEXT_NORMAL), longOpen.tokens.single())
        assertEquals(LexState.BLOCK_COMMENT, LexState.mode(longOpen.state))
        val spans = manager.generateSpansForLine(longOpen)
        assertEquals(1, spans.size)
        assertEquals(0, spans[0].column)
        assertEquals(EditorColorScheme.TEXT_NORMAL, TextStyle.getForegroundColorId(spans[0].style))

        val after = manager.tokenizeLine("*/ val x", longOpen.state, 1)
        assertEquals(EditorColorScheme.COMMENT, after.tokens.first().colorId)
        assertTrue(after.tokens.any { it.colorId == EditorColorScheme.KEYWORD })

        // A long line that closes an incoming comment and reopens a string keeps that state too.
        val longClose = manager.tokenizeLine("$filler */ \"open", longOpen.state, 1)
        assertEquals(1, longClose.tokens.size)
        assertEquals(LexState.NORMAL, LexState.mode(longClose.state))

        val longString = manager.tokenizeLine("\"\"\"$filler", initial, 0)
        assertEquals(LexState.STRING, LexState.mode(longString.state))
        assertEquals(LexState.NORMAL, LexState.mode(manager.tokenizeLine("\"\"\"$filler\"\"\"", initial, 0).state))

        // Exactly at the limit the line is still tokenized normally.
        val atLimit = manager.tokenizeLine("a".repeat(LONG_LINE_CHARS - 3) + " 12", initial, 0)
        assertTrue(atLimit.tokens.size > 1)
    }

    @Test
    fun testLongLineStateOnlyPathMatchesFullScan() {
        val manager = managerFor("tool.py")
        val initial = manager.getInitialState()
        val filler = "x".repeat(LONG_LINE_CHARS + 1)
        // Triple quote opened on a long line survives into the next line and closes there.
        val open = manager.tokenizeLine("s = '''$filler", initial, 0)
        assertEquals(LexState.STRING, LexState.mode(open.state))
        val close = manager.tokenizeLine("tail''' + 1", open.state, 1)
        assertEquals(LexState.NORMAL, LexState.mode(close.state))
        assertEquals(EditorColorScheme.LITERAL, close.tokens.first().colorId)
        // A closed triple quote on a long line leaves the next line in normal state.
        val closed = manager.tokenizeLine("s = '''$filler'''", initial, 0)
        assertEquals(LexState.NORMAL, LexState.mode(closed.state))
    }

    @Test
    fun testBracketPairsIgnoreStringsAndComments() {
        val text = listOf(
            "fun f() {",
            "    val s = \"} ) {\" // { ( [",
            "    /* ( */",
            "    if (x) {",
            "    }",
            "}",
        ).joinToString("\n")
        val result = assertNotNull(structure("Main.kt", text))

        assertEquals(4, result.pairs.size)
        for ((open, close) in result.pairs) {
            val pair = "${text[open]}${text[close]}"
            assertTrue(pair == "()" || pair == "{}", "unexpected pair $pair")
        }
        val commentAndStringStart = text.indexOf("\"} ) {\"")
        val commentEnd = text.indexOf("/* ( */") + "/* ( */".length
        assertTrue(result.pairs.none { (open, close) ->
            open in commentAndStringStart until commentEnd || close in commentAndStringStart until commentEnd
        })
        val spans = result.blocks.map { it.startLine to it.endLine }
        assertEquals(listOf(3 to 4, 0 to 5), spans)
    }

    @Test
    fun testUnbalancedBracketsRecoverWithoutPairingAcrossMismatch() {
        val text = "a(b[c)\n}\nd{e}"
        val result = assertNotNull(structure("Main.kt", text))
        val pairs = result.pairs.map { (open, close) -> "${text[open]}${text[close]}" }
        assertEquals(listOf("()", "{}"), pairs)
    }

    @Test
    fun testIndentationBlocksForPythonAndYaml() {
        val python = assertNotNull(
            structure("a.py", "def a():\n    x = 1\n    if x:\n        pass\n    # note\ny = 2"),
        )
        assertEquals(listOf(2 to 3, 0 to 3), python.blocks.map { it.startLine to it.endLine })

        val docstring = assertNotNull(
            structure("a.py", "def f():\n    \"\"\"doc\n  odd\n    \"\"\"\n    return 1"),
        )
        assertEquals(listOf(0 to 4), docstring.blocks.map { it.startLine to it.endLine })

        val yaml = assertNotNull(structure("a.yml", "a:\n  b: 1\n  c:\n    d: 2\ne: 3"))
        assertEquals(listOf(2 to 3, 0 to 3), yaml.blocks.map { it.startLine to it.endLine })
    }

    @Test
    fun testStructureAbortsWhenCancelled() {
        var polls = 0
        val result = structure("Main.kt", "{\n}\n{\n}") { ++polls < 3 }
        assertNull(result)
        assertEquals(3, polls)
    }

    // ---- Degradation-first language selection -----------------------------------------------

    @Test
    fun testDegradedFilesFallBackToEmptyLanguage() {
        assertIs<EmptyLanguage>(editorLanguageFor("src/Main.java", degraded = true))
        assertIs<EmptyLanguage>(editorLanguageFor("tool.py", degraded = true))
        assertIs<EmptyLanguage>(editorLanguageFor("unknown.xyz", degraded = false))
        assertIs<UniversalLanguage>(editorLanguageFor("tool.py", degraded = false))
        assertIs<JavaLanguage>(editorLanguageFor("src/Main.java", degraded = false))
    }

    @Test
    fun testUtf8MetricsCountBytesNotChars() {
        val doc = AndroidEditorDocument(id = testDocId("a.kt"), initialText = "a\u00e9\uD83D\uDE00", initialMtime = 1L)
        assertEquals(1L + 2L + 4L, doc.getBudgetMetrics().utf8Length)
        doc.applyEdit(1, 2, 1, 3, "")
        assertEquals(1L + 4L, doc.getBudgetMetrics().utf8Length)
        doc.undo()
        assertEquals(1L + 2L + 4L, doc.getBudgetMetrics().utf8Length)
        doc.replaceFromLoad("plain", 2L)
        assertEquals(5L, doc.getBudgetMetrics().utf8Length)
        assertEquals(doc.snapshotForSave().utf8Bytes.size.toLong(), doc.getBudgetMetrics().utf8Length)
        doc.close()
    }

    @Test
    fun testLanguageReassessmentFollowsUtf8BytesNotCharCount() {
        val limit = FileTierPolicy.NORMAL_MAX_BYTES
        val chars = (limit / 3).toInt() + 1 // 349_526 three-byte chars = 1 MiB + 2 bytes
        val doc = AndroidEditorDocument(id = testDocId("src/big.kt"), initialText = "a".repeat(chars), initialMtime = 1L)
        val gate = EditorLanguageGate(doc)
        assertIs<UniversalLanguage>(gate.initialLanguage())
        assertNull(gate.reassess())

        // Same UTF-16 length, but 3 bytes per char: crosses the 1 MiB boundary.
        doc.applyEdit(1, 1, 1, chars + 1, "\u3042".repeat(chars))
        assertEquals(chars, doc.length.value)
        assertEquals(chars * 3L, doc.getBudgetMetrics().utf8Length)
        assertTrue(doc.getBudgetMetrics().utf8Length > limit)
        assertIs<EmptyLanguage>(gate.reassess())
        assertNull(gate.reassess())

        // Typing while degraded does not reinstall anything.
        doc.applyEdit(1, 1, 1, 1, "x")
        assertNull(gate.reassess())

        // Back under the limit with the same char count flips again.
        doc.applyEdit(1, 1, 1, chars + 2, "a".repeat(chars))
        assertIs<UniversalLanguage>(gate.reassess())
        assertNull(gate.reassess())
        doc.close()
    }

    @Test
    fun testExactlyOneMebibyteIsNotDegraded() {
        val limit = FileTierPolicy.NORMAL_MAX_BYTES.toInt()
        val threeByteChars = (limit - 1) / 3 // 349_525 three-byte chars = limit - 1 bytes; one ASCII char reaches limit
        val ascii = limit - threeByteChars * 3
        val doc = AndroidEditorDocument(
            id = testDocId("a.java"),
            initialText = "\u3042".repeat(threeByteChars) + "a".repeat(ascii),
            initialMtime = 1L,
        )
        assertEquals(limit.toLong(), doc.getBudgetMetrics().utf8Length)
        val gate = EditorLanguageGate(doc)
        assertIs<JavaLanguage>(gate.initialLanguage())
        doc.applyEdit(1, 1, 1, 1, "b")
        assertIs<EmptyLanguage>(gate.reassess())
        doc.close()
    }

    @Test
    fun testLiveFontChangeIsAppliedOncePerChangeWithoutTouchingTheDocument() {
        assertNull(editorFontSizeToApply(applied = 14, requested = 14), "an unchanged size causes no relayout")
        assertEquals(16, editorFontSizeToApply(applied = 14, requested = 16))
        assertEquals(14, editorFontSizeToApply(applied = -1, requested = 14), "first application after attach")
        val doc = AndroidEditorDocument(id = testDocId("a.kt"), initialText = "val x = 1", initialMtime = 1L)
        val revision = doc.revision.value
        editorFontSizeToApply(applied = 14, requested = 20)
        assertEquals(revision, doc.revision.value, "a font change never edits or recreates the document")
        doc.close()
    }
}

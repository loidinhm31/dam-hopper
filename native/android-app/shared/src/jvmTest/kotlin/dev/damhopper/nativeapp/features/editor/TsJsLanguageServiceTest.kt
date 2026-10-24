package dev.damhopper.nativeapp.features.editor

import kotlin.test.*

class TsJsLanguageServiceTest {

    private val service = TsJsLanguageService("typescript")

    @Test
    fun testValidTypeScriptProducesNoDiagnostics() {
        val code = """
            import { useState } from 'react';
            const fetchUrl = "http://localhost:4801/api";
            const globPattern = "**/*.ts";
            function greet(name: string): string {
                return `Hello, ${'$'}{name}!`;
            }
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 1L,
            filePath = "App.tsx",
            languageId = "typescript",
            content = code,
            modelVersion = 1L
        )

        val resp = service.validateDocument(req)
        assertTrue(resp.data.isEmpty(), "Valid TS code with URLs, globs, and templates should produce zero diagnostics")
    }

    @Test
    fun testGlobStringDoesNotSwallowSubsequentUnclosedBrace() {
        // Glob pattern "**/*.ts" contains "/*" which must NOT be treated as a block comment
        val code = """
            const globPattern = "**/*.ts";
            function broken() {
                const x = 1;
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 1L,
            filePath = "brokenGlob.ts",
            languageId = "typescript",
            content = code,
            modelVersion = 1L
        )

        val resp = service.validateDocument(req)
        assertEquals(1, resp.data.size, "Must detect unclosed brace even when a glob string contains '/*'")
        assertTrue(resp.data[0].message.contains("Unclosed opening delimiter '{'"))
    }

    @Test
    fun testUrlStringDoesNotSwallowSubsequentUnclosedDelimiter() {
        // URL "http://x" contains "//" which must NOT be treated as a line comment
        val code = """
            const url = "http://localhost:4801";
            foo(
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 1L,
            filePath = "brokenUrl.ts",
            languageId = "typescript",
            content = code,
            modelVersion = 1L
        )

        val resp = service.validateDocument(req)
        assertEquals(1, resp.data.size, "Must detect unclosed delimiter even after URL string containing '//'")
        assertTrue(resp.data[0].message.contains("Unclosed opening delimiter '('"))
    }

    @Test
    fun testSameLineUrlDoesNotSwallowTrailingDelimiter() {
        val code = """const u = "http://x"; foo("""
        val req = LanguageServiceRequest(
            requestId = 1L, filePath = "sameLine.ts", languageId = "typescript", content = code, modelVersion = 1L
        )
        val resp = service.validateDocument(req)
        assertEquals(1, resp.data.size, "Must detect unclosed '(' on same line after URL string")
        assertTrue(resp.data[0].message.contains("Unclosed opening delimiter '('"))
    }

    @Test
    fun testEscapedCharsInsideBlockCommentDoNotBreakClosure() {
        val code = """
            /* a\*b */
            function broken() {
        """.trimIndent()
        val req = LanguageServiceRequest(
            requestId = 1L, filePath = "escapedComment.ts", languageId = "typescript", content = code, modelVersion = 1L
        )
        val resp = service.validateDocument(req)
        assertEquals(1, resp.data.size, "Must close block comment even with backslashes and detect unclosed '{'")
        assertTrue(resp.data[0].message.contains("Unclosed opening delimiter '{'"))
    }

    @Test
    fun testUnmatchedClosingDelimiterProducesHeuristicDiagnostic() {
        val code = """
            function broken() {
                return 1;
            }}
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 1L,
            filePath = "broken.ts",
            languageId = "typescript",
            content = code,
            modelVersion = 1L
        )

        val resp = service.validateDocument(req)
        assertEquals(1, resp.data.size)
        assertTrue(resp.data[0].message.contains("Unmatched closing brace '}'"))
        assertEquals("typescript-syntax-heuristic", resp.data[0].source)
    }

    @Test
    fun testKeywordsCompletion() {
        val req = LanguageServiceRequest(
            requestId = 1L,
            filePath = "test.ts",
            languageId = "typescript",
            content = "con",
            modelVersion = 1L
        )

        val resp = service.getCompletions(req, 1, 3)
        assertTrue(resp.data.any { it.label == "const" })
        assertTrue(resp.data.any { it.label == "interface" })
    }

    @Test
    fun testSymbolExtraction() {
        val code = """
            export interface User { id: string; }
            export function getUser(): User { return { id: "1" }; }
            const MAX_RETRIES = 3;
        """.trimIndent()

        val req = LanguageServiceRequest(
            requestId = 1L,
            filePath = "user.ts",
            languageId = "typescript",
            content = code,
            modelVersion = 1L
        )

        val resp = service.getSymbols(req)
        assertEquals(3, resp.data.size)
        assertEquals("User", resp.data[0].name)
        assertEquals("interface", resp.data[0].kind)
        assertEquals("getUser", resp.data[1].name)
        assertEquals("function", resp.data[1].kind)
        assertEquals("MAX_RETRIES", resp.data[2].name)
        assertEquals("const", resp.data[2].kind)
    }
}

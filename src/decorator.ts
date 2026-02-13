import * as vscode from 'vscode';

// Matches a line that is a /// doc comment.
// Group 1: leading whitespace
// Group 2: the /// prefix
// Group 3: everything after /// (may be undefined for bare /// lines)
const docLineRegex = /^(\s*)(\/\/\/)(.*)?$/;

// Matches a line that is a // MARK: comment (Xcode-like).
// Group 1: leading whitespace
// Group 2: the // prefix
// Group 3: everything after // that begins with MARK:
const markLineRegex = /^(\s*)(\/\/)(\s*MARK:(?=\s|$|-).*)$/;

// Matches "- Parameter name:" form (singular, with an explicit parameter name).
// Groups: (prefix)(Parameter)(space)(name)(colon+space)(description)
const singleParamRegex = /^(\s*-\s+)(Parameter)(\s+)(\w+)(\s*:\s*)(.*)/i;

// Matches "- Word:" form (section headers like Returns:, or parameter names under Parameters:).
// Groups: (prefix)(word)(colon+space)(description)
const keywordLineRegex = /^(\s*-\s+)(\w+)(\s*:\s*)(.*)/;

// All recognized Swift documentation callout keywords (lowercase for comparison).
const KNOWN_TAGS = new Set([
    'attention', 'author', 'authors', 'bug', 'complexity', 'copyright',
    'date', 'experiment', 'important', 'invariant', 'note', 'parameter',
    'parameters', 'postcondition', 'precondition', 'remark', 'remarks',
    'requires', 'returns', 'seealso', 'since', 'tag', 'throws', 'todo',
    'version', 'warning',
]);

// Captures leading whitespace from the text after ///.
const leadingSpaceRegex = /^(\s+)/;

interface DocCommentSegments {
    slashRange: vscode.Range;
    indentRanges: vscode.Range[];
    textRanges: vscode.Range[];
    codeRanges: vscode.Range[];
    keywordRanges: vscode.Range[];
    boldRanges: vscode.Range[];
    italicRanges: vscode.Range[];
    boldItalicRanges: vscode.Range[];
}

interface InlineSegment {
    lineNum: number;
    startCol: number;
    text: string;
}

interface DocBlockSegments {
    slashRanges: vscode.Range[];
    indentRanges: vscode.Range[];
    textRanges: vscode.Range[];
    codeRanges: vscode.Range[];
    keywordRanges: vscode.Range[];
    markdownMarkerRanges: vscode.Range[];
    boldRanges: vscode.Range[];
    italicRanges: vscode.Range[];
    boldItalicRanges: vscode.Range[];
}

type EmphasisKind = 'text' | 'bold' | 'italic' | 'boldItalic';

interface EmphasisMarker {
    marker: string;
    addsBold: boolean;
    addsItalic: boolean;
}

export class DocstringDecorator {
    private slashDecoration: vscode.TextEditorDecorationType;
    private indentDecoration: vscode.TextEditorDecorationType;
    private textDecoration: vscode.TextEditorDecorationType;
    private codeDecoration: vscode.TextEditorDecorationType;
    private regularCommentInlineCodeColorDecoration: vscode.TextEditorDecorationType;
    private keywordDecoration: vscode.TextEditorDecorationType;
    private markdownMarkerDecoration: vscode.TextEditorDecorationType;
    private boldDecoration: vscode.TextEditorDecorationType;
    private italicDecoration: vscode.TextEditorDecorationType;
    private boldItalicDecoration: vscode.TextEditorDecorationType;
    private markDecoration: vscode.TextEditorDecorationType;

    constructor() {
        const config = vscode.workspace.getConfiguration('swiftDocstrings');
        const types = this.buildDecorationTypes(config);
        this.slashDecoration = types.slashDeco;
        this.indentDecoration = types.indentDeco;
        this.textDecoration = types.textDeco;
        this.codeDecoration = types.codeDeco;
        this.regularCommentInlineCodeColorDecoration = types.regularCommentInlineCodeColorDeco;
        this.keywordDecoration = types.keywordDeco;
        this.markdownMarkerDecoration = types.markdownMarkerDeco;
        this.boldDecoration = types.boldDeco;
        this.italicDecoration = types.italicDeco;
        this.boldItalicDecoration = types.boldItalicDeco;
        this.markDecoration = types.markDeco;
    }

    /**
     * Rebuild decoration types from configuration. Call this when settings change.
     */
    rebuildDecorations(): void {
        this.slashDecoration.dispose();
        this.indentDecoration.dispose();
        this.textDecoration.dispose();
        this.codeDecoration.dispose();
        this.regularCommentInlineCodeColorDecoration.dispose();
        this.keywordDecoration.dispose();
        this.markdownMarkerDecoration.dispose();
        this.boldDecoration.dispose();
        this.italicDecoration.dispose();
        this.boldItalicDecoration.dispose();
        this.markDecoration.dispose();

        const config = vscode.workspace.getConfiguration('swiftDocstrings');
        const types = this.buildDecorationTypes(config);
        this.slashDecoration = types.slashDeco;
        this.indentDecoration = types.indentDeco;
        this.textDecoration = types.textDeco;
        this.codeDecoration = types.codeDeco;
        this.regularCommentInlineCodeColorDecoration = types.regularCommentInlineCodeColorDeco;
        this.keywordDecoration = types.keywordDeco;
        this.markdownMarkerDecoration = types.markdownMarkerDeco;
        this.boldDecoration = types.boldDeco;
        this.italicDecoration = types.italicDeco;
        this.boldItalicDecoration = types.boldItalicDeco;
        this.markDecoration = types.markDeco;
    }

    /**
     * Parse the document and apply decorations to all /// doc comment lines.
     */
    applyDecorations(editor: vscode.TextEditor): void {
        const config = vscode.workspace.getConfiguration('swiftDocstrings');
        if (!config.get<boolean>('enabled', true)) {
            this.clearDecorations(editor);
            return;
        }

        const document = editor.document;
        if (document.languageId !== 'swift') {
            return;
        }

        const boldMarkLines = config.get<boolean>('boldMarkLines', true);
        const codeColor = config.get<string>('codeColor', '') || undefined;

        const slashRanges: vscode.Range[] = [];
        const indentRanges: vscode.Range[] = [];
        const textRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];
        const keywordRanges: vscode.Range[] = [];
        const markdownMarkerRanges: vscode.Range[] = [];
        const boldRanges: vscode.Range[] = [];
        const italicRanges: vscode.Range[] = [];
        const boldItalicRanges: vscode.Range[] = [];
        const markRanges: vscode.Range[] = [];
        const regularCommentInlineCodeColorRanges: vscode.Range[] = [];

        // Parse contiguous /// blocks so inline formatting (backticks/markdown emphasis)
        // can continue across successive doc comment lines.
        for (let i = 0; i < document.lineCount; i++) {
            const firstLine = document.lineAt(i);
            if (!docLineRegex.test(firstLine.text)) {
                continue;
            }

            const blockLines: vscode.TextLine[] = [];
            for (let j = i; j < document.lineCount; j++) {
                const line = document.lineAt(j);
                if (!docLineRegex.test(line.text)) {
                    break;
                }
                blockLines.push(line);
            }

            // Skip past the block (the outer loop will i++)
            i += blockLines.length - 1;

            const block = this.parseDocBlock(blockLines);
            slashRanges.push(...block.slashRanges);
            indentRanges.push(...block.indentRanges);
            textRanges.push(...block.textRanges);
            codeRanges.push(...block.codeRanges);
            keywordRanges.push(...block.keywordRanges);
            markdownMarkerRanges.push(...block.markdownMarkerRanges);
            boldRanges.push(...block.boldRanges);
            italicRanges.push(...block.italicRanges);
            boldItalicRanges.push(...block.boldItalicRanges);
        }

        // Apply code color to inline backtick code within regular // comments.
        // This is a best-effort, line-local scan. It intentionally does not change fonts.
        if (codeColor) {
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                if (docLineRegex.test(line.text)) continue;
                if (markLineRegex.test(line.text)) continue;

                const commentStart = this.findSwiftLineCommentStart(line.text);
                if (commentStart === null) continue;

                const commentTextStartCol = commentStart + 2; // after //
                if (commentTextStartCol >= line.text.length) continue;

                const commentText = line.text.substring(commentTextStartCol);
                regularCommentInlineCodeColorRanges.push(
                    ...this.extractBacktickInnerRanges(i, commentTextStartCol, commentText)
                );
            }
        }

        editor.setDecorations(this.slashDecoration, slashRanges);
        editor.setDecorations(this.indentDecoration, indentRanges);
        editor.setDecorations(this.textDecoration, textRanges);
        editor.setDecorations(this.codeDecoration, codeRanges);
        editor.setDecorations(this.regularCommentInlineCodeColorDecoration, regularCommentInlineCodeColorRanges);
        editor.setDecorations(this.keywordDecoration, keywordRanges);
        editor.setDecorations(this.markdownMarkerDecoration, markdownMarkerRanges);
        editor.setDecorations(this.boldDecoration, boldRanges);
        editor.setDecorations(this.italicDecoration, italicRanges);
        editor.setDecorations(this.boldItalicDecoration, boldItalicRanges);

        if (boldMarkLines) {
            // Bold // MARK: lines (Xcode-like), but keep the // prefix at normal weight.
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const match = markLineRegex.exec(line.text);
                if (!match) continue;

                const commentStartCol = match[1].length + match[2].length;
                const commentEndCol = line.text.length;
                if (commentEndCol <= commentStartCol) continue;

                markRanges.push(new vscode.Range(i, commentStartCol, i, commentEndCol));
            }
        }

        editor.setDecorations(this.markDecoration, markRanges);
    }

    /**
     * Remove all decorations from the editor.
     */
    clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.slashDecoration, []);
        editor.setDecorations(this.indentDecoration, []);
        editor.setDecorations(this.textDecoration, []);
        editor.setDecorations(this.codeDecoration, []);
        editor.setDecorations(this.regularCommentInlineCodeColorDecoration, []);
        editor.setDecorations(this.keywordDecoration, []);
        editor.setDecorations(this.markdownMarkerDecoration, []);
        editor.setDecorations(this.boldDecoration, []);
        editor.setDecorations(this.italicDecoration, []);
        editor.setDecorations(this.boldItalicDecoration, []);
        editor.setDecorations(this.markDecoration, []);
    }

    /**
     * Dispose all decoration types.
     */
    dispose(): void {
        this.slashDecoration.dispose();
        this.indentDecoration.dispose();
        this.textDecoration.dispose();
        this.codeDecoration.dispose();
        this.regularCommentInlineCodeColorDecoration.dispose();
        this.keywordDecoration.dispose();
        this.markdownMarkerDecoration.dispose();
        this.boldDecoration.dispose();
        this.italicDecoration.dispose();
        this.boldItalicDecoration.dispose();
        this.markDecoration.dispose();
    }

    // -- Private: Decoration types --

    private buildDecorationTypes(config: vscode.WorkspaceConfiguration) {
        const fontFamily = config.get<string>(
            'fontFamily',
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        );
        const fontSize = config.get<string>('fontSize', '');

        // Build the CSS injection string for proportional doc text
        let textCss = `none; font-family: ${fontFamily}; font-style: normal`;
        if (fontSize) {
            textCss += `; font-size: ${fontSize}`;
        }

        const slashDeco = vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('editorLineNumber.foreground'),
            fontStyle: 'normal',
        });

        // Monospace with no color override -- keeps structural whitespace, dashes,
        // and colons aligned while inheriting the theme's doc comment color.
        const indentDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-style: normal',
        });

        const textDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: textCss,
        });

        const codeColor = config.get<string>('codeColor', '') || undefined;

        const codeDeco = vscode.window.createTextEditorDecorationType({
            // Restore monospace for inline code -- use the editor's own font
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-style: normal',
            ...(codeColor ? { color: codeColor } : {}),
        });

        // Regular // comments should remain completely theme-driven for fonts/styles. We only
        // apply the configured code color to inline backtick code spans.
        const regularCommentInlineCodeColorDeco = vscode.window.createTextEditorDecorationType({
            ...(codeColor ? { color: codeColor } : {}),
        });

        // Lighter proportional font for doc keywords (Parameters, Returns, etc.)
        let keywordCss = `none; font-family: ${fontFamily}; font-style: normal`;
        if (fontSize) {
            keywordCss += `; font-size: ${fontSize}`;
        }

        const keywordColor = config.get<string>('keywordColor', '') || undefined;

        const keywordDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: keywordCss,
            ...(keywordColor ? { color: keywordColor } : {}),
        });

        // Markdown delimiter characters (e.g. *, _, backticks) should remain monospace and
        // inherit the theme's comment color, but appear slightly dimmer like Xcode.
        const markdownMarkerDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-style: normal; opacity: 0.6',
        });

        // Bold text with proportional font
        let boldCss = `none; font-family: ${fontFamily}; font-style: normal; font-weight: bold`;
        if (fontSize) {
            boldCss += `; font-size: ${fontSize}`;
        }

        const boldDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: boldCss,
        });

        // Italic text with proportional font
        let italicCss = `none; font-family: ${fontFamily}; font-style: italic`;
        if (fontSize) {
            italicCss += `; font-size: ${fontSize}`;
        }

        const italicDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: italicCss,
        });

        // Bold italic text with proportional font
        let boldItalicCss = `none; font-family: ${fontFamily}; font-style: italic; font-weight: bold`;
        if (fontSize) {
            boldItalicCss += `; font-size: ${fontSize}`;
        }

        const boldItalicDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: boldItalicCss,
        });

        // Bold MARK lines in monospace, preserving theme comment color.
        const markDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-style: normal; font-weight: bold',
        });

        return { slashDeco, indentDeco, textDeco, codeDeco, regularCommentInlineCodeColorDeco, keywordDeco, markdownMarkerDeco, boldDeco, italicDeco, boldItalicDeco, markDeco };
    }

    // -- Private: Parsing --

    /**
     * Best-effort scan for a Swift line comment ("//") that is not inside a normal or raw
     * string literal on the same line.
     *
     * This does not attempt full Swift lexing. It is intended to handle common cases like:
     *   let s = "http://example.com" // trailing comment
     */
    private findSwiftLineCommentStart(text: string): number | null {
        let inString = false;
        let rawHashes = 0;
        let isTripleQuote = false;

        const tryOpenStringAt = (quotePos: number, hashes: number) => {
            inString = true;
            rawHashes = hashes;
            isTripleQuote = text.substring(quotePos, quotePos + 3) === '"""';
        };

        for (let i = 0; i < text.length - 1; i++) {
            if (!inString) {
                // Raw strings: one or more # followed by a quote.
                if (text[i] === '#') {
                    let h = 0;
                    while (i + h < text.length && text[i + h] === '#') h++;
                    const quotePos = i + h;
                    if (quotePos < text.length && text[quotePos] === '"') {
                        tryOpenStringAt(quotePos, h);
                        i = quotePos + (isTripleQuote ? 2 : 0);
                        continue;
                    }
                }

                // Normal strings: a quote.
                if (text[i] === '"') {
                    tryOpenStringAt(i, 0);
                    i += isTripleQuote ? 2 : 0;
                    continue;
                }

                if (text[i] === '/' && text[i + 1] === '/') {
                    return i;
                }
            } else {
                // In a normal string, skip escaped characters.
                if (rawHashes === 0 && text[i] === '\\') {
                    i += 1;
                    continue;
                }

                if (isTripleQuote) {
                    if (text.substring(i, i + 3) === '"""') {
                        let j = i + 3;
                        let k = 0;
                        while (k < rawHashes && j + k < text.length && text[j + k] === '#') k++;
                        if (k === rawHashes) {
                            inString = false;
                            rawHashes = 0;
                            isTripleQuote = false;
                            i = j + k - 1;
                        }
                    }
                } else {
                    if (text[i] === '"') {
                        let j = i + 1;
                        let k = 0;
                        while (k < rawHashes && j + k < text.length && text[j + k] === '#') k++;
                        if (k === rawHashes) {
                            inString = false;
                            rawHashes = 0;
                            isTripleQuote = false;
                            i = j + k - 1;
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Extract ranges for the inner content of paired, unescaped backtick code spans.
     * Backtick markers are not included in the returned ranges.
     */
    private extractBacktickInnerRanges(lineNum: number, baseCol: number, commentText: string): vscode.Range[] {
        const ranges: vscode.Range[] = [];

        const isEscapedAt = (text: string, index: number): boolean => {
            // Treat an odd number of immediately preceding backslashes as escaping.
            let backslashes = 0;
            for (let i = index - 1; i >= 0; i--) {
                if (text[i] !== '\\') break;
                backslashes++;
            }
            return backslashes % 2 === 1;
        };

        let inBacktick = false;
        let innerStart = -1;

        for (let i = 0; i < commentText.length; i++) {
            const ch = commentText[i];
            if (ch !== '`' || isEscapedAt(commentText, i)) continue;

            if (!inBacktick) {
                inBacktick = true;
                innerStart = i + 1;
            } else {
                const innerEnd = i;
                if (innerEnd > innerStart) {
                    ranges.push(new vscode.Range(lineNum, baseCol + innerStart, lineNum, baseCol + innerEnd));
                }
                inBacktick = false;
                innerStart = -1;
            }
        }

        return ranges;
    }

    /**
     * Parse a contiguous block of /// doc comment lines.
     */
    private parseDocBlock(lines: vscode.TextLine[]): DocBlockSegments {
        const slashRanges: vscode.Range[] = [];
        const indentRanges: vscode.Range[] = [];
        const textRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];
        const keywordRanges: vscode.Range[] = [];
        const markdownMarkerRanges: vscode.Range[] = [];
        const boldRanges: vscode.Range[] = [];
        const italicRanges: vscode.Range[] = [];
        const boldItalicRanges: vscode.Range[] = [];

        const inlineSegments: InlineSegment[] = [];

        for (const line of lines) {
            const match = docLineRegex.exec(line.text);
            if (!match) {
                continue;
            }

            const lineNum = line.lineNumber;
            const slashStart = match[1].length;
            const slashEnd = slashStart + 3; // "///" is always 3 chars
            slashRanges.push(new vscode.Range(lineNum, slashStart, lineNum, slashEnd));

            const afterSlash = match[3] ?? '';
            if (afterSlash.length === 0) {
                continue;
            }

            const contentStart = slashEnd; // absolute column where text after /// begins

            // Try to match doc keyword patterns first (they handle their own indent ranges)
            const keywordParsed = this.tryParseDocTag(
                afterSlash,
                lineNum,
                contentStart,
                indentRanges,
                codeRanges,
                keywordRanges,
                inlineSegments,
            );

            if (!keywordParsed) {
                // No keyword -- peel off leading whitespace as monospace indent, then
                // scan the rest for multiline backticks/markdown.
                const lsMatch = leadingSpaceRegex.exec(afterSlash);
                if (lsMatch) {
                    indentRanges.push(
                        new vscode.Range(lineNum, contentStart, lineNum, contentStart + lsMatch[1].length)
                    );
                    const rest = afterSlash.substring(lsMatch[1].length);
                    if (rest.length > 0) {
                        inlineSegments.push({
                            lineNum,
                            startCol: contentStart + lsMatch[1].length,
                            text: rest,
                        });
                    }
                } else {
                    inlineSegments.push({ lineNum, startCol: contentStart, text: afterSlash });
                }
            }
        }

        // Inline segments are scanned as a single stream so formatting can continue
        // across successive /// lines within the block.
        this.tokenizeInlineSegments(
            inlineSegments,
            textRanges,
            codeRanges,
            markdownMarkerRanges,
            boldRanges,
            italicRanges,
            boldItalicRanges
        );

        return {
            slashRanges,
            indentRanges,
            textRanges,
            codeRanges,
            keywordRanges,
            markdownMarkerRanges,
            boldRanges,
            italicRanges,
            boldItalicRanges,
        };
    }

    /**
     * Attempt to parse a doc keyword pattern from the text after ///.
     * Populates the provided structural range arrays and returns true if a keyword was found.
     * Any keyword description is emitted as an inline segment for block-aware scanning.
     *
     * Handles three forms:
     *   - Parameter name: description   (singular with explicit parameter name)
     *   - KnownTag: description         (section header like Returns, Throws, etc.)
     *   - unknownWord: description      (assumed to be a parameter name)
     */
    private tryParseDocTag(
        text: string,
        lineNum: number,
        offset: number,
        indentRanges: vscode.Range[],
        codeRanges: vscode.Range[],
        keywordRanges: vscode.Range[],
        inlineSegments: InlineSegment[],
    ): boolean {
        // Form: "- Parameter name: description"
        const spMatch = singleParamRegex.exec(text);
        if (spMatch) {
            const [, prefix, keyword, space, name, colon, description] = spMatch;
            let col = offset;

            // "  - " prefix -> indent (monospace for alignment)
            indentRanges.push(new vscode.Range(lineNum, col, lineNum, col + prefix.length));
            col += prefix.length;

            // "Parameter" -> keyword (bold)
            keywordRanges.push(new vscode.Range(lineNum, col, lineNum, col + keyword.length));
            col += keyword.length;

            // space between keyword and name -> indent (monospace)
            indentRanges.push(new vscode.Range(lineNum, col, lineNum, col + space.length));
            col += space.length;

            // parameter name -> code (monospace)
            codeRanges.push(new vscode.Range(lineNum, col, lineNum, col + name.length));
            col += name.length;

            // ": " -> indent (monospace for alignment)
            indentRanges.push(new vscode.Range(lineNum, col, lineNum, col + colon.length));
            col += colon.length;

            // description -> block-aware inline scanning
            if (description.length > 0) {
                inlineSegments.push({ lineNum, startCol: col, text: description });
            }

            return true;
        }

        // Form: "- Word: description"
        const keywordMatch = keywordLineRegex.exec(text);
        if (keywordMatch) {
            const [, prefix, word, colon, description] = keywordMatch;
            const isKnownTag = KNOWN_TAGS.has(word.toLowerCase());
            let col = offset;

            // "  - " prefix -> indent (monospace for alignment)
            indentRanges.push(new vscode.Range(lineNum, col, lineNum, col + prefix.length));
            col += prefix.length;

            if (isKnownTag) {
                // Known keyword -> keyword (bold)
                keywordRanges.push(new vscode.Range(lineNum, col, lineNum, col + word.length));
            } else {
                // Unknown word -> assumed parameter name (monospace)
                codeRanges.push(new vscode.Range(lineNum, col, lineNum, col + word.length));
            }
            col += word.length;

            // ": " -> indent (monospace for alignment)
            indentRanges.push(new vscode.Range(lineNum, col, lineNum, col + colon.length));
            col += colon.length;

            // description -> block-aware inline scanning
            if (description.length > 0) {
                inlineSegments.push({ lineNum, startCol: col, text: description });
            }

            return true;
        }

        return false;
    }

    /**
     * Tokenize inline doc text across a contiguous /// block, allowing backtick code and
     * markdown emphasis to span multiple successive lines.
     *
     * Notes:
     * - Backtick markers are not decorated; only the inner code is styled as code (monospace).
     * - Emphasis markers (*, **, ***, _, __) are not decorated; only the content is styled.
     * - Markdown delimiter characters are dimmed slightly and kept monospace.
     * - Markdown is ignored inside backtick code spans.
     */
    private tokenizeInlineSegments(
        segments: InlineSegment[],
        textRanges: vscode.Range[],
        codeRanges: vscode.Range[],
        markdownMarkerRanges: vscode.Range[],
        boldRanges: vscode.Range[],
        italicRanges: vscode.Range[],
        boldItalicRanges: vscode.Range[],
    ): void {
        let inBacktickCode = false;
        const emphasisStack: EmphasisMarker[] = [];

        const pushNonEmpty = (ranges: vscode.Range[], lineNum: number, startCol: number, endCol: number) => {
            if (endCol > startCol) {
                ranges.push(new vscode.Range(lineNum, startCol, lineNum, endCol));
            }
        };

        const currentEmphasisKind = (): EmphasisKind => {
            let bold = false;
            let italic = false;
            for (const m of emphasisStack) {
                bold = bold || m.addsBold;
                italic = italic || m.addsItalic;
            }
            if (bold && italic) return 'boldItalic';
            if (bold) return 'bold';
            if (italic) return 'italic';
            return 'text';
        };

        const isEscapedAt = (text: string, index: number): boolean => {
            // Treat an odd number of immediately preceding backslashes as escaping.
            let backslashes = 0;
            for (let i = index - 1; i >= 0; i--) {
                if (text[i] !== '\\') break;
                backslashes++;
            }
            return backslashes % 2 === 1;
        };

        const matchEmphasisMarker = (text: string, index: number): { marker: string; length: number; addsBold: boolean; addsItalic: boolean } | null => {
            const ch = text[index];
            if (ch !== '*' && ch !== '_') return null;
            if (isEscapedAt(text, index)) return null;

            const maxLen = Math.min(3, text.length - index);
            for (let len = maxLen; len >= 1; len--) {
                const candidate = text.substring(index, index + len);
                if (candidate.split('').every(c => c === ch)) {
                    // Avoid treating underscores inside identifiers as emphasis, e.g. snake_case.
                    // Heuristic: if both adjacent characters are alphanumeric, it's likely an identifier boundary.
                    if (ch === '_') {
                        const prev = index > 0 ? text[index - 1] : '';
                        const next = index + len < text.length ? text[index + len] : '';
                        const prevIsWord = /[A-Za-z0-9]/.test(prev);
                        const nextIsWord = /[A-Za-z0-9]/.test(next);
                        if (prevIsWord && nextIsWord) {
                            return null;
                        }
                    }

                    if (len === 3) return { marker: candidate, length: 3, addsBold: true, addsItalic: true };
                    if (len === 2) return { marker: candidate, length: 2, addsBold: true, addsItalic: false };
                    return { marker: candidate, length: 1, addsBold: false, addsItalic: true };
                }
            }
            return null;
        };

        const toggleEmphasis = (marker: { marker: string; addsBold: boolean; addsItalic: boolean }) => {
            const top = emphasisStack[emphasisStack.length - 1];
            if (top && top.marker === marker.marker) {
                emphasisStack.pop();
                return;
            }
            emphasisStack.push({
                marker: marker.marker,
                addsBold: marker.addsBold,
                addsItalic: marker.addsItalic,
            });
        };

        for (const seg of segments) {
            const { lineNum, startCol, text } = seg;
            if (!text || text.length === 0) {
                continue;
            }

            let i = 0;
            let runStart = 0;

            const flushRun = (endExclusive: number) => {
                if (endExclusive <= runStart) return;

                const absStart = startCol + runStart;
                const absEnd = startCol + endExclusive;

                if (inBacktickCode) {
                    pushNonEmpty(codeRanges, lineNum, absStart, absEnd);
                    return;
                }

                const kind = currentEmphasisKind();
                if (kind === 'boldItalic') pushNonEmpty(boldItalicRanges, lineNum, absStart, absEnd);
                else if (kind === 'bold') pushNonEmpty(boldRanges, lineNum, absStart, absEnd);
                else if (kind === 'italic') pushNonEmpty(italicRanges, lineNum, absStart, absEnd);
                else pushNonEmpty(textRanges, lineNum, absStart, absEnd);
            };

            while (i < text.length) {
                const ch = text[i];

                if (ch === '`' && !isEscapedAt(text, i)) {
                    // Flush content up to (but not including) the backtick.
                    flushRun(i);

                    // Dim and keep monospace for the delimiter itself (Xcode-like).
                    pushNonEmpty(markdownMarkerRanges, lineNum, startCol + i, startCol + i + 1);

                    inBacktickCode = !inBacktickCode;
                    i += 1;
                    runStart = i;
                    continue;
                }

                if (!inBacktickCode) {
                    const marker = matchEmphasisMarker(text, i);
                    if (marker) {
                        // Flush content up to (but not including) the marker.
                        flushRun(i);

                        // Dim and keep monospace for the delimiter itself (Xcode-like).
                        pushNonEmpty(markdownMarkerRanges, lineNum, startCol + i, startCol + i + marker.length);

                        toggleEmphasis(marker);
                        i += marker.length;
                        runStart = i;
                        continue;
                    }
                }

                i += 1;
            }

            flushRun(text.length);
        }
    }

}

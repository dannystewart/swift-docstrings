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
const tagLineRegex = /^(\s*-\s+)(\w+)(\s*:\s*)(.*)/;

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
    tagRanges: vscode.Range[];
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
    tagRanges: vscode.Range[];
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
    private tagDecoration: vscode.TextEditorDecorationType;
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
        this.tagDecoration = types.tagDeco;
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
        this.tagDecoration.dispose();
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
        this.tagDecoration = types.tagDeco;
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

        const slashRanges: vscode.Range[] = [];
        const indentRanges: vscode.Range[] = [];
        const textRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];
        const tagRanges: vscode.Range[] = [];
        const markdownMarkerRanges: vscode.Range[] = [];
        const boldRanges: vscode.Range[] = [];
        const italicRanges: vscode.Range[] = [];
        const boldItalicRanges: vscode.Range[] = [];
        const markRanges: vscode.Range[] = [];

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
            tagRanges.push(...block.tagRanges);
            markdownMarkerRanges.push(...block.markdownMarkerRanges);
            boldRanges.push(...block.boldRanges);
            italicRanges.push(...block.italicRanges);
            boldItalicRanges.push(...block.boldItalicRanges);
        }

        editor.setDecorations(this.slashDecoration, slashRanges);
        editor.setDecorations(this.indentDecoration, indentRanges);
        editor.setDecorations(this.textDecoration, textRanges);
        editor.setDecorations(this.codeDecoration, codeRanges);
        editor.setDecorations(this.tagDecoration, tagRanges);
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
        editor.setDecorations(this.tagDecoration, []);
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
        this.tagDecoration.dispose();
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

        // Lighter proportional font for doc tag keywords (Parameters, Returns, etc.)
        let tagCss = `none; font-family: ${fontFamily}; font-style: normal`;
        if (fontSize) {
            tagCss += `; font-size: ${fontSize}`;
        }

        const tagColor = config.get<string>('tagColor', '') || undefined;

        const tagDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: tagCss,
            ...(tagColor ? { color: tagColor } : {}),
        });

        // Markdown delimiter characters (e.g. *, _, backticks) should remain monospace and
        // inherit the theme's comment color, but appear slightly dimmer like Xcode.
        const markdownMarkerDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-style: normal; opacity: 0.5',
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

        return { slashDeco, indentDeco, textDeco, codeDeco, tagDeco, markdownMarkerDeco, boldDeco, italicDeco, boldItalicDeco, markDeco };
    }

    // -- Private: Parsing --

    /**
     * Parse a contiguous block of /// doc comment lines.
     */
    private parseDocBlock(lines: vscode.TextLine[]): DocBlockSegments {
        const slashRanges: vscode.Range[] = [];
        const indentRanges: vscode.Range[] = [];
        const textRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];
        const tagRanges: vscode.Range[] = [];
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

            // Try to match doc tag patterns first (they handle their own indent ranges)
            const tagParsed = this.tryParseDocTag(
                afterSlash,
                lineNum,
                contentStart,
                indentRanges,
                codeRanges,
                tagRanges,
                inlineSegments,
            );

            if (!tagParsed) {
                // No tag -- peel off leading whitespace as monospace indent, then
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
            tagRanges,
            markdownMarkerRanges,
            boldRanges,
            italicRanges,
            boldItalicRanges,
        };
    }

    /**
     * Attempt to parse a doc tag pattern from the text after ///.
     * Populates the provided structural range arrays and returns true if a tag was found.
     * Any tag description is emitted as an inline segment for block-aware scanning.
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
        tagRanges: vscode.Range[],
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

            // "Parameter" -> tag (bold)
            tagRanges.push(new vscode.Range(lineNum, col, lineNum, col + keyword.length));
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
        const tagMatch = tagLineRegex.exec(text);
        if (tagMatch) {
            const [, prefix, word, colon, description] = tagMatch;
            const isKnownTag = KNOWN_TAGS.has(word.toLowerCase());
            let col = offset;

            // "  - " prefix -> indent (monospace for alignment)
            indentRanges.push(new vscode.Range(lineNum, col, lineNum, col + prefix.length));
            col += prefix.length;

            if (isKnownTag) {
                // Known keyword -> tag (bold)
                tagRanges.push(new vscode.Range(lineNum, col, lineNum, col + word.length));
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

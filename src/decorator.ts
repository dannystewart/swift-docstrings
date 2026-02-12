import * as vscode from 'vscode';

// Matches a line that is a /// doc comment.
// Group 1: leading whitespace
// Group 2: the /// prefix
// Group 3: everything after /// (may be undefined for bare /// lines)
const docLineRegex = /^(\s*)(\/\/\/)(.*)?$/;

// Matches backtick-wrapped inline code segments within doc text.
const inlineCodeRegex = /`[^`]+`/g;

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

// Matches bold text: **text** or __text__
// Uses negative lookbehind to avoid matching escaped asterisks/underscores
const boldRegex = /\*\*(.+?)\*\*|__(.+?)__/g;

// Matches italic text: *text* or _text_
// Uses negative lookbehind to avoid matching escaped asterisks/underscores
const italicRegex = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g;

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

export class DocstringDecorator {
    private slashDecoration: vscode.TextEditorDecorationType;
    private indentDecoration: vscode.TextEditorDecorationType;
    private textDecoration: vscode.TextEditorDecorationType;
    private codeDecoration: vscode.TextEditorDecorationType;
    private tagDecoration: vscode.TextEditorDecorationType;
    private boldDecoration: vscode.TextEditorDecorationType;
    private italicDecoration: vscode.TextEditorDecorationType;
    private boldItalicDecoration: vscode.TextEditorDecorationType;

    constructor() {
        const config = vscode.workspace.getConfiguration('swiftDocstrings');
        const types = this.buildDecorationTypes(config);
        this.slashDecoration = types.slashDeco;
        this.indentDecoration = types.indentDeco;
        this.textDecoration = types.textDeco;
        this.codeDecoration = types.codeDeco;
        this.tagDecoration = types.tagDeco;
        this.boldDecoration = types.boldDeco;
        this.italicDecoration = types.italicDeco;
        this.boldItalicDecoration = types.boldItalicDeco;
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
        this.boldDecoration.dispose();
        this.italicDecoration.dispose();
        this.boldItalicDecoration.dispose();

        const config = vscode.workspace.getConfiguration('swiftDocstrings');
        const types = this.buildDecorationTypes(config);
        this.slashDecoration = types.slashDeco;
        this.indentDecoration = types.indentDeco;
        this.textDecoration = types.textDeco;
        this.codeDecoration = types.codeDeco;
        this.tagDecoration = types.tagDeco;
        this.boldDecoration = types.boldDeco;
        this.italicDecoration = types.italicDeco;
        this.boldItalicDecoration = types.boldItalicDeco;
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

        const slashRanges: vscode.Range[] = [];
        const indentRanges: vscode.Range[] = [];
        const textRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];
        const tagRanges: vscode.Range[] = [];
        const boldRanges: vscode.Range[] = [];
        const italicRanges: vscode.Range[] = [];
        const boldItalicRanges: vscode.Range[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const segments = this.parseLine(line);
            if (!segments) {
                continue;
            }

            slashRanges.push(segments.slashRange);
            indentRanges.push(...segments.indentRanges);
            textRanges.push(...segments.textRanges);
            codeRanges.push(...segments.codeRanges);
            tagRanges.push(...segments.tagRanges);
            boldRanges.push(...segments.boldRanges);
            italicRanges.push(...segments.italicRanges);
            boldItalicRanges.push(...segments.boldItalicRanges);
        }

        editor.setDecorations(this.slashDecoration, slashRanges);
        editor.setDecorations(this.indentDecoration, indentRanges);
        editor.setDecorations(this.textDecoration, textRanges);
        editor.setDecorations(this.codeDecoration, codeRanges);
        editor.setDecorations(this.tagDecoration, tagRanges);
        editor.setDecorations(this.boldDecoration, boldRanges);
        editor.setDecorations(this.italicDecoration, italicRanges);
        editor.setDecorations(this.boldItalicDecoration, boldItalicRanges);
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
        editor.setDecorations(this.boldDecoration, []);
        editor.setDecorations(this.italicDecoration, []);
        editor.setDecorations(this.boldItalicDecoration, []);
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
        this.boldDecoration.dispose();
        this.italicDecoration.dispose();
        this.boldItalicDecoration.dispose();
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

        // Bold text with proportional font
        const boldColor = config.get<string>('boldColor', '') || undefined;
        let boldCss = `none; font-family: ${fontFamily}; font-style: normal; font-weight: bold`;
        if (fontSize) {
            boldCss += `; font-size: ${fontSize}`;
        }

        const boldDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: boldCss,
            ...(boldColor ? { color: boldColor } : {}),
        });

        // Italic text with proportional font
        const italicColor = config.get<string>('italicColor', '') || undefined;
        let italicCss = `none; font-family: ${fontFamily}; font-style: italic`;
        if (fontSize) {
            italicCss += `; font-size: ${fontSize}`;
        }

        const italicDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: italicCss,
            ...(italicColor ? { color: italicColor } : {}),
        });

        // Bold italic text with proportional font
        let boldItalicCss = `none; font-family: ${fontFamily}; font-style: italic; font-weight: bold`;
        if (fontSize) {
            boldItalicCss += `; font-size: ${fontSize}`;
        }

        const boldItalicDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: boldItalicCss,
            ...(boldColor || italicColor ? { color: boldColor || italicColor } : {}),
        });

        return { slashDeco, indentDeco, textDeco, codeDeco, tagDeco, boldDeco, italicDeco, boldItalicDeco };
    }

    // -- Private: Parsing --

    /**
     * Parse a single line for /// doc comment segments.
     * Returns null if the line is not a doc comment.
     */
    private parseLine(line: vscode.TextLine): DocCommentSegments | null {
        const match = docLineRegex.exec(line.text);
        if (!match) {
            return null;
        }

        const lineNum = line.lineNumber;
        const slashStart = match[1].length;
        const slashEnd = slashStart + 3; // "///" is always 3 chars
        const slashRange = new vscode.Range(lineNum, slashStart, lineNum, slashEnd);

        const indentRanges: vscode.Range[] = [];
        const tempTextRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];
        const tagRanges: vscode.Range[] = [];
        const boldRanges: vscode.Range[] = [];
        const italicRanges: vscode.Range[] = [];
        const boldItalicRanges: vscode.Range[] = [];
        const textRanges: vscode.Range[] = [];

        const afterSlash = match[3];
        if (!afterSlash || afterSlash.length === 0) {
            return { slashRange, indentRanges, textRanges, codeRanges, tagRanges, boldRanges, italicRanges, boldItalicRanges };
        }

        const contentStart = slashEnd; // absolute column where text after /// begins

        // Try to match doc tag patterns first (they handle their own indent ranges)
        const tagParsed = this.tryParseDocTag(
            afterSlash, lineNum, contentStart, indentRanges, tempTextRanges, codeRanges, tagRanges
        );

        if (!tagParsed) {
            // No tag -- peel off leading whitespace as monospace indent, then
            // parse the rest for backticks
            const lsMatch = leadingSpaceRegex.exec(afterSlash);
            if (lsMatch) {
                indentRanges.push(
                    new vscode.Range(lineNum, contentStart, lineNum, contentStart + lsMatch[1].length)
                );
                const rest = afterSlash.substring(lsMatch[1].length);
                if (rest.length > 0) {
                    this.splitByBackticks(
                        rest, lineNum, contentStart + lsMatch[1].length, tempTextRanges, codeRanges
                    );
                }
            } else {
                this.splitByBackticks(afterSlash, lineNum, contentStart, tempTextRanges, codeRanges);
            }
        }

        // Now split the text ranges into bold, italic, bold-italic, and plain text
        this.splitByMarkdownFormatting(tempTextRanges, lineNum, boldRanges, italicRanges, boldItalicRanges, textRanges, line.text);

        return { slashRange, indentRanges, textRanges, codeRanges, tagRanges, boldRanges, italicRanges, boldItalicRanges };
    }

    /**
     * Attempt to parse a doc tag pattern from the text after ///.
     * Populates the provided range arrays and returns true if a tag was found.
     *
     * Handles three forms:
     *   - Parameter name: description   (singular with explicit parameter name)
     *   - KnownTag: description          (section header like Returns, Throws, etc.)
     *   - unknownWord: description        (assumed to be a parameter name)
     */
    private tryParseDocTag(
        text: string,
        lineNum: number,
        offset: number,
        indentRanges: vscode.Range[],
        textRanges: vscode.Range[],
        codeRanges: vscode.Range[],
        tagRanges: vscode.Range[],
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

            // description -> backtick-aware text
            if (description.length > 0) {
                this.splitByBackticks(description, lineNum, col, textRanges, codeRanges);
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

            // description -> backtick-aware text
            if (description.length > 0) {
                this.splitByBackticks(description, lineNum, col, textRanges, codeRanges);
            }

            return true;
        }

        return false;
    }

    /**
     * Split a text segment into interleaved text (proportional) and code (monospace)
     * ranges based on backtick-wrapped inline code spans.
     */
    private splitByBackticks(
        text: string,
        lineNum: number,
        offset: number,
        textRanges: vscode.Range[],
        codeRanges: vscode.Range[],
    ): void {
        const codeSpans: { start: number; end: number }[] = [];

        inlineCodeRegex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = inlineCodeRegex.exec(text)) !== null) {
            codeSpans.push({ start: m.index, end: m.index + m[0].length });
        }

        if (codeSpans.length === 0) {
            textRanges.push(new vscode.Range(lineNum, offset, lineNum, offset + text.length));
            return;
        }

        let cursor = 0;
        for (const span of codeSpans) {
            if (span.start > cursor) {
                textRanges.push(
                    new vscode.Range(lineNum, offset + cursor, lineNum, offset + span.start)
                );
            }
            codeRanges.push(
                new vscode.Range(lineNum, offset + span.start, lineNum, offset + span.end)
            );
            cursor = span.end;
        }

        if (cursor < text.length) {
            textRanges.push(
                new vscode.Range(lineNum, offset + cursor, lineNum, offset + text.length)
            );
        }
    }

    /**
     * Split text ranges into bold, italic, bold-italic, and plain text ranges.
     * This should be called after splitByBackticks to avoid formatting inside code spans.
     */
    private splitByMarkdownFormatting(
        textRanges: vscode.Range[],
        lineNum: number,
        boldRanges: vscode.Range[],
        italicRanges: vscode.Range[],
        boldItalicRanges: vscode.Range[],
        plainTextRanges: vscode.Range[],
        lineText: string,
    ): void {
        for (const textRange of textRanges) {
            const startCol = textRange.start.character;
            const endCol = textRange.end.character;
            // Extract the text for this range from the line text
            const text = lineText.substring(startCol, endCol);

            if (!text || text.length === 0) {
                continue;
            }

            // Find all formatting spans (bold, italic, and bold-italic)
            interface FormatSpan {
                start: number;
                end: number;
                type: 'bold' | 'italic' | 'bold-italic';
            }

            const formatSpans: FormatSpan[] = [];

            // Find bold-italic first (***text***)
            const boldItalicRegex = /\*\*\*(.+?)\*\*\*/g;
            boldItalicRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = boldItalicRegex.exec(text)) !== null) {
                formatSpans.push({
                    start: match.index + 3, // skip ***
                    end: match.index + match[0].length - 3, // exclude trailing ***
                    type: 'bold-italic'
                });
            }

            // Find bold (**text** or __text__)
            boldRegex.lastIndex = 0;
            while ((match = boldRegex.exec(text)) !== null) {
                const contentStart = match.index + 2; // skip ** or __
                const contentEnd = match.index + match[0].length - 2; // exclude trailing ** or __
                
                // Check if this overlaps with a bold-italic span
                const overlaps = formatSpans.some(span => 
                    span.type === 'bold-italic' && 
                    contentStart >= span.start - 3 && contentEnd <= span.end + 3
                );
                
                if (!overlaps) {
                    formatSpans.push({
                        start: contentStart,
                        end: contentEnd,
                        type: 'bold'
                    });
                }
            }

            // Find italic (*text* or _text_)
            italicRegex.lastIndex = 0;
            while ((match = italicRegex.exec(text)) !== null) {
                const contentGroup = match[1] || match[2]; // either * or _ group
                if (!contentGroup) continue;
                
                const contentStart = match.index + 1; // skip * or _
                const contentEnd = match.index + match[0].length - 1; // exclude trailing * or _
                
                // Check if this overlaps with a bold or bold-italic span
                const overlaps = formatSpans.some(span => 
                    (span.type === 'bold' || span.type === 'bold-italic') &&
                    contentStart >= span.start - 2 && contentEnd <= span.end + 2
                );
                
                if (!overlaps) {
                    formatSpans.push({
                        start: contentStart,
                        end: contentEnd,
                        type: 'italic'
                    });
                }
            }

            // Sort spans by start position
            formatSpans.sort((a, b) => a.start - b.start);

            // Build ranges for formatted and plain text
            let cursor = 0;
            for (const span of formatSpans) {
                // Plain text before this span
                if (span.start > cursor) {
                    plainTextRanges.push(
                        new vscode.Range(lineNum, startCol + cursor, lineNum, startCol + span.start)
                    );
                }

                // The formatted span (content only, excluding markers)
                const spanRange = new vscode.Range(
                    lineNum, startCol + span.start,
                    lineNum, startCol + span.end
                );

                if (span.type === 'bold') {
                    boldRanges.push(spanRange);
                } else if (span.type === 'italic') {
                    italicRanges.push(spanRange);
                } else if (span.type === 'bold-italic') {
                    boldItalicRanges.push(spanRange);
                }

                cursor = span.end;
            }

            // Remaining plain text
            if (cursor < text.length) {
                plainTextRanges.push(
                    new vscode.Range(lineNum, startCol + cursor, lineNum, endCol)
                );
            }
        }
    }
}

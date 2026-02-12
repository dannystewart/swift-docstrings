import * as vscode from 'vscode';

// Matches a line that is a /// doc comment.
// Group 1: leading whitespace
// Group 2: the /// prefix
// Group 3: everything after /// (may be undefined for bare /// lines)
const docLineRegex = /^(\s*)(\/\/\/)(.*)?$/;

// Matches backtick-wrapped inline code segments within doc text.
const inlineCodeRegex = /`[^`]+`/g;

interface DocCommentSegments {
    slashRange: vscode.Range;
    textRanges: vscode.Range[];
    codeRanges: vscode.Range[];
}

export class DocstringDecorator {
    private slashDecoration: vscode.TextEditorDecorationType;
    private textDecoration: vscode.TextEditorDecorationType;
    private codeDecoration: vscode.TextEditorDecorationType;

    constructor() {
        const config = vscode.workspace.getConfiguration('swiftDocstrings');
        const { slashDeco, textDeco, codeDeco } = this.buildDecorationTypes(config);
        this.slashDecoration = slashDeco;
        this.textDecoration = textDeco;
        this.codeDecoration = codeDeco;
    }

    /**
     * Rebuild decoration types from configuration. Call this when settings change.
     */
    rebuildDecorations(): void {
        // Dispose old decoration types
        this.slashDecoration.dispose();
        this.textDecoration.dispose();
        this.codeDecoration.dispose();

        const config = vscode.workspace.getConfiguration('swiftDocstrings');
        const { slashDeco, textDeco, codeDeco } = this.buildDecorationTypes(config);
        this.slashDecoration = slashDeco;
        this.textDecoration = textDeco;
        this.codeDecoration = codeDeco;
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
        const textRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const segments = this.parseLine(line);
            if (!segments) {
                continue;
            }

            slashRanges.push(segments.slashRange);
            textRanges.push(...segments.textRanges);
            codeRanges.push(...segments.codeRanges);
        }

        editor.setDecorations(this.slashDecoration, slashRanges);
        editor.setDecorations(this.textDecoration, textRanges);
        editor.setDecorations(this.codeDecoration, codeRanges);
    }

    /**
     * Remove all decorations from the editor.
     */
    clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.slashDecoration, []);
        editor.setDecorations(this.textDecoration, []);
        editor.setDecorations(this.codeDecoration, []);
    }

    /**
     * Dispose all decoration types.
     */
    dispose(): void {
        this.slashDecoration.dispose();
        this.textDecoration.dispose();
        this.codeDecoration.dispose();
    }

    // -- Private --

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

        const textDeco = vscode.window.createTextEditorDecorationType({
            textDecoration: textCss,
        });

        const codeDeco = vscode.window.createTextEditorDecorationType({
            // Restore monospace for inline code -- use the editor's own font
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-style: normal',
            color: new vscode.ThemeColor('editorLineNumber.activeForeground'),
        });

        return { slashDeco: slashDeco, textDeco: textDeco, codeDeco: codeDeco };
    }

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
        const leadingWhitespace = match[1];
        const slashStart = leadingWhitespace.length;
        const slashEnd = slashStart + 3; // "///" is always 3 chars

        const slashRange = new vscode.Range(lineNum, slashStart, lineNum, slashEnd);

        const textRanges: vscode.Range[] = [];
        const codeRanges: vscode.Range[] = [];

        const afterSlash = match[3];
        if (!afterSlash || afterSlash.length === 0) {
            // Bare /// line with nothing after it
            return { slashRange, textRanges, codeRanges };
        }

        const textStart = slashEnd; // start of everything after ///

        // Find all inline code spans (backtick pairs) in the text after ///
        const codeMatches: { start: number; end: number }[] = [];
        let codeMatch: RegExpExecArray | null;

        // Reset lastIndex since we reuse the regex
        inlineCodeRegex.lastIndex = 0;
        while ((codeMatch = inlineCodeRegex.exec(afterSlash)) !== null) {
            codeMatches.push({
                start: codeMatch.index,
                end: codeMatch.index + codeMatch[0].length,
            });
        }

        if (codeMatches.length === 0) {
            // No inline code -- the entire remainder is doc text
            textRanges.push(new vscode.Range(lineNum, textStart, lineNum, line.text.length));
        } else {
            // Interleave text and code ranges
            let cursor = 0;

            for (const cm of codeMatches) {
                // Text before this code span
                if (cm.start > cursor) {
                    textRanges.push(
                        new vscode.Range(
                            lineNum,
                            textStart + cursor,
                            lineNum,
                            textStart + cm.start
                        )
                    );
                }

                // The code span itself
                codeRanges.push(
                    new vscode.Range(
                        lineNum,
                        textStart + cm.start,
                        lineNum,
                        textStart + cm.end
                    )
                );

                cursor = cm.end;
            }

            // Text after the last code span
            if (cursor < afterSlash.length) {
                textRanges.push(
                    new vscode.Range(
                        lineNum,
                        textStart + cursor,
                        lineNum,
                        line.text.length
                    )
                );
            }
        }

        return { slashRange, textRanges, codeRanges };
    }
}

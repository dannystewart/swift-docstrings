import * as vscode from 'vscode';
import { DocstringDecorator } from './decorator';
import { computeConvertLineCommentsToDocCommentInserts, computeWrapCommentsReplaceEdits } from './commentCommands';

let decorator: DocstringDecorator | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const CONVERT_COMMAND_ID = 'xcodeComments.convertLineCommentsToDocComments';
const WRAP_COMMAND_ID = 'xcodeComments.wrapCommentsToLineLength';

export function activate(context: vscode.ExtensionContext) {
    decorator = new DocstringDecorator();

    context.subscriptions.push(
        vscode.commands.registerCommand(CONVERT_COMMAND_ID, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                await vscode.window.showInformationMessage('No active editor.');
                return;
            }
            if (editor.document.languageId !== 'swift') {
                await vscode.window.showInformationMessage('This command only works for Swift files.');
                return;
            }

            const lines = Array.from({ length: editor.document.lineCount }, (_, i) => editor.document.lineAt(i).text);
            const inserts = computeConvertLineCommentsToDocCommentInserts(lines);
            if (inserts.length === 0) {
                await vscode.window.showInformationMessage('No // comments to convert.');
                return;
            }

            const ok = await editor.edit((editBuilder) => {
                for (const ins of inserts) {
                    editBuilder.insert(new vscode.Position(ins.line, ins.character), ins.text);
                }
            });

            if (ok) {
                decorator?.applyDecorations(editor);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(WRAP_COMMAND_ID, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                await vscode.window.showInformationMessage('No active editor.');
                return;
            }
            if (editor.document.languageId !== 'swift') {
                await vscode.window.showInformationMessage('This command only works for Swift files.');
                return;
            }

            const config = vscode.workspace.getConfiguration('xcodeComments');
            const maxLineLength = config.get<number>('maxCommentLineLength', 100);
            const wrapCountFromCommentStart = config.get<boolean>('wrapCountFromCommentStart', false);

            const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
            const lines = Array.from({ length: editor.document.lineCount }, (_, i) => editor.document.lineAt(i).text);
            const replacements = computeWrapCommentsReplaceEdits(lines, maxLineLength, eol, wrapCountFromCommentStart);

            if (replacements.length === 0) {
                await vscode.window.showInformationMessage('No comments needed wrapping.');
                return;
            }

            const sorted = replacements.slice().sort((a, b) => b.startLine - a.startLine);
            const ok = await editor.edit((editBuilder) => {
                for (const rep of sorted) {
                    const endChar = editor.document.lineAt(rep.endLine).text.length;
                    const range = new vscode.Range(rep.startLine, 0, rep.endLine, endChar);
                    editBuilder.replace(range, rep.text);
                }
            });

            if (ok) {
                decorator?.applyDecorations(editor);
            }
        })
    );

    // Apply to the already-active editor, if it's a Swift file
    if (vscode.window.activeTextEditor) {
        decorator.applyDecorations(vscode.window.activeTextEditor);
    }

    // Re-apply when switching to a different editor tab
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && decorator) {
                decorator.applyDecorations(editor);
            }
        })
    );

    // Re-apply on document edits (debounced for typing performance)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document || !decorator) {
                return;
            }
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                decorator?.applyDecorations(editor);
            }, 50);
        })
    );

    // Rebuild decoration types when configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration('xcodeComments') || !decorator) {
                return;
            }
            decorator.rebuildDecorations();

            // Re-apply with the new decoration types
            if (vscode.window.activeTextEditor) {
                decorator.applyDecorations(vscode.window.activeTextEditor);
            }
        })
    );

    // Clean up the decorator on deactivation
    context.subscriptions.push({
        dispose() {
            decorator?.dispose();
            decorator = undefined;
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
        },
    });
}

export function deactivate() {
    decorator?.dispose();
    decorator = undefined;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
}

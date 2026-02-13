import * as vscode from 'vscode';
import { DocstringDecorator } from './decorator';
import {
    computeConvertLineCommentsToDocCommentInserts,
    computeTitleCaseMarkCommentsReplaceEdits,
    computeWrapCommentsReplaceEdits,
} from './commentCommands';

let decorator: DocstringDecorator | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const CONVERT_COMMAND_ID = 'xcodeComments.convertLineCommentsToDocComments';
const WRAP_COMMAND_ID = 'xcodeComments.wrapCommentsToLineLength';
const TITLE_CASE_MARK_COMMAND_ID = 'xcodeComments.titleCaseMarkComments';
const TITLE_CASE_MARK_WORKSPACE_COMMAND_ID = 'xcodeComments.titleCaseMarkCommentsInWorkspace';

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
            const avoidWrappingAtPunctuationBreaks = config.get<boolean>(
                'avoidWrappingAtPunctuationBreaks',
                false
            );

            const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
            const lines = Array.from({ length: editor.document.lineCount }, (_, i) => editor.document.lineAt(i).text);
            const replacements = computeWrapCommentsReplaceEdits(
                lines,
                maxLineLength,
                eol,
                wrapCountFromCommentStart,
                avoidWrappingAtPunctuationBreaks
            );

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

    context.subscriptions.push(
        vscode.commands.registerCommand(TITLE_CASE_MARK_COMMAND_ID, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                await vscode.window.showInformationMessage('No active editor.');
                return;
            }
            if (editor.document.languageId !== 'swift') {
                await vscode.window.showInformationMessage('This command only works for Swift files.');
                return;
            }

            const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
            const lines = Array.from({ length: editor.document.lineCount }, (_, i) => editor.document.lineAt(i).text);
            const replacements = computeTitleCaseMarkCommentsReplaceEdits(lines, eol);

            if (replacements.length === 0) {
                await vscode.window.showInformationMessage('No // MARK: titles needed changes.');
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

    context.subscriptions.push(
        vscode.commands.registerCommand(TITLE_CASE_MARK_WORKSPACE_COMMAND_ID, async () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
                await vscode.window.showInformationMessage('No workspace folder is open.');
                return;
            }

            const includeGlob = '**/*.swift';
            const excludeGlob = '**/{.git,node_modules,DerivedData,build,out,dist,.build,.swiftpm}/**';

            const uris = await vscode.workspace.findFiles(includeGlob, excludeGlob);
            if (uris.length === 0) {
                await vscode.window.showInformationMessage('No Swift files found in the workspace.');
                return;
            }

            let changedFiles = 0;
            let changedMarkLines = 0;
            let failedFiles = 0;
            let wasCancelled = false;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Xcode Comments: Title Casing // MARK: lines in workspace',
                    cancellable: true,
                },
                async (progress, token) => {
                    const step = 100 / Math.max(1, uris.length);

                    for (let idx = 0; idx < uris.length; idx++) {
                        if (token.isCancellationRequested) {
                            wasCancelled = true;
                            break;
                        }

                        const uri = uris[idx];
                        progress.report({
                            increment: step,
                            message: vscode.workspace.asRelativePath(uri, false),
                        });

                        let document: vscode.TextDocument;
                        try {
                            document = await vscode.workspace.openTextDocument(uri);
                        } catch {
                            failedFiles++;
                            continue;
                        }

                        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
                        const lines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
                        const replacements = computeTitleCaseMarkCommentsReplaceEdits(lines, eol);
                        if (replacements.length === 0) {
                            continue;
                        }

                        const sorted = replacements.slice().sort((a, b) => b.startLine - a.startLine);
                        const edit = new vscode.WorkspaceEdit();
                        for (const rep of sorted) {
                            const endChar = document.lineAt(rep.endLine).text.length;
                            const range = new vscode.Range(rep.startLine, 0, rep.endLine, endChar);
                            edit.replace(uri, range, rep.text);
                        }

                        const ok = await vscode.workspace.applyEdit(edit);
                        if (!ok) {
                            failedFiles++;
                            continue;
                        }

                        // Auto-save changed documents (per your preference).
                        // If save fails (e.g. read-only), report as a failure.
                        const saved = await document.save();
                        if (!saved) {
                            failedFiles++;
                            continue;
                        }

                        changedFiles++;
                        changedMarkLines += replacements.length;
                    }
                }
            );

            // Refresh decorations for the active editor (if it was among the changed docs).
            if (vscode.window.activeTextEditor) {
                decorator?.applyDecorations(vscode.window.activeTextEditor);
            }

            const suffix = failedFiles > 0 ? ` (${failedFiles} files failed)` : '';
            const cancelledNote = wasCancelled ? ' (cancelled; you can re-run to continue)' : '';
            await vscode.window.showInformationMessage(
                `Updated ${changedMarkLines} // MARK: lines across ${changedFiles} files${suffix}.${cancelledNote}`
            );
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

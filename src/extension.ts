import * as vscode from 'vscode';
import { DocstringDecorator } from './decorator';

let decorator: DocstringDecorator | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext) {
    decorator = new DocstringDecorator();

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
            if (!event.affectsConfiguration('swiftDocstrings') || !decorator) {
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

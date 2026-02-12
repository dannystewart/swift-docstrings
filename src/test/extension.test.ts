import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { DocstringDecorator } from '../decorator';

suite('Extension Test Suite', () => {
	test('Bolds // MARK: lines (Xcode-like matching), excluding the // prefix', async () => {
		const content = [
			'struct Foo {',
			'    // MARK: - Section',
			'\t//MARK: - NoSpaceAfterSlashes',
			'    //  MARK:- NoSpaceAfterColonSpace',
			'    // MARK:',
			'    // MARK:foo (should not match)',
			'    // Mark: - wrong case',
			'    // Not a mark',
			'    /// Doc comment',
			'    /// - Returns: `Int`',
			'}',
			'',
		].join('\n');

		const doc = await vscode.workspace.openTextDocument({ language: 'swift', content });
		const editor = await vscode.window.showTextDocument(doc);

		const calls: Array<{ ranges: readonly vscode.Range[] }> = [];

		const originalSetDecorations = editor.setDecorations.bind(editor);
		const spySetDecorations = (decorationType: vscode.TextEditorDecorationType, ranges: readonly vscode.Range[]) => {
			calls.push({ ranges: Array.from(ranges) });
			originalSetDecorations(decorationType, ranges);
		};

		// Spy on setDecorations to observe applied ranges.
		try {
			Object.defineProperty(editor, 'setDecorations', { value: spySetDecorations });
		} catch {
			(editor as unknown as { setDecorations: typeof spySetDecorations }).setDecorations = spySetDecorations;
		}

		try {
			const decorator = new DocstringDecorator();
			decorator.applyDecorations(editor);

			const expectedMarkLines = [1, 2, 3, 4];
			const expectedRanges = expectedMarkLines.map((line) => {
				const lineText = doc.lineAt(line).text;
				const slashesStart = lineText.indexOf('//');
				assert.ok(slashesStart >= 0, `Expected '//' on line ${line}`);
				return new vscode.Range(line, slashesStart + 2, line, lineText.length);
			});

			const rangeKey = (r: vscode.Range) =>
				`${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;

			const matchingCalls = calls.filter((c) => c.ranges.some((r) => expectedMarkLines.includes(r.start.line)));
			assert.strictEqual(
				matchingCalls.length,
				1,
				'Expected exactly one decoration call affecting // MARK: lines.'
			);

			const markRanges = matchingCalls[0].ranges;

			// Ensure only the expected MARK lines are included (no false positives).
			const markLines = Array.from(new Set(markRanges.map((r) => r.start.line))).sort((a, b) => a - b);
			assert.deepStrictEqual(markLines, expectedMarkLines);

			const actualKeys = markRanges.map(rangeKey).sort();
			const expectedKeys = expectedRanges.map(rangeKey).sort();
			assert.deepStrictEqual(actualKeys, expectedKeys);

			// Explicit non-matches should not be decorated.
			assert.ok(!markLines.includes(5), 'Did not expect to decorate `// MARK:foo ...`');
			assert.ok(!markLines.includes(6), 'Did not expect to decorate `// Mark: ...`');
		} finally {
			// Restore the original method to avoid leaking into other tests.
			try {
				Object.defineProperty(editor, 'setDecorations', { value: originalSetDecorations });
			} catch {
				(editor as unknown as { setDecorations: typeof originalSetDecorations }).setDecorations = originalSetDecorations;
			}
		}
	});

	test('Does not bold // MARK: lines when disabled in settings', async () => {
		const config = vscode.workspace.getConfiguration('swiftDocstrings');
		await config.update('boldMarkLines', false, true);

		try {
			const content = [
				'struct Foo {',
				'    // MARK: - Section',
				'    // Not a mark',
				'}',
				'',
			].join('\n');

			const doc = await vscode.workspace.openTextDocument({ language: 'swift', content });
			const editor = await vscode.window.showTextDocument(doc);

			const calls: Array<{ ranges: readonly vscode.Range[] }> = [];

			const originalSetDecorations = editor.setDecorations.bind(editor);
			const spySetDecorations = (decorationType: vscode.TextEditorDecorationType, ranges: readonly vscode.Range[]) => {
				calls.push({ ranges: Array.from(ranges) });
				originalSetDecorations(decorationType, ranges);
			};

			try {
				Object.defineProperty(editor, 'setDecorations', { value: spySetDecorations });
			} catch {
				(editor as unknown as { setDecorations: typeof spySetDecorations }).setDecorations = spySetDecorations;
			}

			try {
				const decorator = new DocstringDecorator();
				decorator.applyDecorations(editor);

				const markLine = 1;
				const callsAffectingMarkLine = calls.filter((c) => c.ranges.some((r) => r.start.line === markLine));
				assert.strictEqual(callsAffectingMarkLine.length, 0, 'Expected no decorations applied to // MARK: line.');
			} finally {
				try {
					Object.defineProperty(editor, 'setDecorations', { value: originalSetDecorations });
				} catch {
					(editor as unknown as { setDecorations: typeof originalSetDecorations }).setDecorations = originalSetDecorations;
				}
			}
		} finally {
			await config.update('boldMarkLines', undefined, true);
		}
	});
});

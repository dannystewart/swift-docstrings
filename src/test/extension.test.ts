import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { DocstringDecorator } from '../decorator';
import { activate } from '../extension';
import {
	computeConvertLineCommentsToDocCommentInserts,
	computeTitleCaseMarkCommentsReplaceEdits,
	computeWrapCommentsReplaceEdits,
} from '../commentCommands';

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
				2,
				'Expected two decoration calls affecting // MARK: lines (bold + separator for MARK: -).'
			);

			const boldCall = matchingCalls.find((c) => c.ranges.some((r) => r.start.character > 0 || r.end.character > 0));
			const separatorCall = matchingCalls.find((c) =>
				c.ranges.some((r) => r.start.character === 0 && r.end.character === 0)
			);

			assert.ok(boldCall, 'Expected a decoration call for bold MARK ranges.');
			assert.ok(separatorCall, 'Expected a decoration call for MARK separator line ranges.');

			const markRanges = boldCall.ranges;

			// Ensure only the expected MARK lines are included (no false positives).
			const markLines = Array.from(new Set(markRanges.map((r) => r.start.line))).sort((a, b) => a - b);
			assert.deepStrictEqual(markLines, expectedMarkLines);

			const actualKeys = markRanges.map(rangeKey).sort();
			const expectedKeys = expectedRanges.map(rangeKey).sort();
			assert.deepStrictEqual(actualKeys, expectedKeys);

			// Separator line should apply only to the MARK: - variants (not plain MARK:).
			const expectedSeparatorLines = [1, 2, 3];
			const separatorRanges = separatorCall.ranges;
			const separatorLines = Array.from(new Set(separatorRanges.map((r) => r.start.line))).sort((a, b) => a - b);
			assert.deepStrictEqual(separatorLines, expectedSeparatorLines);

			for (const r of separatorRanges) {
				assert.strictEqual(r.start.character, 0, 'Expected separator decoration to be whole-line anchored at column 0.');
				assert.strictEqual(r.end.character, 0, 'Expected separator decoration to be whole-line anchored at column 0.');
			}

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
		const config = vscode.workspace.getConfiguration('xcodeComments');
		await config.update('boldMarkLines', false, true);
		await config.update('markSeparatorLines', true, true);

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
				assert.strictEqual(callsAffectingMarkLine.length, 1, 'Expected only the separator decoration to apply to // MARK: - line.');

				const ranges = callsAffectingMarkLine[0].ranges;
				assert.ok(ranges.length >= 1, 'Expected at least one separator range.');
				for (const r of ranges) {
					assert.strictEqual(r.start.line, markLine);
					assert.strictEqual(r.start.character, 0);
					assert.strictEqual(r.end.character, 0);
				}
			} finally {
				try {
					Object.defineProperty(editor, 'setDecorations', { value: originalSetDecorations });
				} catch {
					(editor as unknown as { setDecorations: typeof originalSetDecorations }).setDecorations = originalSetDecorations;
				}
			}
		} finally {
			await config.update('boldMarkLines', undefined, true);
			await config.update('markSeparatorLines', undefined, true);
		}
	});

	test('Applies code color to inline backticks in regular // comments (including trailing), excluding // MARK:', async () => {
		const config = vscode.workspace.getConfiguration('xcodeComments');
		await config.update('codeColor', '#ff00ff', true);
		await config.update('colorInlineCodeInRegularComments', true, true);

		try {
			const content = [
				'struct Foo {',
				'// use `Foo` here',
				'let x = 1 // use `Bar` ok',
				'let url = \"http://example.com\" // use `URL` ok',
				'// MARK: - `Nope`',
				'/// - Returns: `Int`',
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

				const rangeKey = (r: vscode.Range) =>
					`${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;

				const expected = [
					new vscode.Range(1, 8, 1, 11), // Foo
					new vscode.Range(2, 18, 2, 21), // Bar
					(() => {
						const t = doc.lineAt(3).text;
						const commentStart = t.lastIndexOf('//');
						assert.ok(commentStart >= 0, 'Expected trailing // on URL line');
						const baseCol = commentStart + 2;
						const backtickOpen = t.indexOf('`', baseCol);
						const backtickClose = t.indexOf('`', backtickOpen + 1);
						assert.ok(backtickOpen >= 0 && backtickClose > backtickOpen, 'Expected `URL` in trailing comment');
						return new vscode.Range(3, backtickOpen + 1, 3, backtickClose);
					})(),
				];

				const notExpected = (() => {
					const t = doc.lineAt(4).text;
					const open = t.indexOf('`');
					const close = t.indexOf('`', open + 1);
					assert.ok(open >= 0 && close > open, 'Expected `Nope` on MARK line');
					return new vscode.Range(4, open + 1, 4, close);
				})();

				const allRanges = calls.flatMap((c) => Array.from(c.ranges));
				const actualKeys = allRanges.map(rangeKey);
				const expectedKeys = expected.map(rangeKey);

				for (const k of expectedKeys) {
					assert.ok(actualKeys.includes(k), `Expected inline code range to be decorated: ${k}`);
				}

				assert.ok(!actualKeys.includes(rangeKey(notExpected)), 'Did not expect inline code decoration inside // MARK: line.');
			} finally {
				// Restore the original method to avoid leaking into other tests.
				try {
					Object.defineProperty(editor, 'setDecorations', { value: originalSetDecorations });
				} catch {
					(editor as unknown as { setDecorations: typeof originalSetDecorations }).setDecorations = originalSetDecorations;
				}
			}
		} finally {
			await config.update('codeColor', undefined, true);
			await config.update('colorInlineCodeInRegularComments', undefined, true);
		}
	});

	test('Does not apply code color to inline backticks in regular // comments by default', async () => {
		const config = vscode.workspace.getConfiguration('xcodeComments');
		await config.update('codeColor', '#ff00ff', true);

		try {
			const content = ['struct Foo {', '// use `Foo` here', '}'].join('\n');

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

				const expected = new vscode.Range(1, 8, 1, 11); // Foo
				const rangeKey = (r: vscode.Range) =>
					`${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;

				const allRanges = calls.flatMap((c) => Array.from(c.ranges));
				const actualKeys = allRanges.map(rangeKey);

				assert.ok(
					!actualKeys.includes(rangeKey(expected)),
					`Did not expect inline code range to be decorated by default: ${rangeKey(expected)}`
				);
			} finally {
				// Restore the original method to avoid leaking into other tests.
				try {
					Object.defineProperty(editor, 'setDecorations', { value: originalSetDecorations });
				} catch {
					(editor as unknown as { setDecorations: typeof originalSetDecorations }).setDecorations = originalSetDecorations;
				}
			}
		} finally {
			await config.update('codeColor', undefined, true);
		}
	});

	test('Bolds all-caps callout labels including the colon', async () => {
		const content = ['struct Foo {', '    // NOTE: This is a note', '}'].join('\n');

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

			const lineNum = 1;
			const lineText = doc.lineAt(lineNum).text;
			const commentStart = lineText.indexOf('//');
			assert.ok(commentStart >= 0, 'Expected // comment');

			const noteIndex = lineText.indexOf('NOTE', commentStart);
			const colonIndex = lineText.indexOf(':', noteIndex);
			assert.ok(noteIndex >= 0 && colonIndex > noteIndex, 'Expected NOTE: in comment');

			const rangeKey = (r: vscode.Range) =>
				`${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;

			const expectedLabel = new vscode.Range(lineNum, noteIndex, lineNum, noteIndex + 4); // NOTE
			const expectedColon = new vscode.Range(lineNum, colonIndex, lineNum, colonIndex + 1); // :

			const allRanges = calls.flatMap((c) => Array.from(c.ranges));
			const actualKeys = allRanges.map(rangeKey);

			assert.ok(actualKeys.includes(rangeKey(expectedLabel)), `Expected NOTE label to be bolded: ${rangeKey(expectedLabel)}`);
			assert.ok(actualKeys.includes(rangeKey(expectedColon)), `Expected colon to be bolded: ${rangeKey(expectedColon)}`);
		} finally {
			try {
				Object.defineProperty(editor, 'setDecorations', { value: originalSetDecorations });
			} catch {
				(editor as unknown as { setDecorations: typeof originalSetDecorations }).setDecorations = originalSetDecorations;
			}
		}
	});

	test('Does not apply MARK separator line to plain // MARK: (no dash)', async () => {
		const config = vscode.workspace.getConfiguration('xcodeComments');
		await config.update('markSeparatorLines', true, true);

		try {
			const content = [
				'struct Foo {',
				'    // MARK: - HasLine',
				'    // MARK: NoLine',
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

				// The separator decoration uses whole-line anchored ranges (0..0).
				const separatorRanges = calls
					.flatMap((c) => Array.from(c.ranges))
					.filter((r) => r.start.character === 0 && r.end.character === 0);

				const separatorLines = Array.from(new Set(separatorRanges.map((r) => r.start.line))).sort((a, b) => a - b);
				assert.deepStrictEqual(separatorLines, [1], 'Expected separator line only for // MARK: - line.');
			} finally {
				try {
					Object.defineProperty(editor, 'setDecorations', { value: originalSetDecorations });
				} catch {
					(editor as unknown as { setDecorations: typeof originalSetDecorations }).setDecorations = originalSetDecorations;
				}
			}
		} finally {
			await config.update('markSeparatorLines', undefined, true);
		}
	});

	test('Converts // comment prefixes to /// (inserts / after //)', () => {
		const lines = [
			'struct Foo {',
			'    // A line comment',
			'    /// Already a doc comment',
			'    //MARK: - Still a line comment (no space)',
			'\t//\tTabs are fine',
			'    let s = \"// not a comment prefix\"',
			'}',
		];

		const inserts = computeConvertLineCommentsToDocCommentInserts(lines);
		assert.deepStrictEqual(
			inserts.map((e) => `${e.line}:${e.character}:${e.text}`),
			[
				'1:6:/',
				'3:6:/',
				'4:3:/',
			]
		);
	});

	test('Title-cases // MARK: titles in the current file (conservative)', () => {
		const lines = [
			'struct Foo {',
			'    // MARK: - section helpers',
			'    // MARK: - drag and drop',
			'    // MARK: - viewDidLoad helpers',
			'    // MARK: - @Unchecked Sendable',
			'    // MARK: - avoids per-page loading',
			'\t//MARK:-\tsection helpers\t',
			'    // MARK: - using `urlSession` helpers',
			'    // MARK:foo (should not match)',
			'    // Mark: - wrong case',
			'    /// MARK: - section helpers',
			'}',
		];

		const edits = computeTitleCaseMarkCommentsReplaceEdits(lines, '\n');
		assert.strictEqual(edits.length, 7);

		const editedLines = lines.slice();
		for (const e of edits) {
			assert.strictEqual(e.startLine, e.endLine, 'Expected per-line edits.');
			editedLines[e.startLine] = e.text;
		}

		assert.strictEqual(editedLines[1], '    // MARK: - Section Helpers');
		assert.strictEqual(editedLines[2], '    // MARK: - Drag and Drop');
		assert.strictEqual(editedLines[3], '    // MARK: - viewDidLoad Helpers');
		assert.strictEqual(editedLines[4], '    // MARK: - @unchecked Sendable');
		assert.strictEqual(editedLines[5], '    // MARK: - Avoids Per-page Loading');
		assert.strictEqual(editedLines[6], '\t//MARK:-\tSection Helpers\t');
		assert.strictEqual(editedLines[7], '    // MARK: - Using `urlSession` Helpers');

		// Non-matching lines should remain untouched.
		assert.strictEqual(editedLines[8], lines[8]);
		assert.strictEqual(editedLines[9], lines[9]);
		assert.strictEqual(editedLines[10], lines[10]);
	});

	test('Wraps simple // comment paragraphs to max length', () => {
		const lines = [
			'// This is a very long comment that should be wrapped into multiple lines for readability.',
			'// It continues here with more words.',
			'let x = 1',
		];

		const edits = computeWrapCommentsReplaceEdits(lines, 50, '\n', false);
		assert.strictEqual(edits.length, 1);
		assert.strictEqual(edits[0].startLine, 0);
		assert.strictEqual(edits[0].endLine, 1);

		const wrappedLines = edits[0].text.split('\n');
		assert.ok(wrappedLines.length > 2, 'Expected wrapping to increase line count.');
		for (const l of wrappedLines) {
			assert.ok(l.startsWith('//'), 'Expected wrapped lines to remain // comments.');
			assert.ok(l.length <= 50 || l === '//', `Expected line length <= 50, got ${l.length}: ${l}`);
		}
	});

	test('Wraps consistently regardless of indentation when wrapCountFromCommentStart is enabled', () => {
		const max = 60;
		const eol = '\n';

		const baseLines = [
			'// This is a very long comment that should wrap consistently even when it is indented in the file.',
			'// It should produce the same line breaks as an unindented comment.',
			'let x = 1',
		];

		const indent = '        ';
		const indentedLines = [
			indent + '// This is a very long comment that should wrap consistently even when it is indented in the file.',
			indent + '// It should produce the same line breaks as an unindented comment.',
			'let x = 1',
		];

		const baseEdits = computeWrapCommentsReplaceEdits(baseLines, max, eol, true);
		const indentedEdits = computeWrapCommentsReplaceEdits(indentedLines, max, eol, true);

		assert.strictEqual(baseEdits.length, 1);
		assert.strictEqual(indentedEdits.length, 1);

		const baseWrapped = baseEdits[0].text.split(eol);
		const indentedWrapped = indentedEdits[0].text.split(eol);

		const normalized = (ls: string[]) => ls.map((l) => l.trimStart());
		assert.deepStrictEqual(
			normalized(indentedWrapped),
			normalized(baseWrapped),
			'Expected wrapped line breaks to be identical aside from preserved indentation.'
		);

		for (const l of indentedWrapped) {
			assert.ok(l.startsWith(indent + '//'), `Expected wrapped indented line to keep indentation: ${l}`);
			const fromCommentStartLen = l.trimStart().length;
			assert.ok(
				fromCommentStartLen <= max || l.trimStart() === '//',
				`Expected length from comment start <= ${max}, got ${fromCommentStartLen}: ${l}`
			);
		}
	});

	test('Does not merge across all-caps callout label lines (e.g. NOTE:)', () => {
		const lines = ['// This is a comment', '// NOTE: This is a note about the comment'];

		// If the block were merged, it would reflow into a single line and produce an edit.
		const edits = computeWrapCommentsReplaceEdits(lines, 100, '\n', false);
		assert.strictEqual(edits.length, 0);
	});

	test('Does not wrap markdown bullet list blocks', () => {
		const lines = [
			'// - A bullet item with a very very very very very long line that should be preserved as-is',
			'//   and a continuation line that should also be preserved',
		];

		const edits = computeWrapCommentsReplaceEdits(lines, 40, '\n', false);
		assert.strictEqual(edits.length, 0);
	});

	test('Wraps /// doc keyword bullets by wrapping only the description and aligning continuation', () => {
		const lines = [
			'/// - Returns: This is a long return description that should wrap onto continuation lines and stay aligned.',
		];

		const edits = computeWrapCommentsReplaceEdits(lines, 60, '\n', false);
		assert.strictEqual(edits.length, 1);

		const wrapped = edits[0].text.split('\n');
		assert.ok(wrapped.length >= 2, 'Expected doc keyword wrapping to add continuation lines.');
		assert.ok(wrapped[0].includes('- Returns:'), 'Expected first line to retain keyword prefix.');
		assert.ok(!wrapped[1].includes('- Returns:'), 'Expected continuation lines to omit keyword prefix.');
		assert.ok(/^\/\/\/\s+/.test(wrapped[1]), `Expected continuation to start with /// and spaces: ${wrapped[1]}`);
	});

	test('Normalizes extra spaces after /// for doc keyword header lines', () => {
		const lines = ['///    - Returns: Something'];

		const edits = computeWrapCommentsReplaceEdits(lines, 200, '\n', false);
		assert.strictEqual(edits.length, 1);

		const wrapped = edits[0].text.split('\n');
		assert.deepStrictEqual(wrapped, ['/// - Returns: Something']);
	});

	test('Does not wrap inside fenced code blocks', () => {
		const lines = [
			'/// ```swift',
			'/// let x = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9',
			'/// ```',
		];

		const edits = computeWrapCommentsReplaceEdits(lines, 40, '\n', false);
		assert.strictEqual(edits.length, 0);
	});

	test('Does not wrap directive-like lines', () => {
		const lines = [
			'// swiftlint:disable line_length',
			'// swiftformat:disable wrapArguments',
		];

		const edits = computeWrapCommentsReplaceEdits(lines, 40, '\n', false);
		assert.strictEqual(edits.length, 0);
	});

	test('Registers workspace-wide MARK Title Case command', async () => {
		const context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
		activate(context);

		try {
			const commands = await vscode.commands.getCommands(true);
			assert.ok(
				commands.includes('xcodeComments.titleCaseMarkCommentsInWorkspace'),
				'Expected workspace-wide MARK Title Case command to be registered.'
			);
		} finally {
			for (const d of context.subscriptions) {
				try {
					d.dispose();
				} catch {
					// ignore
				}
			}
		}
	});
});

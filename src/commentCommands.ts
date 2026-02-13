export interface InsertEdit {
	line: number;
	character: number;
	text: string;
}

export interface ReplaceEdit {
	startLine: number;
	endLine: number; // inclusive
	text: string;
}

import { findLeadingCapsLabel } from './capsLabel';

type CommentPrefix = '//' | '///';

interface CommentLineParts {
	indent: string;
	prefix: CommentPrefix;
	afterPrefix: string; // includes original spacing after prefix
	originalLine: string;
}

const MIN_WRAP_LINE_LENGTH = 40;

const docTagSingleParamRegex = /^(\s*-\s+)(Parameter)(\s+)(\w+)(\s*:\s*)(.*)/i;
const docTagLineRegex = /^(\s*-\s+)(\w+)(\s*:\s*)(.*)/;

const listBulletRegex = /^(\s*)([-*+])\s+/;
const listNumberRegex = /^(\s*)(\d+)([.)])\s+/;

export function computeConvertLineCommentsToDocCommentInserts(lines: readonly string[]): InsertEdit[] {
	const edits: InsertEdit[] = [];

	for (let line = 0; line < lines.length; line++) {
		const text = lines[line];
		const commentStartCol = firstNonWhitespaceIndex(text);
		if (commentStartCol === null) continue;

		const rest = text.substring(commentStartCol);
		if (!rest.startsWith('//')) continue;
		if (rest.startsWith('///')) continue;

		// Convert `//` -> `///` by inserting a slash after the prefix.
		edits.push({ line, character: commentStartCol + 2, text: '/' });
	}

	return edits;
}

export function computeWrapCommentsReplaceEdits(
	lines: readonly string[],
	maxLineLength: number,
	eol: '\n' | '\r\n',
	wrapCountFromCommentStart = false
): ReplaceEdit[] {
	const edits: ReplaceEdit[] = [];
	const clampMax = Math.max(MIN_WRAP_LINE_LENGTH, Math.floor(maxLineLength || 0) || 0);

	for (let i = 0; i < lines.length; i++) {
		const firstParts = parseCommentLine(lines[i]);
		if (!firstParts) continue;

		const blockStart = i;
		const blockPrefix = firstParts.prefix;
		const blockIndent = firstParts.indent;

		let j = i + 1;
		for (; j < lines.length; j++) {
			const parts = parseCommentLine(lines[j]);
			if (!parts) break;
			if (parts.prefix !== blockPrefix) break;
			if (parts.indent !== blockIndent) break;
		}

		const blockEndInclusive = j - 1;
		const blockLines = lines.slice(blockStart, j);
		const wrapped = wrapCommentBlock(blockLines, clampMax, wrapCountFromCommentStart);

		const same =
			wrapped.length === blockLines.length && wrapped.every((l, idx) => l === blockLines[idx]);
		if (!same) {
			edits.push({
				startLine: blockStart,
				endLine: blockEndInclusive,
				text: wrapped.join(eol),
			});
		}

		i = blockEndInclusive;
	}

	return edits;
}

function wrapCommentBlock(
	blockLines: readonly string[],
	maxLineLength: number,
	wrapCountFromCommentStart: boolean
): string[] {
	const parts = blockLines.map(parseCommentLine);
	if (parts.some((p) => !p)) {
		return Array.from(blockLines);
	}

	const first = parts[0] as CommentLineParts;
	const indent = first.indent;
	const prefix = first.prefix;

	const output: string[] = [];

	let inFence = false;
	let listMode = false;

	const flushParagraph = (paragraph: string[]) => {
		if (paragraph.length === 0) return;

		const availableWidth = Math.max(
			1,
			maxLineLength -
				((wrapCountFromCommentStart ? 0 : indent.length) + prefix.length + 1)
		);
		const joined = paragraph.map((p) => p.trim()).filter(Boolean).join(' ');
		const wrapped = wrapWords(joined, availableWidth);
		for (const line of wrapped) {
			if (line.length === 0) output.push(indent + prefix);
			else output.push(indent + prefix + ' ' + line);
		}
		paragraph.length = 0;
	};

	const paragraph: string[] = [];

	for (let i = 0; i < parts.length; i++) {
		const p = parts[i] as CommentLineParts;
		const after = p.afterPrefix;
		const afterTrimStart = after.trimStart();

		const isBlank = after.trim().length === 0;
		const isFence = isFenceLine(afterTrimStart);

		if (inFence) {
			output.push(p.originalLine);
			if (isFence) {
				inFence = false;
			}
			continue;
		}

		if (isFence) {
			flushParagraph(paragraph);
			listMode = false;
			inFence = true;
			output.push(p.originalLine);
			continue;
		}

		if (isBlank) {
			flushParagraph(paragraph);
			listMode = false;
			output.push(indent + prefix);
			continue;
		}

		if (isDirectiveLine(afterTrimStart) || isTableOrAsciiArtLine(afterTrimStart)) {
			flushParagraph(paragraph);
			listMode = false;
			output.push(p.originalLine);
			continue;
		}

		if (prefix === '///') {
			const docTag = tryParseDocTagLine(after);
			if (docTag) {
				flushParagraph(paragraph);
				listMode = false;

				const { keywordPrefixText, description } = docTag;
				const continuationPrefix = ' '.repeat(keywordPrefixText.length);

				let descParts: string[] = [];
				if (description.trim().length > 0) {
					descParts.push(description.trim());
				}

				// Consume aligned continuation lines: `///` + spaces aligning to description start.
				let j = i + 1;
				for (; j < parts.length; j++) {
					const next = parts[j] as CommentLineParts;
					if (next.afterPrefix.trim().length === 0) break;

					const nextAfter = next.afterPrefix;
					const nextAfterTrimStart = nextAfter.trimStart();
					if (isFenceLine(nextAfterTrimStart)) break;
					if (isDirectiveLine(nextAfterTrimStart) || isTableOrAsciiArtLine(nextAfterTrimStart)) break;
					if (isMarkdownListItem(nextAfterTrimStart)) break;
					if (!nextAfter.startsWith(continuationPrefix)) break;

					const remainder = nextAfter.substring(continuationPrefix.length);
					if (remainder.trim().length === 0) break;

					descParts.push(remainder.trim());
				}

				const fullDesc = descParts.join(' ').trim();
				const availableWidth = Math.max(
					1,
					maxLineLength -
						((wrapCountFromCommentStart ? 0 : indent.length) +
							prefix.length +
							keywordPrefixText.length)
				);
				const wrappedDesc = fullDesc.length > 0 ? wrapWords(fullDesc, availableWidth) : [''];

				if (wrappedDesc.length === 0) {
					output.push(indent + prefix + keywordPrefixText.trimEnd());
				} else {
					const firstLine = wrappedDesc[0];
					output.push(indent + prefix + keywordPrefixText + firstLine);
					for (let k = 1; k < wrappedDesc.length; k++) {
						output.push(indent + prefix + continuationPrefix + wrappedDesc[k]);
					}
				}

				i = j - 1;
				continue;
			}
		}

		// Treat leading all-caps labels like "NOTE:" / "IMPORTANT:" as hard paragraph boundaries.
		// This ensures wrapping doesn't merge preceding text into callout-style lines.
		if (findLeadingCapsLabel(after)) {
			flushParagraph(paragraph);
			listMode = false;
		}

		const isListItem = isMarkdownListItem(afterTrimStart);
		if (isListItem) {
			flushParagraph(paragraph);
			listMode = true;
			output.push(p.originalLine);
			continue;
		}

		if (listMode) {
			// Preserve list continuation lines verbatim until a blank comment line ends the list.
			output.push(p.originalLine);
			continue;
		}

		// Normal paragraph: collect content (drop a single leading space after prefix if present).
		const normalized = after.startsWith(' ') ? after.substring(1) : after;
		paragraph.push(normalized);
	}

	flushParagraph(paragraph);

	return output;
}

function tryParseDocTagLine(afterPrefix: string): { keywordPrefixText: string; description: string } | null {
	const spMatch = docTagSingleParamRegex.exec(afterPrefix);
	if (spMatch) {
		const [, prefix, keyword, space, name, colon, description] = spMatch;
		return {
			keywordPrefixText: `${prefix}${keyword}${space}${name}${colon}`,
			description,
		};
	}

	const keywordMatch = docTagLineRegex.exec(afterPrefix);
	if (keywordMatch) {
		const [, prefix, word, colon, description] = keywordMatch;
		return {
			keywordPrefixText: `${prefix}${word}${colon}`,
			description,
		};
	}

	return null;
}

function isFenceLine(afterPrefixTrimStart: string): boolean {
	return afterPrefixTrimStart.startsWith('```');
}

function isDirectiveLine(afterPrefixTrimStart: string): boolean {
	return /^(swiftlint(?::|\b)|swiftformat(?::|\b)|clang-format\b|sourcery:)/i.test(afterPrefixTrimStart);
}

function isTableOrAsciiArtLine(afterPrefixTrimStart: string): boolean {
	const pipes = (afterPrefixTrimStart.match(/\|/g) || []).length;
	if (pipes >= 2) return true;
	if (/[-=]{4,}/.test(afterPrefixTrimStart)) return true;
	return false;
}

function isMarkdownListItem(afterPrefixTrimStart: string): boolean {
	return listBulletRegex.test(afterPrefixTrimStart) || listNumberRegex.test(afterPrefixTrimStart);
}

function parseCommentLine(line: string): CommentLineParts | null {
	const commentStartCol = firstNonWhitespaceIndex(line);
	if (commentStartCol === null) return null;

	const rest = line.substring(commentStartCol);
	if (rest.startsWith('///') && !rest.startsWith('////')) {
		return {
			indent: line.substring(0, commentStartCol),
			prefix: '///',
			afterPrefix: line.substring(commentStartCol + 3),
			originalLine: line,
		};
	}

	if (rest.startsWith('//') && !rest.startsWith('///')) {
		return {
			indent: line.substring(0, commentStartCol),
			prefix: '//',
			afterPrefix: line.substring(commentStartCol + 2),
			originalLine: line,
		};
	}

	return null;
}

function firstNonWhitespaceIndex(text: string): number | null {
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch !== ' ' && ch !== '\t') return i;
	}
	return null;
}

function wrapWords(text: string, maxWidth: number): string[] {
	const width = Math.max(1, Math.floor(maxWidth));
	const tokens = text.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [''];

	const lines: string[] = [];
	let current = '';

	for (const token of tokens) {
		if (current.length === 0) {
			current = token;
			continue;
		}

		if (current.length + 1 + token.length <= width) {
			current += ' ' + token;
		} else {
			lines.push(current);
			current = token;
		}
	}

	if (current.length > 0) lines.push(current);
	return lines;
}

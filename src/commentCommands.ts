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

import { findDocColonHeading, findLeadingCapsLabel } from './capsLabel';

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

// Recognized Swift doc callout keywords (lowercase for comparison). This mirrors
// `KNOWN_TAGS` in `src/decorator.ts` so wrapping behavior matches decoration behavior.
const KNOWN_DOC_TAGS = new Set([
	'attention',
	'author',
	'authors',
	'bug',
	'complexity',
	'copyright',
	'date',
	'experiment',
	'important',
	'invariant',
	'note',
	'parameter',
	'parameters',
	'postcondition',
	'precondition',
	'remark',
	'remarks',
	'requires',
	'returns',
	'seealso',
	'since',
	'tag',
	'throws',
	'todo',
	'version',
	'warning',
]);

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
	wrapCountFromCommentStart = false,
	avoidWrappingAtPunctuationBreaks = false
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
		const wrapped = wrapCommentBlock(
			blockLines,
			clampMax,
			wrapCountFromCommentStart,
			avoidWrappingAtPunctuationBreaks
		);

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

// Matches a line that is a // MARK: comment (Xcode-like), same semantics as `src/decorator.ts`.
// Group 1: leading whitespace
// Group 2: the // prefix
// Group 3: everything after // that begins with MARK:
const markLineRegex = /^(\s*)(\/\/)(\s*MARK:(?=\s|$|-).*)$/;

export function computeTitleCaseMarkCommentsReplaceEdits(
	lines: readonly string[],
	eol: '\n' | '\r\n'
): ReplaceEdit[] {
	const edits: ReplaceEdit[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = markLineRegex.exec(line);
		if (!match) continue;

		const indent = match[1];
		const slashes = match[2];
		const afterSlashes = match[3];

		const markIndex = afterSlashes.indexOf('MARK:');
		if (markIndex < 0) continue;

		const afterColonIndex = markIndex + 'MARK:'.length;
		const afterColon = afterSlashes.substring(afterColonIndex);

		// If this is a separator MARK line ("MARK: - ..."), treat the dash portion as structural
		// and only Title Case the text after it.
		const dashMatch = /^\s*-\s*/.exec(afterColon);
		const structuralPrefixAfterColon = dashMatch ? dashMatch[0] : '';
		const titleWithLeadingSpace = dashMatch ? afterColon.substring(dashMatch[0].length) : afterColon;

		const leadingSpaceMatch = /^\s*/.exec(titleWithLeadingSpace);
		const leadingSpace = leadingSpaceMatch ? leadingSpaceMatch[0] : '';
		const titleCoreWithTrailingSpace = titleWithLeadingSpace.substring(leadingSpace.length);

		const trailingSpaceMatch = /\s*$/.exec(titleCoreWithTrailingSpace);
		const trailingSpace = trailingSpaceMatch ? trailingSpaceMatch[0] : '';
		const titleCore = titleCoreWithTrailingSpace.substring(
			0,
			Math.max(0, titleCoreWithTrailingSpace.length - trailingSpace.length)
		);

		const titleCoreCased = titleCaseMarkTitlePreservingBackticks(titleCore);
		const rebuiltAfterSlashes =
			afterSlashes.substring(0, afterColonIndex) +
			structuralPrefixAfterColon +
			leadingSpace +
			titleCoreCased +
			trailingSpace;

		const rebuiltLine = indent + slashes + rebuiltAfterSlashes;
		if (rebuiltLine === line) continue;

		edits.push({ startLine: i, endLine: i, text: rebuiltLine.split('\n').join(eol) });
	}

	return edits;
}

function titleCaseMarkTitlePreservingBackticks(input: string): string {
	if (input.length === 0) return input;

	let out = '';
	let inBackticks = false;
	let segmentStart = 0;

	const flushSegment = (endExclusive: number) => {
		if (endExclusive <= segmentStart) return;
		const segment = input.substring(segmentStart, endExclusive);
		out += inBackticks ? segment : titleCaseMarkTextSegment(segment);
	};

	for (let i = 0; i < input.length; i++) {
		if (input[i] !== '`') continue;
		flushSegment(i);
		out += '`';
		inBackticks = !inBackticks;
		segmentStart = i + 1;
	}

	flushSegment(input.length);
	return out;
}

function titleCaseMarkTextSegment(segment: string): string {
	const MINOR_WORDS = new Set([
		'a',
		'an',
		'the',
		'and',
		'but',
		'or',
		'nor',
		'for',
		'so',
		'yet',
		'as',
		'at',
		'by',
		'for',
		'from',
		'in',
		'into',
		'of',
		'on',
		'onto',
		'over',
		'per',
		'to',
		'up',
		'via',
		'vs',
		'vs.',
		'with',
	]);

	// Preserve whitespace exactly.
	const parts = segment.split(/(\s+)/);

	const isWordToken = (token: string): boolean => {
		return /^([^A-Za-z]*)([A-Za-z][A-Za-z']*)([^A-Za-z]*)$/.test(token);
	};

	const wordTokenIndices: number[] = [];
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p.length === 0) continue;
		if (/^\s+$/.test(p)) continue;
		if (!isWordToken(p)) continue;
		wordTokenIndices.push(i);
	}

	const firstWordTokenIndex = wordTokenIndices.length > 0 ? wordTokenIndices[0] : -1;
	const lastWordTokenIndex =
		wordTokenIndices.length > 0 ? wordTokenIndices[wordTokenIndices.length - 1] : -1;

	return parts
		.map((p, idx) => {
			if (p.length === 0) return p;
			if (/^\s+$/.test(p)) return p;
			const isFirst = idx === firstWordTokenIndex;
			const isLast = idx === lastWordTokenIndex;
			return titleCaseMarkToken(p, MINOR_WORDS, isFirst, isLast);
		})
		.join('');
}

function titleCaseMarkToken(
	token: string,
	minorWords: ReadonlySet<string>,
	isFirstWord: boolean,
	isLastWord: boolean
): string {
	// Conservative behavior: leave identifier-like tokens intact.
	// This includes snake_case and tokens containing digits.
	if (token.includes('_') || /\d/.test(token)) {
		return token;
	}

	// Hyphenated lowercase words should still become Title Case, e.g. "per-page" -> "Per-page".
	// We keep this conservative by only capitalizing the first segment.
	if (token.includes('-')) {
		const hyphenMatch = /^([^A-Za-z]*)([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/.exec(token);
		if (!hyphenMatch) return token;

		const [, leading, core, trailing] = hyphenMatch;

		// If the core has any uppercase already, treat it as intentional and leave it unchanged
		// (except for `@unchecked` normalization handled below).
		if (core !== core.toLowerCase()) {
			if (leading.includes('@') && core.toLowerCase() === 'unchecked') {
				return leading + 'unchecked' + trailing;
			}
			return token;
		}

		const parts = core.split(/(-)/);
		for (let i = 0; i < parts.length; i += 2) {
			const word = parts[i];
			if (word.length === 0) continue;
			if (i === 0) {
				parts[i] = word[0].toUpperCase() + word.substring(1);
			}
		}

		return leading + parts.join('') + trailing;
	}

	// Split out leading/trailing non-letter punctuation so we can title-case "word," -> "Word,".
	const match = /^([^A-Za-z]*)([A-Za-z][A-Za-z']*)([^A-Za-z]*)$/.exec(token);
	if (!match) return token;

	const [, leading, word, trailing] = match;
	if (word !== word.toLowerCase()) {
		// Swift has a special-case attribute `@unchecked` (lowercase). If it appears as
		// `@Unchecked`, normalize it back to lowercase.
		if (leading.includes('@') && word.toLowerCase() === 'unchecked') {
			return leading + 'unchecked' + trailing;
		}
		return token;
	}

	// Swift `@unchecked` should always be lowercase.
	if (leading.includes('@') && word === 'unchecked') {
		return leading + word + trailing;
	}

	if (!isFirstWord && !isLastWord && minorWords.has(word)) {
		return leading + word + trailing;
	}

	const cased = word[0].toUpperCase() + word.substring(1);
	return leading + cased + trailing;
}

function wrapCommentBlock(
	blockLines: readonly string[],
	maxLineLength: number,
	wrapCountFromCommentStart: boolean,
	avoidWrappingAtPunctuationBreaks: boolean
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

	const endsWithSentencePunctuation = (text: string): boolean => {
		const t = text.trimEnd();
		// Sentence enders (. ? !) optionally followed by common closers: ) ] " '
		return /[.!?][)\]"']*$/.test(t);
	};

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

				const {
					keywordPrefixText: rawKeywordPrefixText,
					listPrefixText: rawListPrefixText,
					description,
					tagWordLower,
				} = docTag;

				// Ensure we never emit more than one leading whitespace character between the
				// doc comment prefix (`///`) and the first non-whitespace character of text.
				// This only applies to the doc-tag "header" prefix (e.g. "- Returns: ").
				const shouldNormalizeLeadingWhitespace = KNOWN_DOC_TAGS.has(tagWordLower);
				const renderedKeywordPrefixText = shouldNormalizeLeadingWhitespace
					? normalizeDocTagKeywordPrefixText(rawKeywordPrefixText)
					: rawKeywordPrefixText;
				const renderedListPrefixText = shouldNormalizeLeadingWhitespace
					? normalizeDocTagKeywordPrefixText(rawListPrefixText)
					: rawListPrefixText;

				// Continuation lines should be indented consistently relative to the list bullet
				// (i.e. aligned after "- "), rather than aligning to the varying item name length.
				const renderedListContinuationPrefix = ' '.repeat(renderedListPrefixText.length);

				// Accept both legacy (description-aligned) and new (list-prefix-aligned) continuation styles.
				const rawDescContinuationPrefix = ' '.repeat(rawKeywordPrefixText.length);
				const renderedDescContinuationPrefix = ' '.repeat(renderedKeywordPrefixText.length);
				const rawListContinuationPrefix = ' '.repeat(rawListPrefixText.length);
				const renderedListContinuationPrefixAlt = ' '.repeat(renderedListPrefixText.length);

				let descParts: string[] = [];
				if (description.trim().length > 0) {
					descParts.push(description.trim());
				}

				// Consume aligned continuation lines: `///` + spaces aligning to either description start
				// (legacy) or list prefix (current).
				let j = i + 1;
				for (; j < parts.length; j++) {
					const next = parts[j] as CommentLineParts;
					if (next.afterPrefix.trim().length === 0) break;

					const nextAfter = next.afterPrefix;
					const nextAfterTrimStart = nextAfter.trimStart();
					if (isFenceLine(nextAfterTrimStart)) break;
					if (isDirectiveLine(nextAfterTrimStart) || isTableOrAsciiArtLine(nextAfterTrimStart)) break;
					if (isMarkdownListItem(nextAfterTrimStart)) break;
					let matchedPrefix: string | null = null;
					// Prefer longer prefixes first to avoid a shorter match stealing a longer one.
					if (nextAfter.startsWith(rawDescContinuationPrefix)) {
						matchedPrefix = rawDescContinuationPrefix;
					} else if (nextAfter.startsWith(renderedDescContinuationPrefix)) {
						matchedPrefix = renderedDescContinuationPrefix;
					} else if (nextAfter.startsWith(rawListContinuationPrefix)) {
						matchedPrefix = rawListContinuationPrefix;
					} else if (nextAfter.startsWith(renderedListContinuationPrefixAlt)) {
						matchedPrefix = renderedListContinuationPrefixAlt;
					}
					if (!matchedPrefix) break;

					const remainder = nextAfter.substring(matchedPrefix.length);
					if (remainder.trim().length === 0) break;

					descParts.push(remainder.trim());
				}

				const fullDesc = descParts.join(' ').trim();
				const availableWidth = Math.max(
					1,
					maxLineLength -
						((wrapCountFromCommentStart ? 0 : indent.length) +
							prefix.length +
							renderedKeywordPrefixText.length)
				);
				const wrappedDesc = fullDesc.length > 0 ? wrapWords(fullDesc, availableWidth) : [''];

				if (wrappedDesc.length === 0) {
					output.push(indent + prefix + renderedKeywordPrefixText.trimEnd());
				} else {
					const firstLine = wrappedDesc[0];
					output.push(indent + prefix + renderedKeywordPrefixText + firstLine);
					for (let k = 1; k < wrappedDesc.length; k++) {
						output.push(indent + prefix + renderedListContinuationPrefix + wrappedDesc[k]);
					}
				}

				i = j - 1;
				continue;
			}

			// Treat non-list "heading:" lines (e.g. "/// Notes:") as hard boundaries and
			// preserve them verbatim. This ensures wrapping doesn't merge paragraphs into headings.
			if (!isMarkdownListItem(afterTrimStart) && findDocColonHeading(after)) {
				flushParagraph(paragraph);
				listMode = false;
				output.push(p.originalLine);
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
		if (
			avoidWrappingAtPunctuationBreaks &&
			paragraph.length > 0 &&
			endsWithSentencePunctuation(paragraph[paragraph.length - 1])
		) {
			flushParagraph(paragraph);
		}
		paragraph.push(normalized);
	}

	flushParagraph(paragraph);

	return output;
}

function normalizeDocTagKeywordPrefixText(keywordPrefixText: string): string {
	if (keywordPrefixText.length === 0) return keywordPrefixText;
	if (!/^\s/.test(keywordPrefixText)) return keywordPrefixText;
	return ' ' + keywordPrefixText.trimStart();
}

function tryParseDocTagLine(afterPrefix: string): {
	keywordPrefixText: string;
	listPrefixText: string;
	description: string;
	tagWordLower: string;
} | null {
	const spMatch = docTagSingleParamRegex.exec(afterPrefix);
	if (spMatch) {
		const [, prefix, keyword, space, name, colon, description] = spMatch;
		return {
			keywordPrefixText: `${prefix}${keyword}${space}${name}${colon}`,
			listPrefixText: prefix,
			description,
			tagWordLower: keyword.toLowerCase(),
		};
	}

	const keywordMatch = docTagLineRegex.exec(afterPrefix);
	if (keywordMatch) {
		const [, prefix, word, colon, description] = keywordMatch;
		return {
			keywordPrefixText: `${prefix}${word}${colon}`,
			listPrefixText: prefix,
			description,
			tagWordLower: word.toLowerCase(),
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

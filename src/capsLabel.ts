/**
 * Utilities for detecting all-caps "callout" labels like `NOTE:` or `IMPORTANT:`
 * at the start of Swift line comments.
 *
 * This logic is intentionally shared between decoration and wrapping so the wrap
 * command can respect the same boundaries that trigger bold formatting.
 */

export interface CapsLabelMatch {
	/**
	 * Index in the provided string where the label starts (after leading whitespace).
	 */
	labelStart: number;
	/**
	 * Index in the provided string where the label ends (exclusive), excluding trailing whitespace.
	 */
	labelEnd: number;
	/**
	 * Index in the provided string of the colon that terminates the label.
	 */
	colonIndex: number;
	/**
	 * The raw label text (without the colon), preserving internal whitespace.
	 */
	labelText: string;
}

/**
 * Detects an all-caps label at the start of a comment's text.
 *
 * Mirrors the decoration logic in `DocstringDecorator`:
 * - skips leading whitespace
 * - requires a colon after the candidate
 * - requires at least one A-Z
 * - candidate must match `^[A-Z0-9_]+(?:[ \\t]+[A-Z0-9_]+)*$`
 *
 * Pass the string that begins immediately after the comment prefix (`//` or `///`).
 * For example, for `// NOTE: hi`, pass `" NOTE: hi"`.
 */
export function findLeadingCapsLabel(afterPrefix: string): CapsLabelMatch | null {
	let labelStart = 0;
	while (labelStart < afterPrefix.length && /\s/.test(afterPrefix[labelStart])) {
		labelStart++;
	}
	if (labelStart >= afterPrefix.length) return null;

	const colonIndex = afterPrefix.indexOf(':', labelStart);
	if (colonIndex === -1) return null;

	let labelEnd = colonIndex;
	while (labelEnd > labelStart && /\s/.test(afterPrefix[labelEnd - 1])) {
		labelEnd--;
	}
	if (labelEnd <= labelStart) return null;

	const candidate = afterPrefix.substring(labelStart, labelEnd);
	if (!/[A-Z]/.test(candidate)) return null;
	if (!/^[A-Z0-9_]+(?:[ \t]+[A-Z0-9_]+)*$/.test(candidate)) return null;

	return {
		labelStart,
		labelEnd,
		colonIndex,
		labelText: candidate,
	};
}

export interface DocColonHeadingMatch {
	/**
	 * Index in the provided string where the heading starts (after leading whitespace).
	 */
	headingStart: number;
	/**
	 * Index in the provided string where the heading ends (exclusive), excluding whitespace
	 * that might precede the colon.
	 */
	headingEnd: number;
	/**
	 * Index in the provided string of the colon that terminates the heading.
	 */
	colonIndex: number;
	/**
	 * The raw heading text (without the colon), preserving internal whitespace.
	 */
	headingText: string;
}

/**
 * Detects a non-list "section heading" in a doc comment line that ends with a colon.
 *
 * Pass the string that begins immediately after the doc comment prefix (`///`).
 * For example, for `/// Notes:`, pass `" Notes:"` (including any original spacing).
 *
 * This function is intentionally shared between decoration and wrapping so behavior matches.
 */
export function findDocColonHeading(afterPrefix: string): DocColonHeadingMatch | null {
	let headingStart = 0;
	while (headingStart < afterPrefix.length && /\s/.test(afterPrefix[headingStart])) {
		headingStart++;
	}
	if (headingStart >= afterPrefix.length) return null;

	// Require the last non-whitespace character to be a colon.
	let endTrim = afterPrefix.length;
	while (endTrim > headingStart && /\s/.test(afterPrefix[endTrim - 1])) {
		endTrim--;
	}
	if (endTrim <= headingStart) return null;
	if (afterPrefix[endTrim - 1] !== ':') return null;

	const colonIndex = endTrim - 1;

	// Exclude any whitespace that precedes the colon from the heading span.
	let headingEnd = colonIndex;
	while (headingEnd > headingStart && /\s/.test(afterPrefix[headingEnd - 1])) {
		headingEnd--;
	}
	if (headingEnd <= headingStart) return null;

	const candidate = afterPrefix.substring(headingStart, headingEnd);
	if (!/^[A-Za-z0-9_]+(?:[ \t]+[A-Za-z0-9_]+)*$/.test(candidate)) return null;

	return {
		headingStart,
		headingEnd,
		colonIndex,
		headingText: candidate,
	};
}


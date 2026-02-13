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


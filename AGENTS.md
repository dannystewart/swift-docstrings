# Swift Docstrings

## Project Overview

This is a VS Code extension that renders Swift `///` doc comments in a proportional sans-serif font (like Xcode), while keeping regular `//` comments monospace. The extension uses VS Code's decoration API to selectively apply different fonts and styles to different parts of doc comments.

## Architecture

### Core Components

- **`src/extension.ts`**: Extension entry point
  - Manages the lifecycle of the `DocstringDecorator` instance
  - Sets up event listeners for editor changes, document edits (debounced at 50ms), and configuration changes
  - Handles activation/deactivation and cleanup

- **`src/decorator.ts`**: Main parsing and decoration logic
  - `DocstringDecorator` class manages five decoration types:
    - `slashDecoration`: The `///` prefix (dimmed)
    - `indentDecoration`: Structural whitespace, dashes, colons (monospace for alignment)
    - `textDecoration`: Regular doc text (proportional font)
    - `codeDecoration`: Inline code in backticks and parameter names (monospace)
    - `keywordDecoration`: Doc keywords like `Parameters`, `Returns`, etc. (proportional, optionally colored)
  - Parses each `///` line to identify:
    - Doc keyword patterns (`- Parameter name:`, `- Returns:`, etc.)
    - Inline code segments (backtick-wrapped)
    - Leading whitespace for structural alignment
  - Uses regex matching for Swift doc comment patterns and known keywords

### Configuration

Settings in `package.json` under `swiftDocstrings.*`:

- `enabled`: Toggle the extension on/off
- `fontFamily`: Proportional font for doc text
- `fontSize`: Optional size override
- `monospaceFontSize`: Optional size override for monospace segments inside doc comments
- `codeColor`: Color for inline code and parameter names
- `keywordColor`: Color for doc keywords

## Key Technical Details

- Extension activates only for Swift files (`onLanguage:swift`)
- Document edits trigger redecorations with 50ms debounce for performance
- Configuration changes rebuild decoration types and reapply to active editor
- All decoration ranges are recalculated on each edit (no incremental updates)
- Uses VS Code theme colors where possible (`editorLineNumber.foreground` for slashes)

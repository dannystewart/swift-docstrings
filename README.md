# Swift Docstrings

Xcode-style proportional font rendering for Swift `///` doc comments in VS Code.

Regular `//` comments stay monospace. Doc comments with `///` render in a proportional sans-serif font, making longer documentation easier to read—just like Xcode.

## Features

- **Proportional font** for `///` doc comment text
- **Inline code** in backticks reverts to monospace
- **Bold doc tags** for keywords like `Parameters`, `Returns`, `Throws`, etc.
- **Monospace parameter names** under `Parameters:` blocks
- **Aligned indentation**—structural whitespace stays monospace so list items line up properly

## Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `swiftDocstrings.enabled` | `true` | Enable or disable the extension |
| `swiftDocstrings.fontFamily` | System sans-serif | Proportional font for doc text |
| `swiftDocstrings.fontSize` | *(inherit)* | Optional font size override (e.g. `0.95em`, `13px`) |
| `swiftDocstrings.codeColor` | *(inherit)* | Color for inline code and parameter names |
| `swiftDocstrings.tagColor` | *(inherit)* | Color for doc tag keywords (Parameters, Returns, etc.) |
| `swiftDocstrings.boldMarkLines` | `true` | Bold the contents of `// MARK:` comment lines, similar to Xcode |
| `swiftDocstrings.maxCommentLineLength` | `100` | Maximum line length for the Wrap Comments command |

Color settings accept any CSS color value. Leave them empty to inherit your theme's doc comment color.

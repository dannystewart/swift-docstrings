# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

## [Unreleased]

## [0.3.0] (2026-02-12)

### Added

- Adds command to convert Swift line comments (`//`) to documentation comments (`///`).
- Adds command to wrap Swift comments to a configurable line length while preserving code blocks, directives, tables, lists, and doc tag formatting.
- Adds `maxCommentLineLength` setting (default: 100) to control comment wrap width.
- Adds dimmed styling (50% opacity) for markdown delimiter characters (backticks, asterisks, underscores) in docstrings to match Xcode's rendering style.
- Adds `boldMarkLines` configuration option (default: true) to bold `// MARK:` comment lines matching Xcode's visual style.

## [0.2.0] (2026-02-12)

### Added

- Adds Markdown bold and italic text formatting support for Swift documentation comments, including `**bold**`, `__bold__`, `*italic*`, `_italic_`, and `***bold-italic***` syntax patterns.

### Changed

- Improves inline formatting in documentation comments to support backtick code spans and Markdown emphasis (bold/italic) that continue across multiple consecutive lines.

### Fixed

- Fixes Markdown bold and italic formatting incorrectly applying inside inline code spans.

## [0.1.0] (2026-02-12)

- Initial release.

<!-- Links -->
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html

<!-- Versions -->
[unreleased]: https://github.com/dannystewart/swift-docstrings/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/dannystewart/swift-docstrings/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dannystewart/swift-docstrings/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dannystewart/swift-docstrings/releases/tag/v0.1.0

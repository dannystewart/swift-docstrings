# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

## [Unreleased]

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
[unreleased]: https://github.com/dannystewart/swift-docstrings/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dannystewart/swift-docstrings/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dannystewart/swift-docstrings/releases/tag/v0.1.0

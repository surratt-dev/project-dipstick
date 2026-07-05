# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

All file operations, inferences, and decisions must be constrained to files within the current directory. Do not read, reference, or draw conclusions from files outside this directory.

## Workspace

This is a documentation-only workspace. There is no application code, build system, or test suite.

Source documents may contain typos and informal language — treat them as draft inputs, not polished references.

## File Naming Convention

Derived files follow the pattern: `<Source Name> - <Descriptor>.md`

Examples:
- `Engineering Health Check Summary - Summary.md` — summary of a source doc
- `Engineering Health Check - Open Questions.md` — gap analysis
- `voting mechanics - enhanced.md` — enhanced version of a source doc

## Working Approach

- When asked to analyze a document, read the original source file, not only derived files
- Ask clarifying questions before producing enhanced or opinionated output
- Do not create files unless explicitly asked; do not rewrite existing files unless that is the stated task

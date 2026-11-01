# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - initial public release (unreleased)

### Added

- Bidirectional converter between the .curt single-file AI-conversation
  format and the IETF vCon container (draft-ietf-vcon-vcon-core-05):
  `curtToVcon`, `vconToCurt`, plus file-level wrappers `curtFileToVcon` and
  `vconToCurtFile`.
- CLI with `to-vcon` and `to-curt` subcommands.
- Party objects now carry the draft §4.4.11 `type` parameter —
  `"person"` for the .curt `user` role, `"bot"` for
  assistant/system/tool — in addition to the role string in `name`
  (free-form per §4.4.5), which keeps the round trip lossless.

### Changed

- Parties are typed per draft §4.4.11 (`person`/`bot`) instead of relying
  solely on `name` = role string, which stretched vCon's human-party
  semantics.
- Version bumped straight to 1.0.0 for the initial public release: the
  converter is spec-verified against draft-ietf-vcon-vcon-core-05, fully
  tested (round-trip fixtures), and the API surface is considered stable.

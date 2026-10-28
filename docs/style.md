# Code style

NeuroChat follows the [Google style guides](https://google.github.io/styleguide/)
for every language in the repo. Formatters do the mechanical part, so you rarely
have to think about it:

```bash
pip install -e ".[dev]"   # pytest, Ruff, shfmt and ShellCheck (pinned versions)
scripts/format.sh         # format everything
scripts/lint.sh           # check without changing anything (CI runs this too)
```

Prettier runs through `npx`, so formatting JavaScript, HTML and CSS needs
Node.js. Your editor picks up the basics (indentation, line endings, final
newline) from `.editorconfig`.

| Language     | Guide                                                                           | Tool and settings                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Python       | [Python style guide](https://google.github.io/styleguide/pyguide.html)          | Ruff (`pyproject.toml`): 80 columns, 4-space indent, Google docstrings, one import per line sorted the Google way, naming and likely-bug checks |
| JavaScript   | [JavaScript style guide](https://google.github.io/styleguide/jsguide.html)      | Prettier (`.prettierrc.json`, the settings of Google's `gts`): 80 columns, 2-space indent, single quotes, semicolons, no spaces inside braces   |
| HTML and CSS | [HTML/CSS style guide](https://google.github.io/styleguide/htmlcssguide.html)   | Prettier: 2-space indent, double-quoted attributes                                                                                              |
| Shell        | [Shell style guide](https://google.github.io/styleguide/shellguide.html)        | shfmt (`-i 2 -ci -bn`: 2-space indent, indented `case` branches, operators at the start of a wrapped line) and ShellCheck (warnings and errors) |
| Markdown     | [Markdown style guide](https://google.github.io/styleguide/docguide/style.html) | Prettier: ATX headings, `-` lists, aligned tables. Prose isn't re-wrapped, so a diff shows only the sentence you changed                        |
| JSON, YAML   | —                                                                               | Prettier                                                                                                                                        |

## What the tools don't do

- **Names.** Python: `module_name`, `function_name`, `ClassName`,
  `CONSTANT_NAME`, `_private`. JavaScript: `functionName`, `ClassName`,
  `CONSTANT_CASE` for module-level constants, file names in `kebab-case.js`.
- **Docstrings.** Public Python functions and classes get one: a one-line
  summary, a blank line, then the details, with `Args:`, `Returns:` and
  `Raises:` sections where they help. Older code has some summaries that run
  onto a second line; Ruff tolerates those (`D205`, `D415`), but write new ones
  as a single line.
- **Long lines.** The formatters wrap code at 80 columns but not strings or
  comments. Keep new ones under 80; long URLs are fine.
- **Comments** explain why, not what, in full sentences.

## What's left alone

- Third-party code stays exactly as upstream ships it: `portal/vendor/`,
  `portal/web/` and `companion/device/athena_decode.py` (from OpenMuse).
- `.graph/` and `CLAUDE.md`, the maintainer's shared AI working notes, aren't
  reformatted, because many sessions append to them at once.
- Test fixtures under `tests/fixtures/` and `tests/study/fixtures/`.

## After the big reformat

The commit that first applied these settings is listed in
`.git-blame-ignore-revs`, so `git blame` skips it. GitHub does this on its own;
locally, run once:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

If you had a branch open from before, merge `main`, take your side of each
conflict in a reformatted file, then run `scripts/format.sh` and commit.

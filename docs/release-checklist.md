# Release checklist

## Before committing

- [ ] `make verify` all green on the running lab, and `make test-ui`
- [ ] `make secret-scan` clean; `gitleaks detect --no-banner` clean
- [ ] `git status --untracked-files=all`: no `.env`, `.secrets/`, `.build/`,
      `prompts/`, `input/`, `article/`, `.claude/`, `AGENTS.md`
- [ ] Screenshots current (`make screenshots`)
- [ ] `docs/STATE.md` records what changed and what was measured, with the date

## Commit

- [ ] Park the scaffold's pre-commit hook if it is still active
- [ ] `commit_gh --no-hook`, then check `git log`, `git stash list` and the remote

## After a Vault, provider or image bump

- [ ] `make probe` within 4 h of a bootstrap, and update `docs/capabilities.md`
- [ ] `make lab` from nothing (`make clean-slate` first) and `make rehearsal`

# DESIGN.md: the Chain of Custody console

The console follows **Vault daylight glass**: light frosted-glass panes, black
ink, one dark ink hero per page, and strong status colours that hold WCAG AA.
This file states only what vault_pipeline adds; the system itself (tokens,
glass recipe, type, primitives) is the `vault-ui-design` skill, and its
canonical implementation is `../arcanium`.

## Files

- `web/src/styles/vault-glass.css` and `shell.css`: the system, unchanged.
- `web/src/styles/app.css`: shared layout from vault_balancing.
- `web/src/styles/pipeline.css`: this story's pieces (workload cards, event
  rows, the answer, the doors, the custody timeline), tokens only.

## The pages

| Page | The ink hero says | Below it |
| --- | --- | --- |
| The Line (prologue) | "Nobody holds everything." | a card per workload: SPIFFE ID, address, every path its own token may and may not use, who may call it; the trust domain |
| Into the Pipe (Act I) | "Into the pipe, sealed." | the seal buttons (operators), one row per document as it streams (data key fingerprint, `vault:vN:` prefix, keeper's verdict), what the database holds |
| The Librarian (Act II) | "The librarian reads only what you may read." | the question box with two suggestions, the answer streaming in, Vault's refusals verbatim, the person's token: policies, what it opened, revoked |
| The Badge Check (Act III) | "A badge opens one door, once, for one minute." | the checks on every call, the guest lists, the verifier's unit tests with their result |
| The Lost Backup (Act IV) | "The backup turns up where it should not." | one button (operators), then one row per step: the backup, the console's powers, the token's binding, rotate, rewrap, the minimum, the old key refused |
| Custody (epilogue) | "Every hand, on the record." | a document picker and its custody rows |
| Layers | the split | every phase of `make lab` with its evidence, and the gates |

## Rules this console keeps

- **Vault's words are shown verbatim**, never paraphrased into success or
  failure: a refusal shows Vault's own error next to the document it refused.
- **Never a secret on screen.** Data keys appear as fingerprints, encrypted
  keys as their `vault:vN:` prefix, badges not at all. The "Vault said"
  drawer holds the console's raw answers of this visit; the console never
  returns a token, so the drawer cannot show one.
- **Buttons explain themselves when off:** signed out, or not in
  `pipeline-operators`, the reason sits next to the button
  (`data-testid="action-reason"`), and the console refuses the call anyway.
- **Colour only for state:** green for what held (a refusal the story
  expects is green), red for what did not, blue for identities and guests.
- **Motion:** the live dot only; off under `prefers-reduced-motion`.
- **Presenter-sized type, left and right arrows between the acts**, `?` for
  the shortcuts.

## Verified

`make test-ui`: axe WCAG 2.1 AA on all seven pages, 0 violations
(2026-11-11). `make screenshots`: 1440x900 and 390x844 into
`docs/screenshots/`.

# State

What was built, deferred and learned per prompt. Read this first.

## Prompt 01: Foundation (2026-11-11)

**Done**

- Layout, `config/defaults.conf` (images D1, models, ports D4, subnet and
  static addresses, timings), `config/pipeline.json` (+ schema) and the
  unit-tested `scripts/pipeline-check.js` (6 tests: the data-key/decrypt
  rule, caller rules, addresses in the subnet and unique, one reader group
  per collection, the decoy, a canonical digest).
- `corpus/`: six fictional Larkspur & Vane documents (1.6 to 2.0 KB each,
  smaller than the prompt's 2 to 4 KiB: enough for 3 to 4 chunks at about
  600 characters; prompt 06 sets the chunk size). The board question's answer
  (Project Lighthouse) is only in `board-2026-10`; the handbook question's
  (30 days) only in `travel-policy`.
- From `../vault_codex`, renamed `vcdx`→`vpip`: the wrappers, `common.sh`,
  `tf.sh`, `ansible.sh` (+ stats callback), `lab.sh`, the gates, seal and
  vault scripts, compose `seal` and `vault`, `vault/` HCL and bootstrap
  policies, `terraform/vault-seal`, the Ansible roles `vault_init`,
  `cluster_bootstrap`, `seal_tokens`, `.github/`, dotfiles. Codex-only
  scripts (probe, rehearsal, verify, doctor, show-ready, app-build, app-up,
  up, automation-digest, validate) were set aside and are rewritten in the
  prompt that needs them.
- `scripts/network.sh` creates `vpip-internal` with the fixed subnet and
  refuses one with another subnet. `podman-check.sh` reports the Mac's and
  the VM's free disk and fails below 8 GiB. `gen-certs.sh` adds the workload
  SANs; the CA is "Vault Pipeline Lab CA".
- `Makefile`: every section of the lab, phases 1 to 17, story targets,
  stubs that say which prompt builds them.
- Removed the scaffold's root `main.tf`, `sanity_check.md` and
  `FOLDER_TREE.md` (an empty root next to two real ones confuses `make lint`).
- `.gitignore` from vault_codex (`prompts/`, `input/`, `article/`, `.build/`,
  `.secrets/`, ...); `git check-ignore` confirms `corpus/`, `config/`,
  `pipeline/lib/` and `docs/` are tracked.

**Validation (2026-11-11):** `make help`, `make check` (46 GiB, skew 1 s, Mac
24 GiB free, VM 49 GiB free), `make env-init`, `make license` (installed
from `VAULT_LICENSE` in `.env`), `make gen-certs`, `make certs-status`,
`make ports-check` (all free), `node scripts/pipeline-check.js`,
`node --test scripts/*.test.js` (6/6), `scripts/ansible.sh --version-check`
(ansible-core 2.21.3).

**Learned**

- `node --test scripts/` (a directory) fails on Node 25; pass the files
  (`scripts/*.test.js`).

## Prompt 02: Seal and cluster (2026-11-11)

**Done**

- vault-s and vault-1..3 from vault_codex, with static addresses on
  `vpip-internal` (vault-s .5, vault-1..3 .2 to .4). Ansible `seal-init`,
  Terraform `vault-seal`, `seal-tokens`, `vault-up`, `bootstrap`; root
  revoked on both clusters.
- Bootstrap policies rewritten for this lab: `vpip-tf-platform` (SPIFFE,
  Transit and database mounts, SPIFFE roles, the database connection and
  role, AppRoles, JWT, external groups, `vpip-wl-*` and `vpip-read-*`
  policies; never keys, data keys, decrypt, SVIDs, database credentials or
  secret ids) and `vpip-ansible-platform` (the two collection keys, database
  `rotate-root`, secret zero, cluster operations, read-only checks; never
  data keys, decrypt, rewrap, SVIDs or database credentials).
- `make boundary`: 32 checks.

**Validation (2026-11-11):** `make vault-status` (three voters, one active,
unsealed by vault-s), `scripts/tf.sh vault-seal plan` (no changes), no
Exited (0) containers, `make boundary` 32/32 (after the rebuild below).

**Fixed in the build**

- The first bootstrap wrote two policy lines with a glob in the middle of a
  path (`auth/approle/role/vpip-*/secret-id`). Vault accepts `*` only at the
  end, so the line was literal: 2 of 32 boundary checks failed (Ansible could
  not write secret ids, Terraform's trailing `vpip-*` could). Fixed with one
  named path per workload. With root revoked and the cluster still empty, the
  user chose a rebuild (2026-11-11): the three cluster volumes were removed
  and the old init file and platform tokens moved to
  `.secrets/legacy/prompt02-rebuild/` (by the user: the assistant's shell may
  not move key material), then `make vault-up && make bootstrap`.

**Learned**

- Vault policy globs: `*` only at the end; `+` for one segment anywhere. A
  trailing glob with an earlier wildcard position wins over a `+` deny
  written to fence it off, so name each path.

## Prompt 03: Probe (2026-11-11)

**Done**

- `scripts/probe.sh` (`make probe`), `scripts/probe-lib.sh` (tokens in a 0600
  header file, `curl -H @file`), in-network clients in `scripts/probe/`
  (`client.mjs`: unwrap, login, use; `ollama.mjs`: speed). 41 checks, every
  one passing; the scratch mounts, policies, audit device and containers are
  removed at the end.
- `docs/capabilities.md`: every answer and its consequence.
- Two decisions changed in the brief: D10 pins `jwt_issuer_url` (the default
  issuer is the active node's address and would change with the leader), D11
  uses `transit/datakeys/plaintext/<key>` with `count` (the documented path
  is a 404).
- The models are already in `vpip-ollama_models` (1.26 GB), so prompt 05's
  `models` phase finds them present.

**Open**

- P8 (JWT auth with Keycloak) is measured in prompt 04, once Keycloak runs.
- Node interop with the CLI's `.vee` format is deferred (binary, Go SDK only).

**Learned**

- A CIDR-refused AppRole login burns a single-use `secret_id`.
- The Postgres image trusts loopback; `--auth-local=scram-sha-256
  --auth-host=scram-sha-256` closes it.
- Rewrap before raising `min_decryption_version`; after, rewrap is refused too.
- Ollama on the VM is fast enough for a live demo: 0.1 s to the first token
  warm, 100 ms per embedding.

## Prompt 04: Identity and platform (2026-11-11)

**Done**

- Identity from vault_balancing, renamed: `compose/identity` (`vpip-openldap`,
  `vpip-keycloak` on 13802, plain HTTP on loopback like vault_balancing), the
  one-shots `setup_ldap.sh` and `setup_keycloak.sh` (realm `pipeline`, LDAP
  federation read-only, `groups` claim, clients `pipeline-console` and the
  lab-only `pipeline-e2e`), `scripts/identity-{up,secrets}.sh`,
  `ldap-acl.sh`. Groups `pipeline-staff` (vera, oscar, ada),
  `pipeline-operators` (oscar, ada), `pipeline-board` (ada). The prompt's
  separate `ansible identity` phase is not needed: the proven one-shots are
  idempotent (a second run: "0 added, 10 already present").
- Terraform `vault-platform` (31 resources): file audit on every node, the
  `spiffe/` mount, its config (ES256, pinned issuer) and five roles, the
  `transit/` mount, five AppRoles bound to their `/32`, the database mount,
  connection (`password_wo`, ephemeral variable from `.secrets/data/`) and
  role `keeper`, JWT auth with Keycloak, role `person` (120 s, bound to the
  console's and the librarian's addresses), external groups for the two
  readers, policies `vpip-wl-*` (templates in `policies/`) and `vpip-read-*`.
- Ansible `keys`: `handbook` and `board`, not exportable.

**Validation (2026-11-11):** `make identity-up`; `scripts/tf.sh vault-platform
apply` then `plan`: no changes; `make keys` twice (changed=1, then 0); `make
boundary` 32/32; the realm's discovery document answers. P8 (from a probe
container at the console's address, `scripts/probe/person.mjs`): vera's token
may `update` `transit/decrypt/handbook` and is denied `board`; ada's may both;
neither may make data keys; both carry `bound_cidrs` .13 and .14, TTL 120 s,
and revoke themselves (204).

**Changed from the brief**

- D13: the console presents the person's **access** token (its audience
  mapper adds `pipeline-console`; the ID token's audience is the client that
  asked). Person tokens keep the `default` policy, so they can revoke
  themselves.
- Person and workload boundary rows move to prompts 06 and 07: a person's
  login works only from the console's or the librarian's address (Vault
  applies `token_bound_cidrs` at login: from the host it answers
  `permission denied`), and a workload's powers are proven by its own token.

**Learned**

- Provider 5.13.0: `vault_spiffe_secret_backend_role` requires a unit in
  `ttl` and reads back plain seconds, then fails "inconsistent result after
  apply". The roles are `vault_generic_endpoint`; a `removed` block (destroy
  false) dropped the tainted resources without deleting the roles.
  `vault_spiffe_secret_backend_config` needs `24h`/`1h`.
- Vault trims the trailing newline from database statements: `trimspace()`.
- Containers without a static address drew addresses from the workload range
  (Postgres took .14, Ollama .13). The network now has
  `--ip-range 10.89.230.128/25`; `network.sh` refuses an old network.

## Prompt 05: Data plane and secret zero (2026-11-11)

**Done**

- `compose/data` (`vpip-postgres` pgvector pg18 with scram on loopback,
  `vpip-ollama` 0.13.5 with the models volume as external), `scripts/data-up.sh`,
  `scripts/data-secrets.sh`.
- Ansible `schema` (applies `ansible/roles/schema/files/schema.sql` with the
  bootstrap password, then `database/rotate-root/pipeline`, then proves the
  bootstrap password dead), `models` (pull if missing, check the IDs in
  `config/defaults.conf`), `deliver` (role id and a 300 s wrapped single-use
  secret id per workload into `.secrets/workloads/<name>/`, accessors to
  `.build/deliver.json`; `deliver_only=a,b` limits it).
- `scripts/idempotency-allow.txt`: `deliver` (single use by design).
  `secret-scan.sh` knows this lab's secret files.

**Validation (2026-11-11):** `make data-up`, `make schema` twice (applied and
rotated, then changed=0), `make models` (changed=0: the probe pulled them),
`make deliver`, `make lab` from a running stack: 17 steps, idempotency
(deliver allowed), drift (both plans empty), secret scan clean, boundary
32/32.

**Disk (2026-11-11):** models 1.26 GB, pgvector image 0.49 GB; the other
images were already on the machine.

## The intruder dropped (2026-11-11, the user's decision)

Writing an attacking workload (badge replay and forgery tools, simulated
leaks) was stopped by the assistant's safety checks twice. The user chose:
no intruder, no leak hooks; the refusals are proven by real requests and by
unit tests. Removed from the config, Terraform (its AppRole, policy and SVID
role were destroyed by apply), the corpus and the docs. Act III became *The
Badge Check* (the guest lists and the badge verifier's unit tests, shown in
the console), Act IV *The Lost Backup*. The bootstrap policies still name
`vpip-intruder` AppRole paths; harmless (the role does not exist) and left
as written because changing them needs a cluster rebuild or root.
`.secrets/workloads/intruder/` holds a spent role id and wrap from the first
delivery.

## Prompt 06: Workloads (2026-11-11)

**Done**

- `pipeline/lib/`: `vault.js` (secret zero, AppRole login, renewal, node
  failover, Vault's errors unwrapped), `svid.js` (minting, the verifier of
  D10 with typed refusals), `envelope.js` (D11 frames, chunking,
  fingerprints), `http.js` (TLS server, guest lists from
  `config/pipeline.json`, one error shape, a refusal hook), `workload.js`
  (start, calls with a fresh SVID, `powers`, Ollama).
- `pipeline/bin/{scribe,keeper,librarian}.js`, one image
  (`pipeline/Containerfile`, `--format docker`, HEALTHCHECK). The keeper's
  `relock` asks Vault to rewrap one encrypted key and returns the answer,
  storing nothing.
- `compose/pipeline` (static addresses, read-only root, no restart policy:
  secret zero is single use), `scripts/pipeline-up.sh` (delivers, then
  recreates), `scripts/app-build.sh worker`.
- One dependency: `pg` 8.23.1 in the keeper (Node has no PostgreSQL client;
  the wire protocol and SCRAM are not a few lines).

**Validation (2026-11-11):** `make test-unit` (pipeline 21/21 now, with the
session tests), `make pipeline-up` (three workloads healthy, each "secret
zero opened"); `podman restart vpip-worker_keeper` exits 78 with "secret zero
was already opened or has expired (Vault said: wrapping token is not valid or
does not exist)", and `make pipeline-up` recovers.

**Learned**

- A small model answers from whatever passages it gets: with the board
  passages refused, `qwen2.5:1.5b` invented a "Project Lighthouse" from the
  handbook. The librarian now declines when the closest match is a document
  Vault refused for the asker.
- The frames' AAD first covered the whole header, including the encrypted
  data key: a rewrap changed it and every frame failed to open ("unable to
  authenticate data"). The AAD now binds the fixed fields only (version,
  algorithm, collection, document id, nonce prefix); a unit test covers a
  rewrapped header.

## Prompt 07: The console (2026-11-11)

**Done**

- The console is a workload in the same image (`pipeline/bin/console.js`,
  `WORKLOAD=console`), not a separate `api/` tree: it needs the same secret
  zero, SVIDs and Vault client. `compose/app` (`vpip-console` at .14, alias
  `api`, published on 127.0.0.1:13800), `scripts/app-up.sh`.
- `pipeline/lib/{session,oidc}.js` from vault_balancing (PKCE BFF,
  `safeReturn`, cross-site writes refused, POST-only logout); operators from
  the signed `groups` claim.
- Routes: `/healthz`, `/auth/*`, `/api/me`, `/api/line` (each workload's
  powers from its own token), `/api/collections`, `/api/custody`,
  `POST /api/ask` (one Vault login per question, revoked at the end),
  `GET /api/acts/badges` (guest lists and `.build/unit-tests.json`),
  `POST /api/acts/{ingest,backup,reset}` (operators), `/api/layers`.
- Host commands: `make ingest`, `make ask` (`console_call` in `common.sh`:
  a person's Keycloak token as Bearer). `scripts/unit-tests.sh` writes
  `.build/unit-tests.json`.
- `scripts/boundary-workloads.sh` (20 checks: every workload's allow and
  deny paths from its own token, and a person's login from the host
  refused), run by `make boundary` when the console is up and by the new
  `validate` phase.

**Validation (2026-11-11):** Act I: six documents, six data keys
(fingerprints all different), 24 frames stored. Act II: vera on the board
question: three board documents refused by Vault ("permission denied"), no
answer; ada: answered with citations; vera on the handbook: "30 days".
Act IV: backup 24 frames, 11 KB, 0 hits for "Larkspur"; the console's
decrypt capability `deny`; ada's token bound to .13 and .14; board rotated,
three keys rewrapped, minimum raised, the backup's old key refused "(too
old)"; ada answered again afterwards. A viewer pressing an act: 403
`not_an_operator`. `make validate` ok.

## Prompt 08: The console UI (2026-11-11)

**Done**

- `web/` from vault_balancing (shell, glass CSS, `ui.jsx`, `Person.jsx`,
  nginx with TLS 1.3 and the lab CA, Layers page), pages The Line, Into the
  Pipe, The Librarian, The Badge Check, The Lost Backup, Custody, Layers;
  `stream.js` (NDJSON over fetch), `said.js` (the "Vault said" drawer holds
  the console's raw answers of this visit), `components/gate.jsx`.
  `styles/pipeline.css` (the reused balancing rules plus this story's).
  `compose/app` runs `vpip-web` next to `vpip-console`.
- `e2e/` from vault_balancing: `story.spec.ts` (signed out, the line from
  each workload's own token, a staff member refused an act in the UI and by
  the console, an operator seals the handbook, vera refused and ada answered
  on the board question, the badge check page), `a11y.spec.ts` (axe WCAG 2.1
  AA on all seven pages; `@shots` at 1440x900 and 390x844 into
  `docs/screenshots/`).

**Validation (2026-11-11):** `make test-ui` 8/8, 0 axe violations;
`make screenshots` 14 images.

**Learned**

- With a "Sign in" link on a page's own notice as well as in the topbar,
  the auth helper must scope its click to the banner.
- The phone topbar folds the person menu away: sign in at desktop size,
  then resize.

## Prompt 09: Rehearsal and the daily cycle (2026-11-11)

**Done**

- `make rehearsal` (22 checks through the console: the line, a reset, Act I
  with six different data keys and a viewer refused, Act II with vera
  refused and ada answered and the token revoked, Act III's guest lists and
  verifier tests, Act IV's backup without text, the console's decrypt
  denied, the person token's binding, the host login refused, rotate and
  rewrap, the old key refused, ada answered after rotation, the custody of
  one document). Results in `.build/rehearsal.json`.
- `make act-ingest|act-ask|act-badges|act-backup`, `make story-reset`
  (forgets documents; keys keep their versions, custody keeps every row),
  `make up`, `make show-ready`, `make doctor`, `make verify`,
  `make identity-copy-password`. `make clean-slate` keeps the models volume
  unless `CLEAN_MODELS=1`. `make backup` (Raft snapshots and `.secrets`):
  Postgres is not dumped, because nobody but Vault knows its root password
  and the keeper's credential is short-lived; its volume holds ciphertext.

**Validation (2026-11-11):** `make verify` all green (lint incl. shellcheck,
terraform validate and ansible-lint; 21 unit tests; 32 + 20 boundary checks;
both plans empty; rehearsal 22/22). `make down` (0 containers left), `make
up` in 105 s, `make rehearsal` 22/22 in 35 s, `make test-ui` 8/8,
`make doctor` nothing to fix.

## Prompt 10: Docs and final validation (2026-11-11)

**Done**

- `README.md`, `docs/architecture.md` (topology, trust boundaries, a
  question end to end, sealing), `docs/security-model.md` (every workload's
  and person's powers, what each check proves, the shortcuts and their
  limits), `docs/operations.md`, `docs/ownership.md`,
  `docs/release-checklist.md` (rewritten for this lab), `docs/STORY.md`
  final, `docs/capabilities.md` final.
- no-ai-slop detect pass over README, STORY and the security model: bold
  sprinkled mid-sentence in the README (removed), and one line in STORY (and
  CLAUDE.md) that still described live badge tries (corrected). No em dashes
  in anything published.
- The brief and prompts 07 to 09 now describe Act III as built.

**Not run by the assistant:** the final run from nothing (`make clean-slate`
then `make lab`). It removes every lab volume and moves the Vault keys aside,
which the assistant's safety checks refused earlier; the user runs it. The
cold start from a stopped stack passed (prompt 09).

## Prompt 11: Ready for a public clone (2026-11-11)

**Done**

- What a commit would stage (224 files): no `.env`, `.secrets/`, `.build/`,
  `prompts/`, `input/`, `article/`, `.claude/`, `AGENTS.md`; no home paths
  or user names; gitleaks on exactly those files: one false positive
  (`password_authentication = "scram-sha-256"`), allowlisted by line in
  `.gitleaks.toml`, then clean.
- `.github/workflows/ci.yml` runs the config check, the workload and console
  unit tests, the console build and `make lint` (no licence needed).
- A clean copy in `$TMPDIR` without `.env`: `make help`, `make lint` (57
  scripts, both Terraform roots, ansible-lint, 15 Node files) and
  `make test-unit` (6 + 21 + 3) pass.

**Not done:** no commit. The scaffold's pre-commit hook must be parked first
(`mv .git/hooks/pre-commit .git/hooks/pre-commit.disabled`), then
`commit_gh --no-hook`, when the user asks.

## Prompt 12: Clean, round 1 (2026-11-11)

Reviews on commit `de0bee0`: ponytail audit (8), ponytail review (6),
backend-design audit (6), security discipline (7): 27 to-dos, all fixed.

| # | Finding | Fix |
| --- | --- | --- |
| 1 | Act IV raised the minimum version even when a rewrap failed: that document would be unreadable for good | the console stops before raising it and names the documents |
| 2 | An unknown `kid` refetched the JWKS every time | at most every 30 s (unit test) |
| 3 | A person who left mid-answer kept the model busy and the token alive | the console aborts the librarian call on close and revokes at once |
| 4 | An ingest failing after "pressed" showed no error | an `error` event before the stream ends |
| 5 | `make lab` delivered secret zero three times | the `deliver` phase is gone (`make deliver` stays) |
| 6 | `vault_may`/`vault_refuses` in the config were never read | removed |
| 7 | `vault_list_json` unused | removed |
| 8 | The console's header comment described live badge checks | corrected |
| 9 | The scribe's `/reseal` door was dead | removed with its op |
| 10 | The keeper's `/ping` door was dead | removed with its op and test |
| 11 | `questions` in the config were never read | removed |
| 12 | A leftover temp file could fail rehearsal check I1 | fingerprints in a variable |
| 13 | Act III tagged tests by guessing from their names | `unit-tests.sh` runs file by file |
| 14 | The Custody picker had the documents typed in | built from `/api/collections` |
| 15 | Two operators pressing at once raced the key's minimum version | one act at a time (409 `busy`) |
| 16 | The librarian reported a Vault outage as a refusal | only Vault's 4xx answer is a refusal |
| 17 | Custody rows that failed to write were swallowed | the operation fails (refusals still log) |
| 18 | The keeper's health ignored the database | `SELECT 1` with Vault's credential |
| 19 | Request ids stopped at the console | carried on every workload call (AsyncLocalStorage in `http.js`) |
| 20 | The custody query's OR on JSONB could not use its index | one `searched` row per document |
| 21 | The console's token could set any key config (exportable, deletion) | `allowed_parameters = { min_decryption_version }` |
| 22 | The console accepted TLS 1.2 | 1.3, like the rest |
| 23 | No HSTS from the web front | `Strict-Transport-Security` |
| 24 | One person could queue many questions and stall the model | one question at a time per person (409) |
| 25 | The console mounted all of `.build/` | only `.build/console/` (layers, unit tests) |
| 26 | Postgres and Ollama ran without `no-new-privileges` or dropped capabilities | both hardened |
| 27 | Ollama's lack of authentication was not documented | in `docs/security-model.md` |

**Validation (2026-11-11):** unit tests 20/20 and 6/6; `make verify` all
green (lint, 32 + 20 boundary checks, both plans empty, rehearsal 22/22 in
17 s); `make test-ui` 10/10 with screenshots; a second act during an ingest
answered 409 `busy`; one question's request id appears in the keeper's log;
the keeper's health reports `db: true`.

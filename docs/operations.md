# Operations

Every task is a `make` target; `make help` lists them all. Compose,
Terraform and Ansible run only through `scripts/compose.sh`, `scripts/tf.sh`
and `scripts/ansible.sh`.

## Build and start

| Task | Command |
| --- | --- |
| From nothing (phases, then the gates) | `make env-init && make license && make gen-certs && make lab` |
| List the phases | `make phases` |
| One phase again | `make seal-up`, `seal-init`, `vault-seal`, `seal-tokens`, `vault-up`, `bootstrap`, `identity-up`, `vault-platform`, `keys`, `data-up`, `schema`, `models`, `pipeline-up`, `app-up`, `validate`; secret zero by hand: `make deliver` (`pipeline-up` and `app-up` deliver their own) |
| Start after `make down` or a reboot | `make up` |
| Stop, keep every volume | `make down` |
| Rebuild images | `make app-build TARGETS="worker web"`, then `make pipeline-up` and `make app-up` |

## The story

| Task | Command |
| --- | --- |
| Before a talk | `make show-ready` |
| An act from the terminal | `make act-ingest`, `act-ask`, `act-badges`, `act-backup` |
| One collection, one question | `make ingest COLLECTION=board`, `make ask AS=ada Q="..."` |
| Forget the stored documents | `make story-reset` (custody and key versions stay) |
| A person's password to the clipboard | `make identity-copy-password U=ada` |

## Checks

| Task | Command |
| --- | --- |
| Static checks, as in CI | `make lint` |
| Unit tests (no lab needed) | `make test-unit` |
| The tools', workloads' and people's boundaries | `make boundary` |
| Every Terraform plan empty | `make tf-plan-all` |
| Every Ansible phase `changed=0` | `make idempotency` |
| Secrets in state, logs, `.build/` | `make secret-scan` |
| The story, unattended | `make rehearsal` |
| All of the above against the running lab | `make verify` |
| The UI (Playwright, axe) and screenshots | `make test-ui`, `make screenshots` |
| Re-measure what Vault does (4 h after bootstrap only) | `make probe` |

## When something is wrong

`make doctor` names the problem and the command. The usual ones:

| Symptom | Cause | Fix |
| --- | --- | --- |
| A workload exited with code 78 | it restarted and its secret zero is spent (by design) | `make pipeline-up` (or `make app-up` for the console) |
| SVIDs refused as expired right after minting | the Podman VM clock drifted (after sleep) | `make clock-sync` |
| `vault-1..3` restart in a loop | vault-s is sealed or its seal token was revoked | `make unseal`, `make seal-token-status` |
| The keeper answers 500 on search | its database lease ended | it reconnects by itself; else `make pipeline-up` |
| An answer takes over a minute | the model was unloaded (30 min keep-alive) | ask once more; the second answer is warm |

## Vault

| Task | Command |
| --- | --- |
| Every node's state | `make vault-status` |
| Seal tokens | `make seal-token-status`, `make seal-token-rotate NODE=vault-2` |
| A root token, only when you decide to | `make root-regen CLUSTER=vault`, then `make root-revoke CLUSTER=vault` |

## Removing it

`make clean-slate` removes every `vpip-` container, volume and the network
after you type `DELETE`, and moves the credentials to
`.secrets/legacy/<time>/`. The models volume stays unless `CLEAN_MODELS=1`.

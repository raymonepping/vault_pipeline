# Security model

## Each workload's powers

What Vault lets each workload's own token do (`make boundary` asks every
token through `sys/capabilities-self`; the console's line view shows it).

| Workload | May | May not |
| --- | --- | --- |
| scribe | mint its own SVID; `transit/datakeys/plaintext/{handbook,board}` | decrypt, rewrap, the database, another workload's SVID |
| keeper | mint its own SVID; `database/creds/keeper`; `transit/rewrap/{handbook,board}` | decrypt, create data keys, another workload's SVID |
| librarian | mint its own SVID | decrypt with its own token, create data keys, the database |
| console | mint its own SVID; read, rotate and set the minimum version of the two keys | decrypt, create data keys, rewrap, the database |
| a person (staff) | `transit/decrypt/handbook`, for 120 s, from the console or the librarian | everything else |
| a person (board) | also `transit/decrypt/board` | everything else |

The tools: Terraform's token declares structure and may not use it (no data
keys, decrypt, SVIDs, database credentials or secret ids); Ansible's token
creates the keys, rotates the database root password and delivers secret
zero, and may not decrypt, rewrap or mint. Neither may rewrite its own policy.
No root token exists after bootstrap.

## What each check proves

| Check | How | Where |
| --- | --- | --- |
| Nobody both makes and opens data keys | `pipeline-check.js` refuses such a config; the policies follow it | unit tests, `make boundary` |
| A badge is for one callee, one minute, one use | the verifier's checks; refusals `wrong-audience`, `expired`, `replayed`, `bad-signature`, `not-a-guest` | `pipeline/test/svid.test.js` (Act III shows the results) |
| The storage tier never sees plaintext | the backup has 0 hits for the company's name; the keeper's policy has no decrypt | Act IV, rehearsal IV1, IV2 |
| A deputy cannot read more than the asker | the librarian decrypts with the person's token; vera is refused the board | Act II, rehearsal II1 to II5 |
| A token is bound to its address | the person role's `bound_cidrs`; a host login refused | Act IV, rehearsal IV3, IV4, probe P6 |
| Rotation retires old encrypted keys | rotate, rewrap, raise the minimum; the backup's key refused "too old" | Act IV, rehearsal IV5 to IV7 |
| Secret zero is single use | a restarted workload stops: "secret zero was already opened" | probe P6, `make pipeline-up` |

## Shortcuts and their limits

- **`pipeline-e2e`** is a public Keycloak client with direct grants, for the
  rehearsal, `make ask` and Playwright. Lab only: a real deployment would
  not offer password grants.
- **Embeddings are plaintext.** The keeper searches them; an embedding
  carries meaning (text has been rebuilt from embeddings). Encrypting them
  would need a searchable scheme this lab does not attempt.
- **A badge is a bearer credential** for its minute. Mutual TLS with
  X.509-SVIDs would bind it to a connection; Vault's SPIFFE engine issues
  JWT-SVIDs only.
- **A compromised workload has that workload's powers.** The lab limits what
  those powers are; it does not claim to stop code running inside a
  workload.
- **Keycloak and Ollama** run without TLS inside the network and on loopback.
- **Ollama has no authentication.** Any container on `vpip-internal` can ask
  it for embeddings and answers; it holds no documents, only the two models.
  The lab's own containers are the only ones on that network.
- **The model** (`qwen2.5:1.5b`) fills gaps with plausible text. When the
  closest match is a document Vault refused for the asker, the librarian
  declines instead of answering from the passages that are left.
- **Postgres** is not in `make backup`: only Vault knows its root password,
  and the keeper's credential is short-lived. Its volume holds ciphertext.

## Never in a log or a response

Tokens, secret ids, data keys, SVIDs, passwords, the licence. The workloads
log JSON lines without bodies; the console returns decoded claims at most.
`make secret-scan` checks state, `.build/` and the last hour of every
container's log for known values and token-shaped strings.

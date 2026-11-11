# Who owns what

> **Terraform builds the house. Ansible decorates it. Vault keeps the keys.
> Make is the front door.**

| Object | Owner | Why there |
| --- | --- | --- |
| vault-s Transit mount, key `autounseal`, token role | Terraform `vault-seal` | declared once, planned |
| Per-node seal tokens | Ansible `seal-tokens` | issued at a moment, rotated on purpose |
| Bootstrap policies, scoped tokens, root revocation | Ansible `seal-init`, `bootstrap` | they exist before Terraform can run |
| Audit devices, mounts (`spiffe/`, `transit/`, `database/`), SPIFFE config and roles | Terraform `vault-platform` | structure |
| AppRoles (CIDR-bound), JWT auth, role `person`, external groups, policies | Terraform `vault-platform` | structure |
| Database connection and role `keeper` | Terraform (`password_wo`, never in state) | structure; the password is written once |
| Collection keys `handbook`, `board` | Ansible `keys` (creates), the console (rotates in Act IV) | runtime state: the story turns them |
| Postgres schema and the root password rotation | Ansible `schema` | an order: schema first, then Vault rotates the password away |
| Models | Ansible `models` | pulled once, checked by ID |
| Secret ids (wrapped, single use) | Ansible `deliver`, run by `pipeline-up` and `app-up` | issued at the moment a workload starts |
| Data keys, encrypted data keys, stored documents | the scribe and the keeper | the story's data |
| Rewrapped keys | the keeper | it may rewrap, never open |
| People and groups | OpenLDAP, federated into Keycloak (`identity-up`) | identity exists before Vault trusts it |
| Who may read which collection | Vault (external groups to read policies) | from Keycloak's signed groups claim |
| Who may press an act button | the console (signed groups claim) | not a Vault decision |
| Containers, network, volumes | Compose through `scripts/compose.sh` | never Vault configuration |

`make tf-plan-all` stays empty after a full show; `make idempotency` reports
`changed=0` for every Ansible phase.

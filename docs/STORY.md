# Chain of Custody

A small company keeps its handbook and its board minutes in a local AI
assistant. Four programs carry the documents from the shelf to the answer:
the **scribe** reads and seals them, the **keeper** stores them, the
**librarian** answers questions, and the **console** is where people ask.
Each program has its own badge and its own key ring, issued by Vault. Each
one checks every badge at its door against a guest list, and when the night's
backup turns up where it should not, it holds nothing anyone can read.

The company, Larkspur & Vane, a lantern maker in the harbour town of
Wrenmouth, is invented. So are its documents and its people.

## The acts

| Act | What happens | Vault feature |
| --- | --- | --- |
| Prologue: The Line | Four workloads, four badges, four key rings. Nobody holds everything. | SPIFFE engine roles, one AppRole per workload, policies |
| I: Into the Pipe | The scribe seals six documents, one fresh data key each, and streams them to the keeper. The database holds ciphertext and vectors, never text. The keeper never had a key. | Transit envelope encryption, JWT-SVIDs with an audience |
| II: The Librarian | Vera asks about the board's plans: the librarian finds the passages and Vault refuses to open them for her. Ada asks the same question and gets an answer. | JWT auth with Keycloak groups, decrypt with the asker's token |
| III: The Badge Check | The right badge at the right door is let in. The same badge twice, a badge for another workload, a badge past its minute and a caller not on the guest list are refused, each with its reason. | JWT-SVID audience, expiry, single-use `jti`, guest lists |
| IV: The Lost Backup | The backup holds ciphertext and vectors, never a sentence; the console's own token cannot open one key. A login from the wrong address is refused. Rotation and rewrap move the stored keys to a new version, and the backup's old keys are refused. | `token_bound_cidrs`, rotate, rewrap, `min_decryption_version` |
| Epilogue: The Custody Log | Who touched which document, when. | File audit devices, the keeper's custody table |

## The workloads

| Workload | Vault lets it | Vault refuses it |
| --- | --- | --- |
| scribe | mint its own badge; create data keys | decrypt, rewrap, the database |
| keeper | mint its own badge; a database credential; rewrap | decrypt, create data keys |
| librarian | mint its own badge | decrypt with its own token, the database |
| console | mint its own badge; rotate a collection key | decrypt, data keys, rewrap, the database |

## The people

| Person | Groups | Reads |
| --- | --- | --- |
| Vera | staff | the handbook |
| Oscar | staff, operators | the handbook; presses the act buttons |
| Ada | staff, board, operators | handbook and board; presses the act buttons |

## What the lab proves, and what it only illustrates

**Proves:** a workload can only mint its own badge; a badge is bound to one
audience, expires in a minute and is accepted once; the storage tier never
sees plaintext; a deputy that acts with the asker's token cannot read more
than the asker; a token bound to an address is refused from any other;
rotation plus rewrap retires old encrypted keys without decrypting data.

**Illustrates only:** embeddings stored next to the ciphertext carry meaning;
a badge is a bearer credential for its minute; a workload compromised from
the inside has that workload's powers. One Mac is not a production pipeline.

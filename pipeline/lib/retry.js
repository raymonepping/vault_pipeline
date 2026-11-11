// pipeline/lib/retry.js: the keeper's one recovery rule. A database
// credential that Vault revoked or that expired answers "password
// authentication failed" (probe P7): take a new one and try once more. Any
// other error is the caller's.
export const DEAD_CREDENTIAL = /password authentication failed|terminating connection/;

export async function retryOnDeadCredential(work, reconnect) {
  try {
    return await work();
  } catch (e) {
    if (!DEAD_CREDENTIAL.test(e.message)) throw e;
    await reconnect();
    return work();
  }
}

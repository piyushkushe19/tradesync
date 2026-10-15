// Redis lock guaranteeing a single active synchronization across ALL API instances.
// Token = owning jobId. Release is compare-and-delete (Lua) so we never delete a lock
// that expired and was re-acquired by another job. The TTL is the crash-recovery path:
// if everything dies, the lock frees itself.
const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function createSyncLock(redis, prefix, ttlMs) {
  const key = `${prefix}:lock:sync`;
  return {
    async acquire(owner) {
      return (await redis.set(key, owner, 'PX', ttlMs, 'NX')) === 'OK';
    },
    async release(owner) {
      return (await redis.eval(RELEASE_LUA, 1, key, owner)) === 1;
    },
    async owner() {
      return redis.get(key);
    },
  };
}

'use strict';
// All blobs stay private. Fresh reads + ETag preconditions protect checkpoints.
function privateStore({ sdk = () => import('@vercel/blob'), token = process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  // Status polls read the authoritative work checkpoint. Conditional origin reads
  // avoid downloading an unchanged folder tree on every poll, without a stale CDN cache.
  const checkpoints = new Map();
  const cacheable = key => /(?:^|\/)work\.json$/.test(key);
  function remember(key, saved, bytes) {
    if (!cacheable(key) || bytes > 8000000 || !saved.etag) { checkpoints.delete(key); return; }
    checkpoints.delete(key); checkpoints.set(key, structuredClone(saved));
    while (checkpoints.size > 2) checkpoints.delete(checkpoints.keys().next().value);
  }
  return {
    async read(key, fresh = true) {
      const { get } = await sdk();
      const previous = fresh && cacheable(key) ? checkpoints.get(key) : undefined;
      const result = await get(key, { access: 'private', useCache: !fresh, ...(token ? { token } : {}),
        ...(previous ? { ifNoneMatch: previous.etag } : {}) });
      if (!result) { checkpoints.delete(key); return null; }
      if (result.statusCode === 304 && previous) return structuredClone(previous);
      const saved = { value: await new Response(result.stream).json(), etag: result.blob.etag };
      if (fresh) remember(key, saved, result.blob.size ?? Buffer.byteLength(JSON.stringify(saved.value)));
      return saved;
    },
    async write(key, value, etag) {
      const { put, BlobPreconditionFailedError } = await sdk();
      try {
        const json = JSON.stringify(value);
        const blob = await put(key, json, { access: 'private', addRandomSuffix: false, ...(token ? { token } : {}),
          allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}),
          contentType: 'application/json', cacheControlMaxAge: 60 });
        const saved = { value, etag: blob.etag }; remember(key, saved, Buffer.byteLength(json)); return saved;
      } catch (error) {
        checkpoints.delete(key);
        if ((BlobPreconditionFailedError && error instanceof BlobPreconditionFailedError) || /already exists/i.test(error.message))
          throw Object.assign(Error('The index changed concurrently. Retry.'), { status: 409 });
        throw error;
      }
    }
  };
}
module.exports = { privateStore };

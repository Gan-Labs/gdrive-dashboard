'use strict';
// All blobs stay private. Fresh reads + ETag preconditions protect checkpoints.
function privateStore({ sdk = () => import('@vercel/blob'), token = process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  return {
    async read(key, fresh = true) {
      const { get } = await sdk();
      const result = await get(key, { access: 'private', useCache: !fresh, ...(token ? { token } : {}) });
      if (!result) return null;
      return { value: await new Response(result.stream).json(), etag: result.blob.etag };
    },
    async write(key, value, etag) {
      const { put, BlobPreconditionFailedError } = await sdk();
      try {
        const blob = await put(key, JSON.stringify(value), { access: 'private', addRandomSuffix: false, ...(token ? { token } : {}),
          allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}),
          contentType: 'application/json', cacheControlMaxAge: 60 });
        return { value, etag: blob.etag };
      } catch (error) {
        if ((BlobPreconditionFailedError && error instanceof BlobPreconditionFailedError) || /already exists/i.test(error.message))
          throw Object.assign(Error('The index changed concurrently. Retry.'), { status: 409 });
        throw error;
      }
    }
  };
}
module.exports = { privateStore };

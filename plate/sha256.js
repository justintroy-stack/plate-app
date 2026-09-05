/* SHA-256, in plain JavaScript.

   The app hashes every file it backs up and every file it restores, so a backup can prove it
   is whole. WebCrypto would do that in one call, but crypto.subtle exists only in a secure
   context: https, or localhost. A phone reaches the Mac over plain http on a .local name,
   where the spike found crypto.subtle absent. So the hash is computed here, by code that runs
   anywhere, node included: about 30 ms for a 2.6 MB report set, and a home is a few of those. */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Int32Array(64);                  // the message schedule, reused for every block

/* one 64-byte block of `m`, starting at `off`, folded into the state H (eight int32 words) */
function block(H, m, off) {
  for (let i = 0; i < 16; i++, off += 4) W[i] = (m[off] << 24) | (m[off + 1] << 16) | (m[off + 2] << 8) | m[off + 3];
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15], y = W[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
  H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
}

/* the SHA-256 of `bytes`, as 64 lowercase hex characters, exactly what hashlib.sha256().hexdigest() prints */
export function sha256Hex(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (!(bytes instanceof Uint8Array)) throw new TypeError('sha256Hex: expected a Uint8Array');
  const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const n = bytes.length;
  const whole = n - (n % 64);
  for (let off = 0; off < whole; off += 64) block(H, bytes, off);
  // the tail: what is left, a 1 bit, zeros up to 8 bytes short of a block, then the length in bits, big-endian
  const rest = n - whole;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(bytes.subarray(whole));
  tail[rest] = 0x80;
  const hi = Math.floor(n / 0x20000000), lo = (n * 8) >>> 0;    // n * 8 as two 32-bit words; exact below 2^53 bits
  const L = tail.length;
  tail[L - 8] = hi >>> 24; tail[L - 7] = (hi >>> 16) & 255; tail[L - 6] = (hi >>> 8) & 255; tail[L - 5] = hi & 255;
  tail[L - 4] = lo >>> 24; tail[L - 3] = (lo >>> 16) & 255; tail[L - 2] = (lo >>> 8) & 255; tail[L - 1] = lo & 255;
  for (let off = 0; off < L; off += 64) block(H, tail, off);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += (H[i] >>> 0).toString(16).padStart(8, '0');
  return hex;
}

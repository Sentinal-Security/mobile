// Pure TypeScript RFC 6238 TOTP implementation without external native dependencies

function base32ToBytes(base32: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const numBytes = Math.floor((clean.length * 5) / 8);
  const bytes = new Uint8Array(numBytes);

  let buffer = 0;
  let bitsLeft = 0;
  let byteIndex = 0;

  for (let i = 0; i < clean.length; i++) {
    const val = chars.indexOf(clean[i]);
    if (val === -1) continue;
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      if (byteIndex < bytes.length) {
        bytes[byteIndex++] = (buffer >> bitsLeft) & 0xff;
      }
    }
  }
  return bytes;
}

function rotl(n: number, s: number): number {
  return (n << s) | (n >>> (32 - s));
}

function sha1(data: Uint8Array): Uint8Array {
  const byteLen = data.length;
  const bitLen = byteLen * 8;
  const withPadLen = ((byteLen + 8) >>> 6) + 1;
  const words = new Uint32Array(withPadLen * 16);

  for (let i = 0; i < byteLen; i++) {
    words[i >>> 2] |= (data[i] & 0xff) << (24 - (i % 4) * 8);
  }
  words[byteLen >>> 2] |= 0x80 << (24 - (byteLen % 4) * 8);
  words[words.length - 1] = bitLen;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  let e = 0xc3d2e1f0;

  const w = new Uint32Array(80);

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) {
      w[t] = words[i + t];
    }
    for (let t = 16; t < 80; t++) {
      w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    }

    let tempA = a;
    let tempB = b;
    let tempC = c;
    let tempD = d;
    let tempE = e;

    for (let t = 0; t < 80; t++) {
      let f = 0;
      let k = 0;
      if (t < 20) {
        f = (tempB & tempC) | (~tempB & tempD);
        k = 0x5a827999;
      } else if (t < 40) {
        f = tempB ^ tempC ^ tempD;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (tempB & tempC) | (tempB & tempD) | (tempC & tempD);
        k = 0x8f1bbcdc;
      } else {
        f = tempB ^ tempC ^ tempD;
        k = 0xca62c1d6;
      }
      const temp = (rotl(tempA, 5) + f + tempE + k + w[t]) | 0;
      tempE = tempD;
      tempD = tempC;
      tempC = rotl(tempB, 30);
      tempB = tempA;
      tempA = temp;
    }

    a = (a + tempA) | 0;
    b = (b + tempB) | 0;
    c = (c + tempC) | 0;
    d = (d + tempD) | 0;
    e = (e + tempE) | 0;
  }

  const result = new Uint8Array(20);
  const outWords = [a, b, c, d, e];
  for (let i = 0; i < 5; i++) {
    result[i * 4] = (outWords[i] >>> 24) & 0xff;
    result[i * 4 + 1] = (outWords[i] >>> 16) & 0xff;
    result[i * 4 + 2] = (outWords[i] >>> 8) & 0xff;
    result[i * 4 + 3] = outWords[i] & 0xff;
  }
  return result;
}

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let formattedKey = key;
  if (key.length > blockSize) {
    formattedKey = sha1(key);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(formattedKey);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const innerMsg = new Uint8Array(blockSize + message.length);
  innerMsg.set(iKeyPad, 0);
  innerMsg.set(message, blockSize);
  const innerHash = sha1(innerMsg);

  const outerMsg = new Uint8Array(blockSize + 20);
  outerMsg.set(oKeyPad, 0);
  outerMsg.set(innerHash, blockSize);
  return sha1(outerMsg);
}

export function generateTotp(base32Secret: string, epochSeconds: number = Math.floor(Date.now() / 1000)): string {
  try {
    const key = base32ToBytes(base32Secret);
    if (key.length === 0) return "------";

    const timeWindow = Math.floor(epochSeconds / 30);
    const timeBytes = new Uint8Array(8);
    let temp = timeWindow;
    for (let i = 7; i >= 0; i--) {
      timeBytes[i] = temp & 0xff;
      temp = Math.floor(temp / 256);
    }

    const hash = hmacSha1(key, timeBytes);
    const offset = hash[hash.length - 1] & 0x0f;
    const binary =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, "0");
  } catch {
    return "------";
  }
}

export function getSecondsRemaining(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

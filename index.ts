import sharp from "sharp";

const CorrectSignature: Buffer = Buffer.from([0x49, 0x53, 0x42]);
const Currentversion: number = 1;

interface ImageObject {
  version: number;
  channels: number;
  primitiveType: number;
  bitsPerChannel: number;
  channelOrder: number;
  width: number;
  height: number;
  raw: Buffer
}

/* =========================
 * ParseISB
 * ========================= */
export function ParseISB(buffer: Buffer): ImageObject {
  if (buffer.length < 16) {
    throw new Error("Invalid ISB: buffer too small");
  }

  const Signature = buffer.subarray(0, 3);
  const version = buffer.readUInt8(3);
  const channels        = buffer.readUInt8(4);
  const primitiveType   = buffer.readUInt8(5);
  const bitsPerChannel  = buffer.readUInt8(6);
  const channelOrder    = buffer.readUInt8(7);
  const width           = buffer.readUInt32LE(8);
  const height          = buffer.readUInt32LE(12);

  if (Signature.equals(CorrectSignature)) {
    throw new Error("Invalid ISB: Invalid file fixed signature code in header (Parsed: " + Signature + ")");
  }

  if (version >= Currentversion) {
    throw new Error("Invalid ISB: The latest version is " + Currentversion + " (Parsed: " + version + ")");
  } else if (version <= Currentversion) {
    throw new Error("Invalid ISB: not support previous versions" + " (Parsed: " + version + ")");
  }

  if (width === 0 || height === 0) {
    throw new Error("Invalid ISB: zero dimension" + " (Parsed: " + "[" + width + ", " + height + "]" + ")");
  }

  if (bitsPerChannel % 8 !== 0) {
    throw new Error("Invalid ISB: bitsPerChannel must be multiple of 8" + " (Parsed: " + bitsPerChannel + ")");
  }

  const bytesPerChannel = bitsPerChannel / 8;
  const bytesPerPixel   = channels * bytesPerChannel;
  const expectedSize    = width * height * bytesPerPixel;

  if (buffer.length !== 16 + expectedSize) {
    throw new Error("Invalid ISB: size mismatch");
  }

  return {
    version,
    channels,
    primitiveType,
    bitsPerChannel,
    channelOrder,
    width,
    height,
    raw: buffer.subarray(16)
  };
}

/* =========================
 * MakeISB
 * ========================= */
export function MakeISB({
  channels,
  primitiveType,
  bitsPerChannel,
  channelOrder,
  width,
  height,
  raw
}: ImageObject) {
  const header = Buffer.alloc(16);

  CorrectSignature.copy(header,     0);
  header.writeUInt8(Currentversion, 3)
  header.writeUInt8(channels,       4);
  header.writeUInt8(primitiveType,  5);
  header.writeUInt8(bitsPerChannel, 6);
  header.writeUInt8(channelOrder,   7);
  header.writeUInt32LE(width,        8);
  header.writeUInt32LE(height,       12);

  return Buffer.concat([header, raw]);
}

function NormalizeChannels(channels: number): sharp.Channels {
  switch (channels) {
    case 1: return 1;
    case 3: return 3;
    case 4: return 4;
    default: throw new Error("unsupported channel count" + " (Parsed: " + channels + ")");
  }
}

function isSharpChannel(n: number): n is sharp.Channels {
  return n === 1 || n === 3 || n === 4;
}

/* =========================
 * sharpISB (adapter)
 * ========================= */
export function sharpISB(isb: ImageObject): any {
  let {
    channels,
    primitiveType,
    bitsPerChannel,
    channelOrder,
    width,
    height,
    raw
  } = isb;

  channels = NormalizeChannels(channels)

  /* sharp 지원 범위 검사 */
  if (primitiveType !== 0x00) {
    throw new Error("sharpISB: only unsigned integer supported");
  }

  if (bitsPerChannel !== 8 && bitsPerChannel !== 16) {
    throw new Error("sharpISB: only 8/16 bits per channel supported");
  }

  /* 채널 순서 정규화 */
  let normalizedRaw: Buffer = raw;
  let normalizedChannels: sharp.Channels = channels as sharp.Channels;

  // BGR → RGB
  if (channelOrder === 0x03 && channels === 3) {
    normalizedRaw = swapRGB(raw, bitsPerChannel);
  }

  // BGRA → RGBA
  if (channelOrder === 0x05 && channels === 4) {
    normalizedRaw = swapRGBA(raw, bitsPerChannel);
  }

  // ARGB → RGBA
  if (channelOrder === 0x06 && channels === 4) {
    normalizedRaw = shiftARGB(raw, bitsPerChannel);
  }

  // ABGR → RGBA
  if (channelOrder === 0x07 && channels === 4) {
    normalizedRaw = shiftABGR(raw, bitsPerChannel);
  }

  if (!isSharpChannel(channels)) {
    throw new Error("invalid channel count");
  }

  return sharp(normalizedRaw, {
    raw: {
      width,
      height,
      channels: normalizedChannels
    }
  });
}

/* =========================
 * Channel helpers
 * ========================= */
function swapRGB(buf: Buffer, bpc: number): Buffer {
  const step = bpc / 8 * 3;
  const out = Buffer.alloc(buf.length);

  for (let i = 0; i < buf.length; i += step) {
    out[i]     = buf[i + 2];
    out[i + 1] = buf[i + 1];
    out[i + 2] = buf[i];
  }
  return out;
}

function swapRGBA(buf: Buffer, bpc: number): Buffer {
  const step = bpc / 8 * 4;
  const out = Buffer.alloc(buf.length);

  for (let i = 0; i < buf.length; i += step) {
    out[i]     = buf[i + 2];
    out[i + 1] = buf[i + 1];
    out[i + 2] = buf[i];
    out[i + 3] = buf[i + 3];
  }
  return out;
}

function shiftARGB(buf: Buffer, bpc: number): Buffer {
  const step = bpc / 8 * 4;
  const out = Buffer.alloc(buf.length);

  for (let i = 0; i < buf.length; i += step) {
    out[i]     = buf[i + 1];
    out[i + 1] = buf[i + 2];
    out[i + 2] = buf[i + 3];
    out[i + 3] = buf[i];
  }
  return out;
}

function shiftABGR(buf: Buffer, bpc: number): Buffer {
  const step = bpc / 8 * 4;
  const out = Buffer.alloc(buf.length);

  for (let i = 0; i < buf.length; i += step) {
    out[i]     = buf[i + 3];
    out[i + 1] = buf[i + 2];
    out[i + 2] = buf[i + 1];
    out[i + 3] = buf[i];
  }
  return out;
}

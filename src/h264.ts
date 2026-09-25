// Shared by the extension host and the webview bundle: no Node or DOM imports.

/**
 * Builds the WebCodecs codec string (`avc1.PPCCLL`) from the SPS at the start of an Annex B
 * buffer, or returns undefined when the buffer does not start with an SPS.
 */
export function avcCodecString(annexB: Uint8Array): string | undefined {
  const nal = firstNalUnit(annexB);
  if (!nal || nal.length < 4) return undefined;
  if ((nal[0] & 0x1f) !== 7) return undefined; // not an SPS
  const hex = (b: number) => b.toString(16).padStart(2, '0');
  return `avc1.${hex(nal[1])}${hex(nal[2])}${hex(nal[3])}`;
}

/** The first NAL unit's bytes (header included) after a 3- or 4-byte start code. */
export function firstNalUnit(annexB: Uint8Array): Uint8Array | undefined {
  const start = startCodeEnd(annexB, 0);
  if (start < 0) return undefined;
  for (let i = start; i + 2 < annexB.length; i++) {
    if (annexB[i] === 0 && annexB[i + 1] === 0 && (annexB[i + 2] === 1 || (annexB[i + 2] === 0 && annexB[i + 3] === 1))) {
      return annexB.subarray(start, i);
    }
  }
  return annexB.subarray(start);
}

function startCodeEnd(bytes: Uint8Array, from: number): number {
  if (bytes[from] === 0 && bytes[from + 1] === 0) {
    if (bytes[from + 2] === 1) return from + 3;
    if (bytes[from + 2] === 0 && bytes[from + 3] === 1) return from + 4;
  }
  return -1;
}

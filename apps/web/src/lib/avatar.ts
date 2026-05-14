/**
 * Generate a unique background color and Notion-style avatar config from a UUID/ID string.
 * Deterministic — same ID always produces the same result.
 */

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** A second independent hash to avoid correlation between color and face parts */
function hash2(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) | 0;
  }
  return Math.abs(h);
}

// ── Color generation ──

const HUES = [
  0, 15, 28, 40, 55, 75, 95, 130, 155, 175, 195, 210, 230, 255, 275, 295,
  315, 335, 350,
];

export function getAvatarColor(id: string): {
  bg: string;
  fg: string;
} {
  const h = hash(id);
  const hue = HUES[h % HUES.length];
  const sat = 50 + (h % 20); // 50-69%
  const light = 88 + (h % 7); // 88-94% — pastel bg
  const fgLight = 25 + (h % 15); // 25-39% — dark fg for contrast

  return {
    bg: `hsl(${hue}, ${sat}%, ${light}%)`,
    fg: `hsl(${hue}, ${sat}%, ${fgLight}%)`,
  };
}

// ── Notion avatar config generation ──

// Range limits for each config property (exclusive upper bound)
const RANGES = {
  face: 12,
  eye: 15,
  eyebrow: 17,
  glass: 14,
  hair: 59,
  mouth: 21,
  nose: 15,
  accessory: 14,
  beard: 18,
  detail: 15,
};

export interface NotionAvatarConfig {
  face: number;
  eye: number;
  eyebrow: number;
  glass: number;
  hair: number;
  mouth: number;
  nose: number;
  accessory: number;
  beard: number;
  detail: number;
}

/**
 * Generate a deterministic Notion avatar config from an ID string.
 */
export function getNotionAvatarConfig(id: string): NotionAvatarConfig {
  const h = hash2(id);
  // Use different bit ranges of the hash to pick each part independently
  const pick = (range: number, seed: number) => seed % range;

  // Chain multiple hash derivations for independence
  const h1 = hash2(id + "a");
  const h2 = hash2(id + "b");
  const h3 = hash2(id + "c");

  return {
    face: pick(RANGES.face, h),
    eye: pick(RANGES.eye, h1),
    eyebrow: pick(RANGES.eyebrow, h2),
    glass: pick(RANGES.glass, h3),
    hair: pick(RANGES.hair, hash2(id + "d")),
    mouth: pick(RANGES.mouth, hash2(id + "e")),
    nose: pick(RANGES.nose, hash2(id + "f")),
    // Keep accessory/beard/detail sparse — most people shouldn't have them
    accessory: hash2(id + "g") % 5 === 0 ? pick(RANGES.accessory, hash2(id + "g")) : 0,
    beard: hash2(id + "h") % 4 === 0 ? pick(RANGES.beard, hash2(id + "h")) : 0,
    detail: hash2(id + "i") % 4 === 0 ? pick(RANGES.detail, hash2(id + "i")) : 0,
  };
}

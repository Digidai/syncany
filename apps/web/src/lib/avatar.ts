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
    bg: `hsl(${hue}, ${sat}%, ${fgLight}%)`,
    fg: `hsl(${hue}, ${sat}%, ${fgLight}%)`,
  };
}

/**
 * Jelly-style avatar gradient — a layered background that reads as a
 * glossy 3D blob rather than a flat colored circle. Three pieces:
 *
 *   1. A radial top-left highlight (white→transparent) — the "wet"
 *      light reflection that sells the candy-button look.
 *   2. A radial bottom-right shadow (black→transparent) — adds depth.
 *   3. The underlying linear gradient between two complementary hues.
 *
 * Stacked in a single CSS `background` shorthand so it composes onto
 * any element. The accent hsl strings are also exposed separately so
 * the caller can build matching ring / glow effects.
 */
export function getAvatarGradient(seed: string): {
  background: string;
  fg: string;
  accentA: string;
  accentB: string;
} {
  const h1 = hash(seed);
  const h2 = hash2(seed);
  const hueA = HUES[h1 % HUES.length];
  // Offset second hue by ~120° (with jitter) for an analog/complement feel
  const hueB = (hueA + 110 + (h2 % 50)) % 360;
  const sat = 78 + (h1 % 14);     // 78-91% — punchier for jelly look
  const lightA = 58 + (h1 % 8);   // 58-65%
  const lightB = 44 + (h2 % 8);   // 44-51%
  const angle = 135 + (h2 % 40);  // 135-174°

  const colorA = `hsl(${hueA},${sat}%,${lightA}%)`;
  const colorB = `hsl(${hueB},${sat}%,${lightB}%)`;

  const background = [
    // Top-left wet highlight
    "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 42%)",
    // Bottom-right depth shadow
    "radial-gradient(circle at 72% 78%, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 55%)",
    // Hue gradient base
    `linear-gradient(${angle}deg, ${colorA} 0%, ${colorB} 100%)`,
  ].join(", ");

  return { background, fg: "#ffffff", accentA: colorA, accentB: colorB };
}

/**
 * Generate a fresh random avatar seed. Used by the "shuffle" UI affordance
 * on agent settings — short URL-safe string, deterministic enough that the
 * gradient stays stable across reloads.
 */
export function randomAvatarSeed(): string {
  // 12 chars of base36-ish entropy is plenty; we just need uniqueness, not
  // cryptographic strength.
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
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

export interface CoverArtPreset {
  id: string;
  bgA: string;
  bgB: string;
  accent: string;
  motif: "sunset" | "neon" | "waves" | "grid" | "vinyl" | "forest" | "orbit" | "rain" | "city";
  caption: string;
  badge?: string;
}

/**
 * Generates crisp, zero-network SVG cover artworks resembling real Bilibili music video thumbnails
 * so M0 prototype runs cleanly both offline and inside sandboxed previews.
 */
export function makeCoverDataUri(preset: CoverArtPreset): string {
  const { bgA, bgB, accent, motif, caption, badge } = preset;

  let artLayer = "";
  switch (motif) {
    case "sunset":
      artLayer = `
        <circle cx="200" cy="175" r="78" fill="${accent}" opacity="0.92" />
        <rect x="0" y="210" width="400" height="190" fill="rgba(16,14,13,0.48)" />
        <path d="M0 245 Q100 225 200 245 T400 245" stroke="${accent}" stroke-width="3" fill="none" opacity="0.65" />
        <path d="M0 278 Q120 262 240 278 T400 278" stroke="#f5f4ee" stroke-width="2" fill="none" opacity="0.35" />
      `;
      break;
    case "neon":
      artLayer = `
        <polygon points="36,310 135,125 225,260 290,175 375,310" fill="rgba(18,16,20,0.65)" stroke="${accent}" stroke-width="2.5" />
        <circle cx="305" cy="95" r="34" fill="none" stroke="${accent}" stroke-width="5" opacity="0.88" />
        <line x1="25" y1="330" x2="375" y2="330" stroke="#f5f4ee" stroke-width="2" opacity="0.45" />
      `;
      break;
    case "waves":
      artLayer = `
        <path d="M0 200 C80 120 150 280 230 190 C300 110 350 240 400 180 L400 400 L0 400 Z" fill="${accent}" opacity="0.48" />
        <path d="M0 250 C90 190 180 310 270 235 C330 195 370 260 400 240 L400 400 L0 400 Z" fill="rgba(18,16,15,0.58)" />
      `;
      break;
    case "grid":
      artLayer = `
        <g stroke="${accent}" stroke-width="1.5" opacity="0.5">
          <line x1="0" y1="220" x2="400" y2="220" />
          <line x1="0" y1="260" x2="400" y2="260" />
          <line x1="0" y1="310" x2="400" y2="310" />
          <line x1="200" y1="220" x2="40" y2="400" />
          <line x1="200" y1="220" x2="145" y2="400" />
          <line x1="200" y1="220" x2="255" y2="400" />
          <line x1="200" y1="220" x2="360" y2="400" />
        </g>
        <circle cx="200" cy="150" r="56" fill="${accent}" opacity="0.86" />
      `;
      break;
    case "vinyl":
      artLayer = `
        <circle cx="200" cy="200" r="130" fill="rgba(18,17,16,0.72)" stroke="#f5f4ee" stroke-opacity="0.22" stroke-width="2" />
        <circle cx="200" cy="200" r="95" fill="none" stroke="#f5f4ee" stroke-opacity="0.16" stroke-width="1.5" />
        <circle cx="200" cy="200" r="46" fill="${accent}" opacity="0.95" />
        <circle cx="200" cy="200" r="9" fill="#181716" />
      `;
      break;
    case "forest":
      artLayer = `
        <polygon points="85,330 155,130 225,330" fill="rgba(20,24,20,0.65)" />
        <polygon points="180,330 260,95 340,330" fill="rgba(15,18,16,0.78)" />
        <circle cx="105" cy="95" r="28" fill="${accent}" opacity="0.9" />
      `;
      break;
    case "orbit":
      artLayer = `
        <ellipse cx="200" cy="200" rx="145" ry="52" transform="rotate(-24 200 200)" fill="none" stroke="${accent}" stroke-width="3.5" opacity="0.85" />
        <ellipse cx="200" cy="200" rx="110" ry="38" transform="rotate(28 200 200)" fill="none" stroke="#f5f4ee" stroke-width="1.5" opacity="0.45" />
        <circle cx="200" cy="200" r="32" fill="${accent}" />
      `;
      break;
    case "rain":
      artLayer = `
        <g stroke="#f5f4ee" stroke-width="2" opacity="0.42" stroke-linecap="round">
          <line x1="75" y1="60" x2="55" y2="145" />
          <line x1="145" y1="45" x2="120" y2="155" />
          <line x1="230" y1="70" x2="205" y2="165" />
          <line x1="310" y1="50" x2="285" y2="145" />
        </g>
        <rect x="44" y="232" width="312" height="92" rx="12" fill="rgba(20,19,18,0.52)" stroke="${accent}" stroke-opacity="0.55" />
      `;
      break;
    case "city":
      artLayer = `
        <rect x="34" y="165" width="52" height="190" fill="rgba(16,15,15,0.76)" />
        <rect x="96" y="110" width="68" height="245" fill="rgba(16,15,15,0.85)" />
        <rect x="174" y="145" width="58" height="210" fill="rgba(16,15,15,0.74)" />
        <rect x="244" y="88" width="72" height="267" fill="rgba(16,15,15,0.88)" />
        <rect x="326" y="185" width="44" height="170" fill="rgba(16,15,15,0.72)" />
        <rect x="114" y="135" width="12" height="12" fill="${accent}" />
        <rect x="262" y="116" width="14" height="14" fill="${accent}" />
        <rect x="284" y="152" width="14" height="14" fill="${accent}" opacity="0.7" />
      `;
      break;
  }

  const badgeSvg = badge
    ? `<rect x="24" y="24" rx="6" width="${Math.max(54, badge.length * 14 + 20)}" height="28" fill="rgba(20,19,18,0.72)" stroke="${accent}" stroke-opacity="0.7" />
       <text x="34" y="43" fill="#F5F4EE" font-family="monospace" font-size="14" font-weight="600">${escapeXml(badge)}</text>`
    : "";

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bgA}" />
          <stop offset="100%" stop-color="${bgB}" />
        </linearGradient>
      </defs>
      <rect width="400" height="400" fill="url(#g)" />
      ${artLayer}
      <rect x="0" y="318" width="400" height="82" fill="rgba(14,13,12,0.58)" />
      ${badgeSvg}
      <text x="24" y="368" fill="#F5F4EE" font-family="sans-serif" font-size="23" font-weight="700">${escapeXml(caption)}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

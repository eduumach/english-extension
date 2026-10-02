// The Glossa logo as inline SVG, for the popup, the hub and the video panel.
// Same geometry and colors as scripts/icon.py (which draws the PNG icons).
const BG = "#1A1A1A";
const COLORS = ["#FF9E5E", "#FFE066", "#7FD17F"]; // new, seen, learned: drawn in this order
// Each row: bar end, yellow end, green end, as fractions of the bar width.
const ROWS = [
  [1, 0.72, 0.42],
  [1, 0.5, 0.28],
  [0.78, 0.62, 0.4],
];
const BAR_H = 13.5;
const GAP = 8.5;
const X0 = 18;
const W = 64;
const TOP = (100 - (3 * BAR_H + 2 * GAP)) / 2;

const bars = ROWS.flatMap((row, i) =>
  row.map(
    (frac, j) =>
      `<rect x="${X0}" y="${TOP + i * (BAR_H + GAP)}" width="${W * frac}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${COLORS[j]}"/>`,
  ),
).join("");

export function logoSvg(size: number, className = "") {
  return (
    `<svg class="${className}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">` +
    `<rect width="100" height="100" rx="23" fill="${BG}"/>${bars}</svg>`
  );
}

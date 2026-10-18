// Web's donut is fluid (recharts ResponsiveContainer inside a h-56/224px
// container, outerRadius 85%) rather than a fixed pixel size - fixed at
// 190px here made mobile's chart visibly smaller than web's once the two
// charts sit side by side on a wide screen (lg:grid-cols-2). Sized from the
// card's actual measured width instead, capped at web's own 224px ceiling,
// keeping the same 0.432/0.279 outer/inner radius ratios either way.
export const MAX_DONUT_SIZE = 224;
export const MIN_DONUT_SIZE = 160;
export const OUTER_R_RATIO = 82 / 190;
export const INNER_R_RATIO = 53 / 190;
export const PAD_DEG = 2;

export function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function donutSlicePath(cx, cy, innerR, outerR, startAngle, rawEndAngle) {
  // A sweep of exactly 360deg (a single category holding the whole total)
  // puts the arc's start and end points on the same coordinate, which SVG
  // renders as a zero-length degenerate path instead of a full ring - clamp
  // just short of a full turn so the two points stay distinct.
  const endAngle = rawEndAngle - startAngle >= 360 ? startAngle + 359.99 : rawEndAngle;
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const startInner = polarToCartesian(cx, cy, innerR, startAngle);
  const endInner = polarToCartesian(cx, cy, innerR, endAngle);
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}


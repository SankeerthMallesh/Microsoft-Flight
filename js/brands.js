// Logo-style brand tiles for the livery pickers, drawn as small inline SVGs (no image files).
// Wordmarks and emblems are simplified recreations; airline names and logos are trademarks of their owners.
const F = {
  sans: "'Montserrat','Helvetica Neue',Arial,sans-serif",
  wide: "'Archivo Black','Arial Black',Arial,sans-serif",
  serif: "'Playfair Display',Georgia,serif",
  cond: "'Oswald','Arial Narrow',Arial,sans-serif",
  script: "'Kaushan Script','Brush Script MT',cursive",
};
const W = 120, H = 64;

// ---------------------------------------------------------------- emblems (drawn in a ~24px box centred at 0,0)
const heartPath = 'M0,-9 C-13,-21 -27,-6 -15,6 L0,19 L15,6 C27,-6 13,-21 0,-9 Z';
const E = {
  swHeart: () => `<g transform="scale(0.62)"><defs><clipPath id="swh"><path d="${heartPath}"/></clipPath></defs>
    <g clip-path="url(#swh)"><rect x="-30" y="-25" width="60" height="50" fill="#FFBF27"/><path d="M-30,-30 L-2,-30 L-12,30 L-30,30 Z" fill="#304CB2"/><path d="M-2,-30 L13,-30 L3,30 L-12,30 Z" fill="#E3172D"/></g>
    <path d="${heartPath}" fill="none" stroke="#fff" stroke-width="2.4"/></g>`,
  deltaWidget: () => '<path d="M0,-15 L17,14 L-17,14 Z" fill="#E31837"/><path d="M0,-15 L17,14 L0,4 Z" fill="#A6192E"/>',
  globe: (c) => `<circle r="14" fill="none" stroke="${c}" stroke-width="2"/><ellipse rx="6" ry="14" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M-14,0 H14 M-12,-7 H12 M-12,7 H12" stroke="${c}" stroke-width="1.3"/>`,
  aaFlight: () => '<path d="M-14,10 L0,-14 L4,-6 L-6,10 Z" fill="#0078D2"/><path d="M-2,10 L6,-4 L14,10 Z" fill="#C30019"/><path d="M-6,10 L4,-6 L8,1 L2,10 Z" fill="#9DA6AB"/>',
  speedmarque: () => '<path d="M-16,6 C-4,-4 8,-8 18,-6 C8,-3 -2,2 -10,10 Z" fill="#EB2226"/><path d="M-16,6 C-6,0 4,-2 12,-1 C4,1 -4,4 -10,10 Z" fill="#075AAA"/>',
  crane: (c) => `<circle r="14" fill="none" stroke="${c}" stroke-width="2"/><path d="M-10,4 C-4,-2 0,-10 8,-10 C4,-7 3,-4 4,-1 C7,0 9,2 10,5 C5,3 1,4 -2,7 Z" fill="${c}"/>`,
  crown: (c) => `<path d="M-12,4 L-12,-4 L-6,1 L0,-9 L6,1 L12,-4 L12,4 Z" fill="${c}"/><circle cx="0" cy="-12" r="2" fill="${c}"/><rect x="-12" y="6" width="24" height="2.5" fill="${c}"/>`,
  oryx: (c) => `<path d="M-14,8 C-8,0 -2,-2 6,-2 L12,-14 L10,-1 C13,1 14,4 13,8 L9,4 L4,10 L2,4 L-6,6 L-10,12 Z" fill="${c}"/>`,
  sqBird: () => '<path d="M-14,6 C-6,-6 6,-12 16,-10 C8,-6 4,-2 2,4 C0,8 -6,10 -14,6 Z" fill="#F99F1C"/><path d="M-6,2 C0,-2 6,-4 12,-4" stroke="#1D3C78" stroke-width="1.2" fill="none"/>',
  harp: () => '<circle r="12" fill="#F1C933"/><path d="M-6,8 C-6,-4 0,-10 8,-8 L4,8 Z" fill="#073590"/>',
  maple: (c) => '<circle r="14" fill="#fff"/><path d="M0,-11 L2,-6 L6,-8 L5,-2 L10,-4 L8,1 L11,3 L4,5 L5,9 L1,7 L1,12 L-1,12 L-1,7 L-5,9 L-4,5 L-11,3 L-8,1 L-10,-4 L-5,-2 L-6,-8 L-2,-6 Z" fill="' + c + '"/>',
  roo: (c) => `<path d="M10,12 C8,6 6,4 2,2 C-2,0 -6,-2 -8,-6 L-12,-14 L-6,-8 L-2,-10 L-4,-6 C0,-4 6,-2 10,2 C13,5 14,9 14,12 Z" fill="${c}"/>`,
  anaBars: () => '<rect x="-16" y="-8" width="32" height="5" fill="#13448F"/><rect x="-16" y="0" width="32" height="5" fill="#1F9DE0"/>',
  tsuru: () => '<circle r="15" fill="#CC0000"/><path d="M-10,2 C-6,-6 2,-10 10,-6 C4,-4 2,0 3,4 C-1,2 -5,3 -10,2 Z M-4,6 C0,4 4,5 8,8 C2,8 -1,9 -4,6 Z" fill="#fff"/>',
  tkBird: () => '<circle r="14" fill="#fff"/><path d="M-9,6 C-3,-4 4,-9 11,-7 C5,-4 3,0 3,4 C0,2 -4,3 -9,6 Z" fill="#C70A0C"/>',
  brushwing: (c) => `<path d="M-15,8 C-6,-2 4,-8 16,-10 C8,-4 2,2 -2,10 C-6,6 -10,6 -15,8 Z" fill="${c}"/>`,
  upsShield: () => '<path d="M-12,-14 H12 V2 C12,10 6,14 0,16 C-6,14 -12,10 -12,2 Z" fill="#FFB500"/><text x="0" y="5" text-anchor="middle" font-family="' + F.sans + '" font-weight="800" font-size="10" fill="#351C15">ups</text>',
  swallow: () => '<circle r="14" fill="#fff" stroke="#1A2A6C" stroke-width="2"/><path d="M-9,4 C-4,-4 4,-8 10,-6 C4,-3 1,1 0,6 C-3,4 -6,4 -9,4 Z" fill="#D7172F"/><path d="M-4,8 C0,5 5,4 9,6" stroke="#1A2A6C" stroke-width="2" fill="none"/>',
  wing: (c) => `<path d="M-14,6 C-6,-4 6,-8 15,-8 C10,-4 6,0 4,6 Z" fill="${c}"/><path d="M-6,8 L-2,-2 L2,8 Z" fill="${c}"/>`,
  circleMark: (c, t) => `<circle r="13" fill="none" stroke="${c}" stroke-width="2"/><text y="4.5" text-anchor="middle" font-family="${F.wide}" font-size="11" fill="${c}">${t}</text>`,
};

// ---------------------------------------------------------------- brand specs
// bg, word (lines), color, font, size, weight, emblem, layout ('left' emblem | 'right' emblem | 'none'), letter-spacing
const B = {
  southwest: { bg: '#304CB2', word: 'Southwest', color: '#fff', font: F.sans, weight: 800, size: 17, emblem: E.swHeart(), pos: 'right' },
  delta: { bg: '#ffffff', word: 'DELTA', color: '#0B2D6B', font: F.sans, weight: 800, size: 20, ls: 3, emblem: E.deltaWidget(), pos: 'right' },
  emirates: { bg: '#D71921', word: 'Emirates', color: '#fff', font: F.serif, weight: 700, size: 22, pos: 'none', sub: 'Fly Better', subColor: '#f3d0d2' },
  united: { bg: '#ffffff', word: 'UNITED', color: '#0E2A5C', font: F.sans, weight: 800, size: 19, ls: 2, emblem: E.globe('#0E2A5C'), pos: 'right' },
  american: { bg: '#ffffff', word: 'American', color: '#36495A', font: F.sans, weight: 700, size: 18, emblem: E.aaFlight(), pos: 'right' },
  british: { bg: '#ffffff', word: 'BRITISH AIRWAYS', color: '#012169', font: F.cond, weight: 600, size: 13, ls: 1, emblem: E.speedmarque(), pos: 'right' },
  lufthansa: { bg: '#05164D', word: 'Lufthansa', color: '#fff', font: F.serif, weight: 600, size: 18, emblem: E.crane('#fff'), pos: 'left' },
  airfrance: { bg: '#ffffff', word: 'AIRFRANCE', color: '#002157', font: F.sans, weight: 800, size: 16, ls: 1, emblem: '<path d="M-14,8 L6,-8 L10,-8 L-10,8 Z" fill="#E1000F"/>', pos: 'right' },
  klm: { bg: '#00A1DE', word: 'KLM', color: '#fff', font: F.sans, weight: 800, size: 24, ls: 2, emblem: E.crown('#fff'), pos: 'top' },
  qatar: { bg: '#5C0632', word: 'QATAR', color: '#fff', font: F.sans, weight: 700, size: 15, ls: 3, emblem: E.oryx('#fff'), pos: 'left', sub: 'AIRWAYS', subColor: '#d9c3cd' },
  singapore: { bg: '#1D3C78', word: 'SINGAPORE', color: '#fff', font: F.serif, weight: 600, size: 13, ls: 1, emblem: E.sqBird(), pos: 'left', sub: 'AIRLINES', subColor: '#F99F1C' },
  ryanair: { bg: '#073590', word: 'RYANAIR', color: '#fff', font: F.sans, weight: 800, size: 17, ls: 1, emblem: E.harp(), pos: 'right' },
  easyjet: { bg: '#FF6600', word: 'easyJet', color: '#fff', font: F.sans, weight: 800, size: 23, pos: 'none' },
  aircanada: { bg: '#111111', word: 'AIR CANADA', color: '#fff', font: F.sans, weight: 700, size: 13, ls: 2, emblem: E.maple('#D22630'), pos: 'left' },
  qantas: { bg: '#E40000', word: 'QANTAS', color: '#fff', font: F.sans, weight: 800, size: 18, ls: 2, emblem: E.roo('#fff'), pos: 'right' },
  ana: { bg: '#ffffff', word: 'ANA', color: '#13448F', font: F.sans, weight: 800, size: 26, ls: 2, emblem: E.anaBars(), pos: 'right' },
  jal: { bg: '#ffffff', word: 'JAPAN AIRLINES', color: '#4b4b4b', font: F.sans, weight: 700, size: 11, ls: 1, emblem: E.tsuru(), pos: 'left' },
  turkish: { bg: '#C70A0C', word: 'TURKISH', color: '#fff', font: F.sans, weight: 800, size: 15, ls: 2, emblem: E.tkBird(), pos: 'left', sub: 'AIRLINES', subColor: '#ffd9d9' },
  alaska: { bg: '#01426A', word: 'Alaska', color: '#fff', font: F.script, weight: 400, size: 26, pos: 'none' },
  jetblue: { bg: '#003876', word: 'jetBlue', color: '#fff', font: F.sans, weight: 800, size: 22, pos: 'none' },
  cathay: { bg: '#005D63', word: 'CATHAY', color: '#fff', font: F.sans, weight: 700, size: 15, ls: 3, emblem: E.brushwing('#fff'), pos: 'left', sub: 'PACIFIC', subColor: '#bfe0e1' },
  etihad: { bg: '#f6f1ea', word: 'ETIHAD', color: '#8C6A1E', font: F.serif, weight: 700, size: 20, ls: 4, pos: 'none', sub: 'AIRWAYS', subColor: '#BD8B13' },
  fedex: { bg: '#ffffff', html: `<tspan fill="#4D148C">Fed</tspan><tspan fill="#FF6600">Ex</tspan>`, word: 'FedEx', font: F.sans, weight: 800, size: 26, pos: 'none' },
  ups: { bg: '#351C15', word: 'UPS Airlines', color: '#FFB500', font: F.sans, weight: 700, size: 13, emblem: E.upsShield(), pos: 'left' },
  virgin: { bg: '#DA0530', word: 'virgin', color: '#fff', font: F.script, weight: 400, size: 24, pos: 'none', sub: 'atlantic', subColor: '#ffd5dd' },
  chinaeastern: { bg: '#ffffff', word: 'CHINA EASTERN', color: '#1A2A6C', font: F.sans, weight: 700, size: 11, ls: 1, emblem: E.swallow(), pos: 'left' },
  aeroflot: { bg: '#02458D', word: 'AEROFLOT', color: '#fff', font: F.sans, weight: 800, size: 15, ls: 2, emblem: E.wing('#F28B00'), pos: 'left' },
  'airbus-house': { bg: '#00205B', word: 'AIRBUS', color: '#fff', font: F.sans, weight: 800, size: 19, ls: 3, pos: 'none' },
  'boeing-house': { bg: '#0039A6', word: 'BOEING', color: '#fff', font: F.sans, weight: 800, size: 19, ls: 3, emblem: E.circleMark('#fff', 'B'), pos: 'left' },
  'embraer-house': { bg: '#1b2a3f', word: 'EMBRAER', color: '#fff', font: F.sans, weight: 700, size: 16, ls: 3, pos: 'none' },
  'regional-house': { bg: '#0a6c74', word: 'Regional', color: '#fff', font: F.sans, weight: 700, size: 17, pos: 'none', sub: 'EXPRESS', subColor: '#bfe5e7' },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// generic tile for liveries without a brand spec: livery colours + initials
function generic(lv) {
  const bg = lv.finBase && lv.finBase !== '#ffffff' && lv.finBase !== '#f5f6f8' ? lv.finBase : lv.base || '#e8eaee';
  const light = /^#(f|e|d)/i.test(bg);
  return { bg, word: lv.name, color: light ? '#1d2733' : '#fff', font: F.sans, weight: 700, size: 13, pos: 'none' };
}

export function brandSVG(lv) {
  const b = B[lv.id] || generic(lv);
  const hasE = b.emblem && b.pos !== 'none';
  const top = b.pos === 'top';
  const ex = b.pos === 'left' ? 22 : W - 22;
  const tx = hasE && !top ? (b.pos === 'left' ? 42 + (W - 42) / 2 - 4 : (W - 40) / 2 + 4) : W / 2;
  const maxW = hasE && !top ? W - 50 : W - 14;
  const ty = top ? 52 : b.sub ? 30 : 38;
  const ls = b.ls ? ` letter-spacing="${b.ls}"` : '';
  const word = b.html || esc(b.word);
  const fit = ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"`;
  // only squeeze long words (estimate width ~0.62em per char)
  const est = b.word.length * b.size * 0.6 + (b.ls || 0) * b.word.length;
  const text = `<text x="${tx}" y="${ty}" text-anchor="middle" font-family="${b.font}" font-weight="${b.weight}" font-size="${b.size}" fill="${b.color || '#fff'}"${ls}${est > maxW ? fit : ''}>${word}</text>`;
  const sub = b.sub ? `<text x="${tx}" y="${ty + 15}" text-anchor="middle" font-family="${F.sans}" font-weight="600" font-size="9" letter-spacing="3" fill="${b.subColor || b.color}">${esc(b.sub)}</text>` : '';
  const emb = hasE ? `<g transform="translate(${top ? W / 2 : ex},${top ? 22 : 32})">${b.emblem}</g>` : '';
  const border = /^#(f|e)/i.test(b.bg) ? ' stroke="rgba(0,0,0,0.12)" stroke-width="1"' : '';
  return `<svg class="brand" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(lv.name)}"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${b.bg}"${border}/>${emb}${text}${sub}</svg>`;
}

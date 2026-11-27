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
  swissFlag: () => '<rect x="-12" y="-12" width="24" height="24" rx="2" fill="#E2001A"/><rect x="-2.6" y="-8" width="5.2" height="16" fill="#fff"/><rect x="-8" y="-2.6" width="16" height="5.2" fill="#fff"/>',
  fox: () => '<circle r="14" fill="#3f86c9"/><path d="M-12,0 Q-7,4 -2,5 L-1,12 L3,7 L7,11 L7,4 Q9,-3 5,-9 Q-2,-7 -12,0 Z" fill="#E36F1E"/><path d="M-12,0 Q-5,0 -1,-3 Q2,-7 5,-9 Q-2,-7 -12,0 Z" fill="#fff"/><circle cx="-11.5" cy="0" r="1.2" fill="#111"/>',
  pualani: () => '<circle r="15" fill="#413691"/><path d="M-3,9 Q7,11 10,3 Q12,-5 8,-11 L0,-11 Q2,0 -3,9 Z" fill="#2a1b5c"/><path d="M-3,9 Q-4,5 -6,3 L-4,2 L-5,0 L-4,-1 L-4.5,-2 Q-4,-4 -1,-4 L0,-11 L3,-11 Q2,-2 2,3 Q1,7 -3,9 Z" fill="#f3e6ef"/><circle cx="5" cy="5" r="2.6" fill="#fff"/><circle cx="5" cy="5" r="0.9" fill="#CE0C88"/>',
  vista: () => '<path d="M-7,12 V-1 Q-6.5,-9 0,-13 Q6.5,-9 7,-1 V12" fill="none" stroke="#C9A15B" stroke-width="2.4"/><path d="M-3.5,12 V0 Q-3,-5 0,-8 Q3,-5 3.5,0 V12" fill="none" stroke="#C9A15B" stroke-width="1.4"/>',
  dotPlane: (c) => [[-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [0, -1], [0.5, -2], [1, -3], [0, 1], [0.5, 2], [1, 3], [3, -1], [3, 1]].map(([x, y]) => `<circle cx="${x * 3}" cy="${y * 3}" r="1.2" fill="${c}"/>`).join(''),
  feathers: () => ['#DA121A', '#FCDD09', '#078930'].map((c, i) => `<path d="M${-12 + i * 4},${12 - i * 6} Q${2 + i * 3},${8 - i * 6} ${10 + i * 2},${-6 - i * 4} L${12 + i * 2},${-5 - i * 4} Q${4 + i * 3},${12 - i * 6} ${-12 + i * 4},${15 - i * 6} Z" fill="${c}"/>`).join(''),
  horus: () => '<rect x="-14" y="-14" width="28" height="28" rx="4" fill="#0B2F6B"/><path d="M7,11 Q9,-4 3,-9 Q-4,-11 -6,-5 Q-9,-4 -9,-1 Q-7,-1 -6,-1 Q-4,2 -1,3 Q-1,8 -2,11 Z" fill="#C9A23A"/><ellipse cx="-2" cy="-4.5" rx="1.6" ry="1" fill="#0B2F6B"/><path d="M0,-4.5 H5 M-1,-3 Q0,1 0,3" stroke="#0B2F6B" stroke-width="0.9" fill="none"/>',
  latam: () => '<path d="M-13,4 C-4,6 4,9 12,15 C8,6 0,2 -13,4 Z M-9,-6 C0,-4 7,2 12,10 C8,0 0,-4 -9,-6 Z" fill="#E8114B"/>',
  eagleKnight: () => '<path d="M10,-12 Q12,8 1,12 Q-6,13 -9,7 L-13,4 Q-12,1 -9,-1 L-8,1 Q-4,-3 -3,-12 Z" fill="#c9cfd8"/><path d="M-6,6 Q-3,7.5 0,6 Q-3,5 -6,6 Z" fill="#0B2343"/><path d="M1,9 Q3,1 1,-9 M4,9 Q6,1 4,-9 M7,8 Q9,1 7,-9" stroke="#0B2343" stroke-width="1" fill="none"/>',
  iberia: () => '<path d="M-14,-14 H14 V2 Q0,-2 -14,-10 Z" fill="#D7192D"/><path d="M-14,-7 Q0,1 14,5 V8 Q0,4 -14,-4 Z" fill="#F39200"/><path d="M-14,-1 Q0,7 14,11 V13 Q0,10 -14,2 Z" fill="#FFCC00"/>',
  austrian: () => '<rect x="-13" y="-13" width="26" height="26" rx="3" fill="#E30613"/><rect x="-13" y="-4" width="26" height="8" fill="#fff"/><path d="M-9,0 L1,5 L1,2.6 L-4,0 L1,-2.6 L1,-5 Z" fill="#E30613"/>',
  taegeuk: () => '<circle r="14" fill="#fff"/><circle r="12" fill="#C60C30"/><path d="M-12,0 A12,12 0 0,0 12,0 Z" fill="#003478"/><path d="M-12,0 A6,6 0 0,0 0,0 Z" fill="#C60C30"/><path d="M0,0 A6,6 0 0,1 12,0 Z" fill="#003478"/>',
  evaGlobe: () => '<circle r="14" fill="#F08300"/><circle r="12" fill="#fff"/><g stroke="#00563F" stroke-width="1.2" fill="none"><ellipse rx="4.2" ry="12"/><ellipse rx="8.4" ry="12"/><path d="M-12,0 H12 M-10.4,-6 H10.4 M-10.4,6 H10.4"/></g>',
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
  'southwest-canyon': { bg: '#3D5BA9', word: 'SOUTHWEST', color: '#fff', font: F.sans, weight: 800, size: 15, ls: 1, pos: 'none', sub: 'CANYON BLUE', subColor: '#E9A71C' },
  spirit: { bg: '#FFE500', word: 'spirit', color: '#111', font: F.wide, weight: 900, size: 28, pos: 'none' },
  frontier: { bg: '#ffffff', word: 'FRONTIER', color: '#00764C', font: F.wide, weight: 900, size: 14, emblem: E.fox(), pos: 'left' },
  hawaiian: { bg: '#ffffff', word: 'HAWAIIAN', color: '#413691', font: F.sans, weight: 700, size: 13, ls: 2, emblem: E.pualani(), pos: 'left', sub: 'AIRLINES', subColor: '#CE0C88' },
  swiss: { bg: '#ffffff', word: 'SWISS', color: '#1a1a1a', font: F.sans, weight: 800, size: 22, ls: 1, emblem: E.swissFlag(), pos: 'left' },
  airindia: { bg: '#ffffff', word: 'AIR INDIA', color: '#D9152B', font: F.sans, weight: 700, size: 15, ls: 2, emblem: E.vista(), pos: 'left' },
  indigo: { bg: '#1B2A80', word: 'IndiGo', color: '#fff', font: F.sans, weight: 700, size: 21, emblem: E.dotPlane('#fff'), pos: 'left' },
  ethiopian: { bg: '#ffffff', word: 'ethiopian', color: '#078930', font: F.sans, weight: 700, size: 17, emblem: E.feathers(), pos: 'left' },
  egyptair: { bg: '#ffffff', word: 'EGYPTAIR', color: '#0B2F6B', font: F.sans, weight: 800, size: 14, ls: 1, emblem: E.horus(), pos: 'left' },
  latam: { bg: '#1B0088', word: 'LATAM', color: '#fff', font: F.sans, weight: 800, size: 22, ls: 2, emblem: E.latam(), pos: 'left' },
  aeromexico: { bg: '#0B2343', word: 'AEROMEXICO', color: '#fff', font: F.sans, weight: 700, size: 12, ls: 1, emblem: E.eagleKnight(), pos: 'left' },
  westjet: { bg: '#00505A', word: 'WESTJET', color: '#fff', font: F.sans, weight: 800, size: 15, ls: 2, emblem: E.maple('#00A7A5'), pos: 'left' },
  iberia: { bg: '#ffffff', word: 'IBERIA', color: '#D7192D', font: F.sans, weight: 800, size: 20, ls: 2, emblem: E.iberia(), pos: 'left' },
  austrian: { bg: '#ffffff', word: 'Austrian', color: '#E30613', font: F.sans, weight: 700, size: 19, emblem: E.austrian(), pos: 'left' },
  finnair: { bg: '#ffffff', word: 'FINNAIR', color: '#0B1560', font: F.sans, weight: 800, size: 20, ls: 2, pos: 'none' },
  koreanair: { bg: '#8FC9EC', word: 'KOREAN AIR', color: '#0B2265', font: F.sans, weight: 700, size: 12, ls: 1, emblem: E.taegeuk(), pos: 'left' },
  eva: { bg: '#00563F', word: 'EVA AIR', color: '#fff', font: F.sans, weight: 800, size: 17, ls: 2, emblem: E.evaGlobe(), pos: 'left' },
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

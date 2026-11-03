/**
 * Original cartoon presenter: glasses, hoodie, flat colours, 6 px dark brown
 * outlines, cropped at the chest. 650x770 viewBox. Rig parts (all ids
 * prefixed "pr-"): head-sway > head-nod > brows / lids / glasses / mouth
 * (a <use> pointing at one of 10 shapes), and two hands that rise from below.
 */

export const PRESENTER_W = 650;
export const PRESENTER_H = 770;
export const MOUTH_SHAPES = 10;
/** Head pivot (base of the neck) in viewBox units. */
export const HEAD_PIVOT = "325 470";

const LINE = "#3B2A20";
const SKIN = "#EFC39C";
const HOODIE = "#4E7A96";
const HOODIE_DARK = "#3E6680";
const HAIR = "#3B2A20";
const CHEEK = "#E8A38A";
const MOUTH = "#5A2420";
const TONGUE = "#D9665A";

const stroke = `stroke="${LINE}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"`;

function mouthShape(k: number): string {
  if (k === 0) {
    return `<g id="pr-m0"><path d="M-34,0 Q0,12 34,0" fill="none" ${stroke}/></g>`;
  }
  const w = 30 + k * 2.6;
  const h = 4 + k * 5.4;
  const f = (n: number) => n.toFixed(1);
  const outline = `M${f(-w)},0 C${f(-w * 0.5)},${f(-h * 0.3)} ${f(w * 0.5)},${f(-h * 0.3)} ${f(w)},0 C${f(w * 0.72)},${f(h * 1.15)} ${f(-w * 0.72)},${f(h * 1.15)} ${f(-w)},0 Z`;
  const teeth =
    k >= 3
      ? `<path d="M${f(-w * 0.62)},${f(-h * 0.12)} C${f(-w * 0.3)},${f(-h * 0.26)} ${f(w * 0.3)},${f(-h * 0.26)} ${f(w * 0.62)},${f(-h * 0.12)} L${f(w * 0.55)},${f(h * 0.12)} C${f(w * 0.25)},${f(h * 0.02)} ${f(-w * 0.25)},${f(h * 0.02)} ${f(-w * 0.55)},${f(h * 0.12)} Z" fill="#FFFFFF"/>`
      : "";
  const tongue =
    k >= 5
      ? `<ellipse cx="0" cy="${f(h * 0.6)}" rx="${f(w * 0.42)}" ry="${f(h * 0.2)}" fill="${TONGUE}"/>`
      : "";
  return `<g id="pr-m${k}"><path d="${outline}" fill="${MOUTH}"/>${teeth}${tongue}<path d="${outline}" fill="none" ${stroke}/></g>`;
}

export function presenterSvg(): string {
  const mouths = Array.from({ length: MOUTH_SHAPES }, (_, k) => mouthShape(k)).join("");
  return `<svg viewBox="0 0 ${PRESENTER_W} ${PRESENTER_H}" width="${PRESENTER_W}" height="${PRESENTER_H}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
  <defs>${mouths}</defs>
  <g id="pr-body">
    <path d="M30,800 C30,610 115,505 235,482 L415,482 C535,505 620,610 620,800 Z" fill="${HOODIE}" ${stroke}/>
    <path d="M150,800 C160,700 175,640 200,600" fill="none" ${stroke}/>
    <path d="M500,800 C490,700 475,640 450,600" fill="none" ${stroke}/>
    <path d="M205,486 C215,575 435,575 445,486 C400,520 250,520 205,486 Z" fill="${HOODIE_DARK}" ${stroke}/>
    <path d="M285,540 L278,640" fill="none" ${stroke}/>
    <path d="M365,540 L372,640" fill="none" ${stroke}/>
    <rect x="270" y="636" width="16" height="26" rx="6" fill="#F4F1EA" ${stroke}/>
    <rect x="364" y="636" width="16" height="26" rx="6" fill="#F4F1EA" ${stroke}/>
  </g>
  <g id="pr-head-sway">
    <g id="pr-head-nod">
      <path d="M288,392 L288,500 C305,515 345,515 362,500 L362,392 Z" fill="${SKIN}" ${stroke}/>
      <circle cx="168" cy="272" r="32" fill="${SKIN}" ${stroke}/>
      <circle cx="482" cy="272" r="32" fill="${SKIN}" ${stroke}/>
      <ellipse cx="325" cy="262" rx="158" ry="178" fill="${SKIN}" ${stroke}/>
      <path d="M166,250 C142,112 248,48 340,56 C446,62 512,132 486,250 C472,196 446,170 404,162 C364,190 290,186 252,164 C214,178 186,206 166,250 Z" fill="${HAIR}" ${stroke}/>
      <ellipse cx="228" cy="330" rx="24" ry="13" fill="${CHEEK}"/>
      <ellipse cx="422" cy="330" rx="24" ry="13" fill="${CHEEK}"/>
      <g id="pr-eyes">
        <ellipse cx="262" cy="264" rx="25" ry="24" fill="#FFFFFF" ${stroke}/>
        <ellipse cx="388" cy="264" rx="25" ry="24" fill="#FFFFFF" ${stroke}/>
        <circle cx="266" cy="268" r="11" fill="#1E1C1A"/>
        <circle cx="384" cy="268" r="11" fill="#1E1C1A"/>
      </g>
      <g id="pr-lid-half">
        <path d="M237,264 C237,236 287,236 287,264 Z" fill="${SKIN}" ${stroke}/>
        <path d="M363,264 C363,236 413,236 413,264 Z" fill="${SKIN}" ${stroke}/>
      </g>
      <g id="pr-lid-full">
        <ellipse cx="262" cy="264" rx="25" ry="24" fill="${SKIN}" ${stroke}/>
        <ellipse cx="388" cy="264" rx="25" ry="24" fill="${SKIN}" ${stroke}/>
        <path d="M240,270 C252,278 272,278 284,270" fill="none" ${stroke}/>
        <path d="M366,270 C378,278 398,278 410,270" fill="none" ${stroke}/>
      </g>
      <g id="pr-glasses">
        <rect x="210" y="218" width="104" height="92" rx="30" fill="#FFFFFF" fill-opacity="0.14" stroke="#1E1C1A" stroke-width="8"/>
        <rect x="336" y="218" width="104" height="92" rx="30" fill="#FFFFFF" fill-opacity="0.14" stroke="#1E1C1A" stroke-width="8"/>
        <path d="M314,252 C320,242 330,242 336,252" fill="none" stroke="#1E1C1A" stroke-width="8" stroke-linecap="round"/>
        <path d="M210,246 L176,240" fill="none" stroke="#1E1C1A" stroke-width="8" stroke-linecap="round"/>
        <path d="M440,246 L474,240" fill="none" stroke="#1E1C1A" stroke-width="8" stroke-linecap="round"/>
      </g>
      <g id="pr-brows">
        <path id="pr-brow-l" d="M226,196 C246,184 274,184 294,192" fill="none" stroke="${HAIR}" stroke-width="13" stroke-linecap="round"/>
        <path id="pr-brow-r" d="M356,192 C376,184 404,184 424,196" fill="none" stroke="${HAIR}" stroke-width="13" stroke-linecap="round"/>
      </g>
      <path d="M322,284 C312,312 314,322 332,322" fill="none" ${stroke}/>
      <use id="pr-mouth" href="#pr-m0" x="325" y="366"/>
    </g>
  </g>
  <g id="pr-hand-point" transform="translate(0,440)">
    <path d="M70,800 L84,640 L196,640 L206,800 Z" fill="${HOODIE}" ${stroke}/>
    <path d="M78,636 L204,636 L200,604 L82,604 Z" fill="${HOODIE_DARK}" ${stroke}/>
    <path d="M92,604 C80,560 88,520 118,512 L118,420 C118,396 150,396 150,420 L150,512 C186,510 204,536 196,604 Z" fill="${SKIN}" ${stroke}/>
    <path d="M150,520 C162,516 176,520 180,530" fill="none" ${stroke}/>
  </g>
  <g id="pr-hand-palm" transform="translate(0,440)">
    <path d="M446,800 L456,640 L566,640 L580,800 Z" fill="${HOODIE}" ${stroke}/>
    <path d="M452,636 L572,636 L568,604 L456,604 Z" fill="${HOODIE_DARK}" ${stroke}/>
    <path d="M462,604 C450,560 452,520 464,496 L460,440 C458,420 484,418 486,440 L490,480 L494,420 C494,398 522,398 522,420 L522,478 L530,428 C532,408 558,410 556,432 L550,490 L562,462 C568,444 592,452 586,472 L566,540 C558,574 556,590 562,604 Z" fill="${SKIN}" ${stroke}/>
  </g>
</svg>`;
}

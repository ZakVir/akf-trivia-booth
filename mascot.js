/* "Screen buddy" mascot: a dark rounded-square screen with a glowing ice-blue face.
   Drawn in SVG, no image files. Moods: idle, look, think, happy, cool, oops, fact. */
const Mascot = (() => {
  const FACE = '#D6F1FF';
  const star = (cx, cy, r) =>
    `<path d="M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z" fill="${FACE}"/>`;
  const eyes = (dx = 0, dy = 0, extra = '') =>
    `<g class="${extra}"><g style="transform:translate(${dx}px,${dy}px)"><g class="blink"><ellipse cx="68" cy="88" rx="11" ry="17"/><ellipse cx="132" cy="88" rx="11" ry="17"/></g></g></g>`;
  const smile = `<path d="M82 130 Q100 146 118 130" fill="none" stroke="${FACE}" stroke-width="7" stroke-linecap="round"/>`;

  const faces = {
    idle: () => eyes() + smile,
    look: () => eyes(16, -8) + `<path d="M86 134 Q100 141 114 134" fill="none" stroke="${FACE}" stroke-width="7" stroke-linecap="round"/>`,
    think: () => eyes(0, 0, 'sway') + `<path d="M88 136 H112" stroke="${FACE}" stroke-width="7" stroke-linecap="round"/>`,
    happy: () =>
      `<path d="M52 74 L82 90 L52 106 M148 74 L118 90 L148 106" fill="none" stroke="${FACE}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M70 120 Q100 168 130 120 Z" fill="${FACE}"/>` + star(30, 40, 12) + star(172, 52, 9) + star(168, 156, 10),
    cool: () =>
      `<g fill="${FACE}"><rect x="40" y="70" width="52" height="30" rx="6"/><rect x="108" y="70" width="52" height="30" rx="6"/><rect x="90" y="76" width="20" height="8"/></g>` +
      `<g fill="#1E2433"><rect x="48" y="76" width="16" height="6"/><rect x="116" y="76" width="16" height="6"/></g>` + smile + star(172, 44, 11),
    oops: () =>
      eyes() +
      `<path d="M74 134 Q86 122 98 134 T122 134" fill="none" stroke="${FACE}" stroke-width="7" stroke-linecap="round"/>` +
      `<ellipse cx="114" cy="146" rx="9" ry="11" fill="#FF9DB0"/>`,
    fact: () =>
      star(68, 88, 20) + star(132, 88, 20) +
      `<ellipse cx="44" cy="120" rx="13" ry="7" fill="#FF9DB0" opacity=".8"/><ellipse cx="156" cy="120" rx="13" ry="7" fill="#FF9DB0" opacity=".8"/>` +
      `<path d="M88 126 Q100 150 112 126 Z" fill="${FACE}"/>`
  };

  function render(el, mood) {
    if (el.dataset.mood === mood) return;
    el.dataset.mood = mood;
    el.innerHTML =
      `<svg viewBox="0 0 200 200" class="mascot-svg mood-${mood}" aria-hidden="true">` +
      `<rect x="6" y="6" width="188" height="188" rx="48" fill="#1E2433" stroke="#3A4560" stroke-width="4"/>` +
      `<g class="face" fill="${FACE}">${(faces[mood] || faces.idle)()}</g></svg>`;
  }
  return { render };
})();

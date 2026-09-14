// 18px line icons, copied from the approved prototype (output/secaudit-workbench.html:291).
// Path data only: the SVG element is built with createElementNS in app.js so no markup string
// is ever assigned into the DOM. The prototype's chevrons are the '‹' character, in the markup.
export const ICONS = {
  board: { viewBox: '0 0 24 24', shapes: [
    { tag: 'rect', attrs: { x: '3', y: '3', width: '18', height: '18', rx: '2' } },
    { tag: 'path', attrs: { d: 'M9 3v18M15 3v18' } },
  ] },
  runs: { viewBox: '0 0 24 24', shapes: [
    { tag: 'path', attrs: { d: 'M3 11a9 9 0 1 1 2.7 7.1M3 4v7h7M12 7v5l3 2' } },
  ] },
  falsepositives: { viewBox: '0 0 24 24', shapes: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } },
    { tag: 'path', attrs: { d: 'm6 6 12 12' } },
  ] },
}

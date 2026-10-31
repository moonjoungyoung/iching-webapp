// 효 직접 고르기: 손으로 동전을 던졌거나 이미 얻은 괘가 있는 사람이 여섯 효를 고른다.
// 각 줄은 老陰(6)·少陽(7)·少陰(8)·老陽(9) 라디오 그룹이고, 고르는 동안 괘 그림과 본괘·지괘 이름을 바로 보여 준다.
import { getHexagramNumber, getHexagramData } from './hexagrams.js';
import { syncInert } from './ui.js';

const $ = (sel) => document.querySelector(sel);
const YAO = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
const YAO_KO = ['초효', '이효', '삼효', '사효', '오효', '상효'];
// 값, 이름, 동전 조합(앞면 陽=3, 뒷면 陰=2), 읽는 이름
const OPTIONS = [
  { v: 6, name: '老陰', coins: '陰陰陰', ko: '노음, 6, 동전 셋 다 뒷면' },
  { v: 7, name: '少陽', coins: '陽陰陰', ko: '소양, 7, 앞면 하나' },
  { v: 8, name: '少陰', coins: '陽陽陰', ko: '소음, 8, 앞면 둘' },
  { v: 9, name: '老陽', coins: '陽陽陽', ko: '노양, 9, 동전 셋 다 앞면' },
];

const els = {
  panel: $('#manual-panel'),
  card: $('#manual-panel .manual-card'),
  rows: $('#manual-rows'),
  fig: $('#manual-fig'),
  names: $('#manual-names'),
  submit: $('#manual-submit'),
  clear: $('#manual-clear'),
  close: $('#manual-close'),
  backdrop: $('#manual-panel .manual-backdrop'),
};

const values = [null, null, null, null, null, null];
let returnFocus = null;
let onSubmit = () => {};

const lineOf = (v) => ({ value: v, yang: v === 7 || v === 9, changing: v === 6 || v === 9 });

function buildRows() {
  els.rows.innerHTML = '';
  // 위(上爻)가 화면 위에 오도록 역순으로 그리되, 탭 순서는 初爻부터(괘는 아래에서 위로 세운다)
  YAO.forEach((yao, i) => {
    const fs = document.createElement('fieldset');
    fs.className = 'mrow';
    fs.style.order = String(5 - i);
    const lg = document.createElement('legend');
    lg.className = 'mrow-name';
    const h = document.createElement('span');
    h.className = 'hanja';
    h.setAttribute('aria-hidden', 'true');
    h.textContent = yao;
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = YAO_KO[i];
    lg.append(h, sr);
    fs.appendChild(lg);
    const opts = document.createElement('div');
    opts.className = 'mrow-opts';
    opts.setAttribute('role', 'radiogroup');
    opts.setAttribute('aria-label', `${YAO_KO[i]} 고르기`);
    OPTIONS.forEach((o) => {
      const label = document.createElement('label');
      label.className = 'mopt';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `yao${i}`;
      input.value = String(o.v);
      input.setAttribute('aria-label', o.ko);
      input.addEventListener('change', () => { values[i] = o.v; render(); });
      const face = document.createElement('span');
      face.className = 'mopt-face';
      face.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('i');
      const line = lineOf(o.v);
      bar.className = `mbar ${line.yang ? 'yang' : 'yin'}${line.changing ? ' changing' : ''}`;
      bar.innerHTML = line.yang ? '<b></b>' : '<b></b><b></b>';
      const nm = document.createElement('span');
      nm.className = 'mopt-name hanja';
      nm.textContent = o.name;
      const cn = document.createElement('span');
      cn.className = 'mopt-coins hanja';
      cn.textContent = o.coins;
      face.append(bar, nm, cn);
      label.append(input, face);
      opts.appendChild(label);
    });
    fs.appendChild(opts);
    els.rows.appendChild(fs);
  });
}

function render() {
  // 라디오 상태를 값에 맞춘다
  values.forEach((v, i) => {
    els.rows.querySelectorAll(`input[name="yao${i}"]`).forEach((inp) => { inp.checked = Number(inp.value) === v; });
  });
  // 괘 그림(아래에서 위로)
  els.fig.innerHTML = '';
  values.forEach((v) => {
    const div = document.createElement('div');
    if (v === null) {
      div.className = 'hex-line empty';
    } else {
      const l = lineOf(v);
      div.className = `hex-line ${l.yang ? 'yang' : 'yin'}${l.changing ? ' changing' : ''}`;
      div.innerHTML = l.yang ? '<span class="segment"></span>' : '<span class="segment"></span><span class="segment"></span>';
    }
    els.fig.appendChild(div);
  });
  const left = values.filter((v) => v === null).length;
  els.submit.disabled = left > 0;
  if (left > 0) {
    els.names.textContent = `${left}효를 더 고르면 괘가 섭니다.`;
    return;
  }
  const lines = values.map(lineOf);
  const p = getHexagramData(getHexagramNumber(lines.map((l) => (l.yang ? 1 : 0))));
  let text = `本卦 ${p.hanja} ${p.fullName}`;
  if (lines.some((l) => l.changing)) {
    const c = getHexagramData(getHexagramNumber(lines.map((l) => ((l.changing ? !l.yang : l.yang) ? 1 : 0))));
    text += ` 之 ${c.hanja} ${c.fullName}`;
  } else {
    text += ' · 변효 없음';
  }
  els.names.textContent = text;
}

function trapTab(e) {
  const f = [...els.card.querySelectorAll('button, input[type="radio"]')]
    .filter((el) => !el.disabled && el.getClientRects().length)
    // 라디오는 그룹마다 선택된 것(없으면 첫 번째)만 탭 대상
    .filter((el) => el.type !== 'radio' || el.checked
      || !els.card.querySelector(`input[name="${el.name}"]:checked`) && el === els.card.querySelector(`input[name="${el.name}"]`));
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function isManualOpen() { return !els.panel.hidden; }

/**
 * @param {{ value:number }[]} prefill 이미 던진 효(아래부터)
 */
export function openManual(prefill = []) {
  for (let i = 0; i < 6; i++) values[i] = prefill[i] ? prefill[i].value : null;
  returnFocus = document.activeElement;
  render();
  els.panel.hidden = false;
  syncInert();
  const firstEmpty = values.findIndex((v) => v === null);
  const target = firstEmpty >= 0
    ? els.rows.querySelector(`input[name="yao${firstEmpty}"]`)
    : els.submit;
  requestAnimationFrame(() => target.focus({ preventScroll: true }));
}

export function closeManual(restoreFocus = true) {
  if (els.panel.hidden) return;
  els.panel.hidden = true;
  syncInert();
  if (restoreFocus && returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
}

/** @param {{ onSubmit: (lines: {value:number, yang:boolean, changing:boolean}[]) => void }} h */
export function initManual(h) {
  onSubmit = h.onSubmit;
  buildRows();
  els.close.addEventListener('click', () => closeManual());
  els.backdrop.addEventListener('click', () => closeManual());
  els.clear.addEventListener('click', () => {
    values.fill(null);
    render();
    els.rows.querySelector('input[name="yao0"]').focus();
  });
  els.submit.addEventListener('click', () => {
    if (values.some((v) => v === null)) return;
    const lines = values.map(lineOf);
    closeManual(false);
    onSubmit(lines);
  });
  window.addEventListener('keydown', (e) => {
    if (els.panel.hidden || !document.getElementById('info-panel').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeManual(); } else if (e.key === 'Tab') trapTab(e);
  });
}

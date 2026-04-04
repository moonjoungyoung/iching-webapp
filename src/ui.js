const $ = (sel) => document.querySelector(sel);

const els = {
  throwBtn: $('#throw-btn'),
  viewResultBtn: $('#view-result-btn'),
  currentThrow: $('#current-throw'),
  hexLines: $('#hexagram-lines'),
  coinDisplay: $('#coin-result-display'),
  resultModal: $('#result-modal'),
  modalCloseBtn: $('#modal-close-btn'),
  resultHexVisual: $('#result-hex-visual'),
  resultName: $('#result-name'),
  resultFullName: $('#result-full-name'),
  resultKeyword: $('#result-keyword'),
  resultJudgment: $('#result-judgment'),
  resultImage: $('#result-image'),
  resultChanging: $('#result-changing'),
  changedHexVisual: $('#changed-hex-visual'),
  changedName: $('#changed-name'),
  changedFullName: $('#changed-full-name'),
  changedKeyword: $('#changed-keyword'),
  changedJudgment: $('#changed-judgment'),
  changedImage: $('#changed-image'),
  newReadingBtn: $('#new-reading-btn'),
  shareBtn: $('#share-btn'),
  loadingScreen: $('#loading-screen'),
};

// 마지막 결과 저장 (다시 보기용)
let lastResult = null;

export function setButtonEnabled(enabled) {
  els.throwBtn.disabled = !enabled;
}

export function updateThrowCounter(count) {
  els.currentThrow.textContent = count;
}

function createLineElement(yang) {
  const div = document.createElement('div');
  div.className = `hex-line ${yang ? 'yang' : 'yin'}`;
  if (yang) {
    div.innerHTML = '<div class="segment"></div>';
  } else {
    div.innerHTML = '<div class="segment"></div><div class="gap"></div><div class="segment"></div>';
  }
  return div;
}

export function addHexagramLine(yang, changing) {
  els.hexLines.appendChild(createLineElement(yang));
}

export function clearHexagramLines() {
  els.hexLines.innerHTML = '';
}

export function showCoinResult(coinResults, lineValue, yang, changing) {
  const faces = coinResults.map(r => r ? '陽' : '陰').join(' · ');
  const label = lineValue === 6 ? '老陰' : lineValue === 7 ? '少陽' : lineValue === 8 ? '少陰' : '老陽';
  els.coinDisplay.innerHTML = `<span class="coin-text">${faces} — ${label}</span>`;
  els.coinDisplay.style.animation = 'none';
  els.coinDisplay.offsetHeight;
  els.coinDisplay.style.animation = '';
}

export function clearCoinResult() {
  els.coinDisplay.innerHTML = '';
}

/**
 * 결과 모달 표시
 */
export function showResult(primary, changed, lines) {
  // 저장 (다시 보기용)
  lastResult = { primary, changed, lines };

  // 본괘
  els.resultHexVisual.innerHTML = '';
  lines.forEach(l => {
    els.resultHexVisual.appendChild(createLineElement(l.yang));
  });

  els.resultName.innerHTML = `<span class="hanja">${primary.hanja}</span> ${primary.name}`;
  els.resultFullName.textContent = primary.fullName;
  els.resultKeyword.textContent = primary.keyword;
  els.resultJudgment.textContent = primary.judgment;
  els.resultImage.textContent = primary.image;

  // 변괘
  if (changed) {
    els.resultChanging.classList.remove('hidden');
    els.changedHexVisual.innerHTML = '';
    lines.forEach(l => {
      const flippedYang = l.changing ? !l.yang : l.yang;
      els.changedHexVisual.appendChild(createLineElement(flippedYang));
    });
    els.changedName.innerHTML = `<span class="hanja">${changed.hanja}</span> ${changed.name}`;
    els.changedFullName.textContent = changed.fullName;
    els.changedKeyword.textContent = changed.keyword;
    els.changedJudgment.textContent = changed.judgment;
    els.changedImage.textContent = changed.image;
  } else {
    els.resultChanging.classList.add('hidden');
  }

  els.resultModal.classList.remove('hidden');

  // 뒤로가기로 닫을 수 있도록 히스토리 푸시
  history.pushState({ modal: true }, '');

  // 던지기 버튼 숨기고 결과 보기 버튼 표시
  els.throwBtn.classList.add('hidden');
  els.viewResultBtn.classList.remove('hidden');
}

export function hideResult() {
  els.resultModal.classList.add('hidden');
}

/**
 * 결과 다시 보기
 */
function viewLastResult() {
  if (lastResult) {
    showResult(lastResult.primary, lastResult.changed, lastResult.lines);
  }
}

/**
 * 새로 점치기 — 상태 완전 리셋
 */
function doNewReading(onNewReading) {
  hideResult();
  lastResult = null;
  els.throwBtn.classList.remove('hidden');
  els.viewResultBtn.classList.add('hidden');
  onNewReading();
}

/**
 * 결과 공유하기 (Web Share API 또는 URL 복사)
 */
async function shareResult() {
  if (!lastResult) return;
  const { primary, changed } = lastResult;
  const base = location.origin;
  let url = `${base}/?hex=${primary.number}`;
  if (changed) url += `&changed=${changed.number}`;

  const text = changed
    ? `${primary.hanja} ${primary.name} (${primary.keyword}) → ${changed.hanja} ${changed.name} (${changed.keyword})`
    : `${primary.hanja} ${primary.name} — ${primary.keyword}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: '주역 점괘', text, url });
    } catch (e) { /* 사용자 취소 */ }
  } else {
    await navigator.clipboard.writeText(url);
    els.shareBtn.textContent = '복사됨!';
    setTimeout(() => { els.shareBtn.textContent = '공유하기'; }, 1500);
  }
}

/**
 * 로딩 화면 숨기기
 */
export function hideLoading() {
  els.loadingScreen.classList.add('done');
  setTimeout(() => els.loadingScreen.remove(), 700);
}

/**
 * 이벤트 바인딩
 */
export function bindEvents({ onThrow, onNewReading }) {
  els.throwBtn.addEventListener('click', onThrow);
  els.viewResultBtn.addEventListener('click', viewLastResult);
  els.newReadingBtn.addEventListener('click', () => doNewReading(onNewReading));
  els.shareBtn.addEventListener('click', shareResult);
  els.modalCloseBtn.addEventListener('click', hideResult);
  els.resultModal.querySelector('.modal-backdrop').addEventListener('click', hideResult);

  // 브라우저 뒤로가기 → 모달 닫기
  window.addEventListener('popstate', (e) => {
    if (!els.resultModal.classList.contains('hidden')) {
      hideResult();
    }
  });
}

import { ASK_ENDPOINT } from './config.js';

const $ = (sel) => document.querySelector(sel);

// 엔드포인트가 실제로 설정된 경우에만 질문하기 활성화
const ASK_ENABLED = !!ASK_ENDPOINT && !ASK_ENDPOINT.startsWith('__');

const ASK_EXAMPLES = [
  '이 점괘가 지금 제 고민에 대해 무엇을 말하나요?',
  '지금 무엇을 조심해야 할까요?',
  '변효가 가리키는 변화는 어떤 의미인가요?',
  '한 문장으로 요약해 주세요.',
];

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
  resultJudge: $('#result-judge'),
  judgeRule: $('#judge-rule'),
  judgeDesc: $('#judge-desc'),
  judgeTexts: $('#judge-texts'),
  newReadingBtn: $('#new-reading-btn'),
  shareBtn: $('#share-btn'),
  loadingScreen: $('#loading-screen'),
  infoBtn: $('#info-btn'),
  infoPanel: $('#info-panel'),
  infoCloseBtn: $('#info-close-btn'),
  resultAsk: $('#result-ask'),
  askThread: $('#ask-thread'),
  askExamples: $('#ask-examples'),
  askInput: $('#ask-input'),
  askSendBtn: $('#ask-send-btn'),
};

// 현재 점괘에 대한 대화 맥락(멀티턴)
let askHistory = [];

// 마지막 결과 저장 (다시 보기용)
let lastResult = null;

export function setButtonEnabled(enabled) {
  els.throwBtn.disabled = !enabled;
}

export function updateThrowCounter(count) {
  els.currentThrow.textContent = count;
}

function createLineElement(yang, changing = false, value = 0) {
  const div = document.createElement('div');
  div.className = `hex-line ${yang ? 'yang' : 'yin'}${changing ? ' changing' : ''}`;
  const segs = yang
    ? '<div class="segment"></div>'
    : '<div class="segment"></div><div class="gap"></div><div class="segment"></div>';
  // 변효 표시: 老陽(9) / 老陰(6) — 금색 줄 + 한자 라벨
  const marker = changing
    ? `<span class="change-marker">${value === 9 ? '老陽' : '老陰'}</span>`
    : '';
  div.innerHTML = segs + marker;
  return div;
}

export function addHexagramLine(yang, changing, value) {
  els.hexLines.appendChild(createLineElement(yang, changing, value));
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
export function showResult(primary, changed, lines, interpretation = null) {
  // 저장 (다시 보기용)
  lastResult = { primary, changed, lines, interpretation };

  // 본괘 (변효는 ○/× 마커로 표시)
  els.resultHexVisual.innerHTML = '';
  lines.forEach(l => {
    els.resultHexVisual.appendChild(createLineElement(l.yang, l.changing, l.value));
  });

  els.resultName.innerHTML = `${primary.name} (<span class="hanja">${primary.hanja}</span>)`;
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
    els.changedName.innerHTML = `${changed.name} (<span class="hanja">${changed.hanja}</span>)`;
    els.changedFullName.textContent = changed.fullName;
    els.changedKeyword.textContent = changed.keyword;
    els.changedJudgment.textContent = changed.judgment;
    els.changedImage.textContent = changed.image;
  } else {
    els.resultChanging.classList.add('hidden');
  }

  // 점단(占斷) — 변효 개수에 따른 풀이
  renderInterpretation(interpretation);

  // 결과 질문하기
  resetAsk();

  els.resultModal.classList.remove('hidden');

  // 뒤로가기로 닫을 수 있도록 히스토리 푸시
  history.pushState({ modal: true }, '');

  // 던지기 버튼 숨기고 결과 보기 버튼 표시
  els.throwBtn.classList.add('hidden');
  els.viewResultBtn.classList.remove('hidden');
}

/**
 * 점단(占斷) 풀이 렌더링
 */
function renderInterpretation(interp) {
  if (!interp) {
    els.resultJudge.classList.add('hidden');
    return;
  }
  els.resultJudge.classList.remove('hidden');
  els.judgeRule.textContent = interp.rule;
  els.judgeDesc.textContent = interp.ruleDesc;

  els.judgeTexts.innerHTML = '';
  interp.texts.forEach(t => {
    const div = document.createElement('div');
    div.className = `judge-yao${t.isPrimary ? ' primary' : ''}`;
    const main = t.isPrimary ? '<span class="yao-main">主</span>' : '';
    div.innerHTML =
      `<div class="yao-head">` +
        `<span class="yao-pos">${t.position}</span>` +
        `<span class="yao-src">${t.source}</span>` +
        main +
      `</div>` +
      `<p class="yao-text">${t.text}</p>`;
    els.judgeTexts.appendChild(div);
  });
}

/**
 * 결과 질문하기 영역 초기화
 */
function resetAsk() {
  if (!ASK_ENABLED) {
    els.resultAsk.classList.add('hidden');
    return;
  }
  els.resultAsk.classList.remove('hidden');
  els.askThread.innerHTML = '';
  els.askInput.value = '';
  els.askSendBtn.disabled = false;
  askHistory = [];

  // 예시 질문 칩 (매번 새로 구성 — 물어본 칩은 제거되므로)
  els.askExamples.innerHTML = '';
  ASK_EXAMPLES.forEach((q) => {
    const chip = document.createElement('button');
    chip.className = 'ask-chip';
    chip.type = 'button';
    chip.dataset.q = q;
    chip.textContent = q;
    chip.addEventListener('click', () => {
      els.askInput.value = q;
      els.askInput.focus();
    });
    els.askExamples.appendChild(chip);
  });
}

// 대화 말풍선 추가. role: 'user' | 'bot'. 반환된 노드의 .textContent를 갱신할 수 있다.
function appendTurn(role, text, extraClass = '') {
  const turn = document.createElement('div');
  turn.className = `ask-turn ${role}${extraClass ? ' ' + extraClass : ''}`;
  const p = document.createElement('p');
  p.textContent = text;
  turn.appendChild(p);
  els.askThread.appendChild(turn);
  els.askThread.scrollTop = els.askThread.scrollHeight;
  return p;
}

/**
 * 질문 전송 → 백엔드 프록시 → 답변 표시
 */
async function askSend() {
  if (!ASK_ENABLED || !lastResult) return;
  const question = els.askInput.value.trim();
  if (!question) {
    els.askInput.focus();
    return;
  }

  // 질문 말풍선 추가 + 입력/해당 예시 칩 비우기
  appendTurn('user', question);
  els.askInput.value = '';
  const chip = els.askExamples.querySelector(`.ask-chip[data-q="${CSS.escape(question)}"]`);
  if (chip) chip.remove();

  els.askSendBtn.disabled = true;
  const botP = appendTurn('bot', '점괘를 읽는 중…', 'loading');

  const { primary, changed, interpretation } = lastResult;
  const payload = {
    question,
    history: askHistory,
    hexagram: {
      primary: primary && {
        number: primary.number, name: primary.name, hanja: primary.hanja,
        fullName: primary.fullName, keyword: primary.keyword,
        judgment: primary.judgment, image: primary.image,
      },
      changed: changed && {
        number: changed.number, name: changed.name, hanja: changed.hanja,
        fullName: changed.fullName, keyword: changed.keyword,
        judgment: changed.judgment, image: changed.image,
      },
      interpretation: interpretation && {
        count: interpretation.count, rule: interpretation.rule,
        ruleDesc: interpretation.ruleDesc,
        texts: (interpretation.texts || []).map((t) => ({
          position: t.position, text: t.text, source: t.source, isPrimary: !!t.isPrimary,
        })),
      },
    },
  };

  try {
    const r = await fetch(ASK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    botP.parentElement.classList.remove('loading');
    if (!r.ok) {
      botP.parentElement.classList.add('error');
      botP.textContent = data.error || '풀이를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    } else {
      const answer = data.answer || '빈 응답을 받았습니다.';
      botP.textContent = answer;
      // 다음 질문에 맥락으로 전달
      askHistory.push({ role: 'user', content: question });
      askHistory.push({ role: 'assistant', content: answer });
    }
  } catch (e) {
    botP.parentElement.classList.remove('loading');
    botP.parentElement.classList.add('error');
    botP.textContent = '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    els.askSendBtn.disabled = false;
    els.askThread.scrollTop = els.askThread.scrollHeight;
  }
}

export function hideResult() {
  els.resultModal.classList.add('hidden');
  els.infoPanel.classList.add('hidden');
}

/**
 * 결과 다시 보기
 */
function viewLastResult() {
  if (lastResult) {
    showResult(lastResult.primary, lastResult.changed, lastResult.lines, lastResult.interpretation);
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

  // 점괘 보는 법 (info) 토글
  const openInfo = () => els.infoPanel.classList.remove('hidden');
  const closeInfo = () => els.infoPanel.classList.add('hidden');
  els.infoBtn.addEventListener('click', openInfo);
  els.infoCloseBtn.addEventListener('click', closeInfo);
  els.infoPanel.querySelector('.info-backdrop').addEventListener('click', closeInfo);

  // 결과 질문하기
  if (ASK_ENABLED) {
    els.askSendBtn.addEventListener('click', askSend);
    els.askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        askSend();
      }
    });
  }

  // 브라우저 뒤로가기 → 모달 닫기
  window.addEventListener('popstate', (e) => {
    if (!els.resultModal.classList.contains('hidden')) {
      hideResult();
    }
  });
}

// 占斷 — 변효(變爻) 개수에 따른 점단 규칙 (朱熹 『周易本義』 방식)
//
//   0효 변: 본괘 괘사로 본다.
//   1효 변: 본괘의 변효 효사로 본다.
//   2효 변: 본괘 두 변효의 효사로 보되, 위 효(上爻)를 위주로 한다.
//   3효 변: 본괘와 지괘의 괘사로 보되, 본괘를 위주로 한다.
//   4효 변: 지괘 두 불변효의 효사로 보되, 아래 효(下爻)를 위주로 한다.
//   5효 변: 지괘 한 불변효의 효사로 본다.
//   6효 변: 건괘는 用九, 곤괘는 用六, 그 외는 지괘 괘사로 본다.

import { getHexagramData } from './hexagrams.js';
import { YAOCI, USE_TEXT } from './yaoci.js';

const NUM = ['이', '삼', '사', '오']; // 2~5효의 자리 이름

/**
 * 효의 자리 이름을 만든다. (i: 0=초효 ~ 5=상효, yang: 본괘에서의 음양)
 * 초효=초구/초육, 상효=상구/상육, 2~5효=구이/육삼…
 */
export function linePosition(i, yang) {
  const yy = yang ? '구' : '육';
  if (i === 0) return '초' + yy;
  if (i === 5) return '상' + yy;
  return yy + NUM[i - 1];
}

/**
 * 본괘·지괘·6효 정보를 받아 점단(어떤 글로 판단하는지)을 계산한다.
 * @param {number} primaryNum 본괘 번호
 * @param {number|null} changedNum 지괘 번호 (변효 없으면 null)
 * @param {{yang:boolean, changing:boolean, value:number}[]} lines 아래→위 6효
 */
export function interpret(primaryNum, changedNum, lines) {
  const changingIdx = lines
    .map((l, i) => (l.changing ? i : -1))
    .filter((i) => i >= 0);
  const count = changingIdx.length;
  const primary = getHexagramData(primaryNum);
  const changed = changedNum ? getHexagramData(changedNum) : null;

  // 본괘 효사 한 줄
  const benYao = (i, isPrimary = false) => ({
    position: linePosition(i, lines[i].yang),
    text: YAOCI[primaryNum][i],
    source: '본괘',
    lineIndex: i,
    isPrimary,
  });
  // 지괘 효사 한 줄 (불변효 — 음양이 본괘와 같으므로 자리 이름도 동일)
  const zhiYao = (i, isPrimary = false) => ({
    position: linePosition(i, lines[i].yang),
    text: YAOCI[changedNum][i],
    source: '지괘',
    lineIndex: i,
    isPrimary,
  });
  const guaText = (label, text, source, isPrimary = false) => ({
    position: label,
    text,
    source,
    isGua: true,
    isPrimary,
  });

  let rule, ruleDesc, texts;

  if (count === 0) {
    rule = '본괘 괘사로 판단';
    ruleDesc = '변효가 없으니 본괘의 괘사로 점을 판단합니다.';
    texts = [guaText('괘사', primary.judgment, '본괘')];
  } else if (count === 1) {
    rule = '본괘 변효의 효사로 판단';
    ruleDesc = '변효가 하나이니, 본괘에서 변하는 그 효의 효사로 판단합니다.';
    texts = [benYao(changingIdx[0], true)];
  } else if (count === 2) {
    rule = '본괘 두 변효의 효사 (위 효 위주)';
    ruleDesc = '변효가 둘이니, 본괘 두 변효의 효사로 판단하되 위에 있는 효를 위주로 합니다.';
    const [lower, upper] = changingIdx; // upper가 위 효
    texts = [benYao(upper, true), benYao(lower)];
  } else if (count === 3) {
    rule = '본괘·지괘의 괘사 (본괘 위주)';
    ruleDesc = '변효가 셋이니, 본괘와 지괘의 괘사로 판단하되 본괘를 위주로 합니다.';
    texts = [
      guaText('본괘 괘사', primary.judgment, '본괘', true),
      guaText('지괘 괘사', changed.judgment, '지괘'),
    ];
  } else if (count === 4) {
    rule = '지괘 두 불변효의 효사 (아래 효 위주)';
    ruleDesc = '변효가 넷이니, 지괘에서 변하지 않은 두 효의 효사로 판단하되 아래에 있는 효를 위주로 합니다.';
    const stable = [0, 1, 2, 3, 4, 5].filter((i) => !lines[i].changing); // 2개
    const [lower, upper] = stable; // lower가 아래 효
    texts = [zhiYao(lower, true), zhiYao(upper)];
  } else if (count === 5) {
    rule = '지괘 불변효의 효사로 판단';
    ruleDesc = '변효가 다섯이니, 지괘에서 변하지 않은 한 효의 효사로 판단합니다.';
    const stable = [0, 1, 2, 3, 4, 5].filter((i) => !lines[i].changing)[0];
    texts = [zhiYao(stable, true)];
  } else {
    // count === 6
    if (primaryNum === 1) {
      rule = '용구(用九)로 판단';
      ruleDesc = '여섯 효가 모두 변하는 건괘이니 용구로 판단합니다.';
      texts = [guaText('용구', USE_TEXT[1], '본괘', true)];
    } else if (primaryNum === 2) {
      rule = '용육(用六)으로 판단';
      ruleDesc = '여섯 효가 모두 변하는 곤괘이니 용육으로 판단합니다.';
      texts = [guaText('용육', USE_TEXT[2], '본괘', true)];
    } else {
      rule = '지괘 괘사로 판단';
      ruleDesc = '여섯 효가 모두 변하니 지괘의 괘사로 판단합니다.';
      texts = [guaText('지괘 괘사', changed.judgment, '지괘', true)];
    }
  }

  return { count, changingIdx, rule, ruleDesc, texts };
}

// 앱 시계. 평소에는 실제 시간 그대로이고, 녹화·검증 때 ?timescale=0.1 처럼 주면
// 물리·카메라·인트로 타이밍이 모두 같은 비율로 느려진다(느린 렌더에서도 실제 속도 영상을 만들기 위해).
// CSS 애니메이션은 검증 스크립트가 같은 비율로 늦춘다(CDP Animation.setPlaybackRate).
const raw = typeof location !== 'undefined' ? parseFloat(new URLSearchParams(location.search).get('timescale')) : NaN;
export const TIME_SCALE = Number.isFinite(raw) ? Math.min(1, Math.max(0.02, raw)) : 1;

/** 앱 기준 현재 시각(ms) */
export const now = () => performance.now() * TIME_SCALE;
/** 앱 기준 ms 뒤에 실행 */
export const later = (fn, ms) => setTimeout(fn, ms / TIME_SCALE);

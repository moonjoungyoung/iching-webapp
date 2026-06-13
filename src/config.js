// 결과 질문하기(LLM) 백엔드 엔드포인트.
// 비어 있으면 질문하기 UI가 숨겨진다. 배포 시 Lambda Function URL로 채운다.
// 빌드 시 환경변수 VITE_ASK_ENDPOINT가 있으면 그 값을 우선 사용한다.
export const ASK_ENDPOINT =
  (import.meta.env && import.meta.env.VITE_ASK_ENDPOINT) ||
  'https://7qsd5fe7ult6l23ycxhyi6377y0oswuk.lambda-url.ap-northeast-2.on.aws/';

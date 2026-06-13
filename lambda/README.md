# iching-ask — 결과 질문하기 백엔드

주역 점괘 결과 화면의 "問占 · 점괘에게 묻기"가 호출하는 LLM 프록시.
클라이언트에 API 키를 노출하지 않기 위한 AWS Lambda(Function URL) 백엔드다.

## 동작
- `ask/index.mjs` — Anthropic Messages API(`claude-sonnet-4-6`) 를 대신 호출.
- API 키는 **jober-chat 운영 SSM 파라미터를 런타임에 읽는다**:
  `/copilot/jober-chat/production/secrets/LLM_API_KEY` (복사·하드코딩·로깅하지 않음).
- CORS 는 사이트 origin(`https://d1vry20p02uvjx.cloudfront.net`)으로 제한.
- 남용 방지: DynamoDB(`iching-ask-rate`) per-IP/전역 일일 레이트리밋(장애 시 fail-open)
  + Lambda reserved concurrency=3 (비용 하드 상한) + `max_tokens` 제한.

## 배포된 리소스 (account 476364780248 / ap-northeast-2)
- Lambda: `iching-ask` (nodejs20.x, handler `index.handler`)
- Function URL: `https://7qsd5fe7ult6l23ycxhyi6377y0oswuk.lambda-url.ap-northeast-2.on.aws/`
- IAM Role: `iching-ask-lambda-role` (basic exec + inline `iching-ask-permissions`)
- DynamoDB: `iching-ask-rate` (PK `pk`, TTL `exp`, on-demand)

## 코드 갱신 방법
```powershell
Set-Location lambda
Remove-Item deploy\function.zip -Force
Compress-Archive -Path ask\index.mjs -DestinationPath deploy\function.zip -Force
aws lambda update-function-code --function-name iching-ask `
  --zip-file fileb://deploy/function.zip --region ap-northeast-2
```

## 클라이언트 연결
`src/config.js` 의 `ASK_ENDPOINT` 가 Function URL. 빌드 시 `VITE_ASK_ENDPOINT` 로 override 가능.

## 환경 변수(선택, Lambda)
`LLM_KEY_PARAM`, `LLM_MODEL`, `ALLOW_ORIGIN`, `RATE_TABLE`, `PER_IP_PER_MIN`(6),
`GLOBAL_PER_DAY`(600), `MAX_TOKENS`(900) — 미설정 시 코드 기본값 사용.

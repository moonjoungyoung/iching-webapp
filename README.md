# 周易占卦 — 주역 동전점법 웹앱

Three.js + Cannon-es 물리엔진으로 구현한 주역 동전점법(擲錢法) 웹앱입니다.

## 기능

- 실제 물리법칙 기반 3D 동전 던지기 (Cannon-es)
- 고대 중국 동전(開元通寶) 실물 사진 텍스처
- 64괘 전체 데이터 (괘명, 괘사, 대상전)
- 변효(老陰/老陽) 판정 및 지괘(변화할 괘) 표시
- 중국 전통색 팔레트 + 서예체 폰트
- 모바일 최적화 반응형 디자인
- 결과 공유 (Web Share API)
- URL 파라미터로 결과 직접 표시 (`?hex=1&changed=2`)

## 기술 스택

- **렌더링**: Three.js (WebGL)
- **물리엔진**: Cannon-es
- **빌드**: Vite
- **폰트**: Zhi Mang Xing (한문 서예), Hahmlet (한글)
- **배포**: AWS S3 + CloudFront

## 개발

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # dist/ 생성
```

## 배포

```bash
npm run deploy  # S3 업로드 + CloudFront 캐시 무효화
```

## 동전점법 규칙

1. 동전 3개를 동시에 던진다
2. 앞면(陽) = 3점, 뒷면(陰) = 2점
3. 합계: 6(老陰), 7(少陽), 8(少陰), 9(老陽)
4. 이를 6번 반복하여 아래(초효)부터 위(상효)까지 괘를 세운다
5. 변효(6 또는 9)가 있으면 지괘(변화할 괘)도 함께 본다

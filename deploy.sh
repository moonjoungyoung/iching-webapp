#!/bin/bash
set -e

# 전용 버킷(OAC 비공개) + 전용 CloudFront 로 배포한다(2026-10-31 리뉴얼 주소 d3hvx0sm85rmzt).
# 리뉴얼 첫 주소(d3lce34aee1gcj)는 내렸고, 리뉴얼 전 옛 사이트(d1vry20p02uvjx, 버킷 gr.connectia.bio)는 건드리지 않는다.
BUCKET="${BUCKET:-iching-webapp-test-476364780248}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-EPJE5L6JUGG66}"
SITE_URL="${SITE_URL:-https://d3hvx0sm85rmzt.cloudfront.net}"

echo "=== 빌드 ==="
npm run build

echo "=== S3 업로드 ==="
aws s3 sync dist/ "s3://${BUCKET}/" --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --exclude "*.png" --exclude "*.jpg"

# Rapier 물리 엔진 wasm: Content-Type 을 application/wasm 으로 명시해야
# 브라우저가 스트리밍 컴파일하고 CloudFront 가 압축(br 약 0.85MB)해서 보낸다
aws s3 cp dist/assets/ "s3://${BUCKET}/assets/" --recursive --exclude "*" --include "*.wasm" --content-type "application/wasm" --cache-control "public, max-age=31536000, immutable"

# HTML은 캐시 짧게
aws s3 cp dist/index.html "s3://${BUCKET}/index.html" \
  --cache-control "public, max-age=60"

# 이미지는 별도 캐시
aws s3 sync dist/ "s3://${BUCKET}/" \
  --exclude "*" --include "*.png" --include "*.jpg" \
  --cache-control "public, max-age=86400"

echo "=== CloudFront 캐시 무효화 ==="
if [ -n "$DISTRIBUTION_ID" ]; then
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*"
  echo "캐시 무효화 요청 완료"
else
  echo "DISTRIBUTION_ID가 설정되지 않음. 수동으로 무효화하세요"
fi

echo "=== 배포 완료: ${SITE_URL} ==="

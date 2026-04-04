#!/bin/bash
set -e

BUCKET="gr.connectia.bio"
DISTRIBUTION_ID="" # CloudFront 배포 후 여기에 ID 입력

echo "=== 빌드 ==="
npm run build

echo "=== S3 업로드 ==="
aws s3 sync dist/ "s3://${BUCKET}/" --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --exclude "*.png"

# HTML은 캐시 짧게
aws s3 cp dist/index.html "s3://${BUCKET}/index.html" \
  --cache-control "public, max-age=60"

# 이미지는 별도 캐시
aws s3 sync dist/ "s3://${BUCKET}/" \
  --exclude "*" --include "*.png" \
  --cache-control "public, max-age=86400"

echo "=== CloudFront 캐시 무효화 ==="
if [ -n "$DISTRIBUTION_ID" ]; then
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*"
  echo "캐시 무효화 요청 완료"
else
  echo "DISTRIBUTION_ID가 설정되지 않음 — 수동으로 무효화하세요"
fi

echo "=== 배포 완료: https://gr.connectia.bio ==="

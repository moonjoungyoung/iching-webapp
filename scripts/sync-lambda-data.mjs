// 괘 데이터·점단 규칙을 람다 번들로 복사한다.
// 람다는 클라이언트가 보낸 괘사·효사 글을 믿지 않고, 괘 번호와 변효 자리만 받아 이 데이터로 맥락을 다시 만든다.
//
//   node scripts/sync-lambda-data.mjs     (npm run sync:lambda)
//
// src/hexagrams.js · yaoci.js · interpret.js → lambda/ask/data/*.mjs
// (람다 zip 에는 package.json 이 없어 .js 는 CommonJS 로 읽히므로 .mjs 로 바꾸고 import 경로도 맞춘다)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'lambda', 'ask', 'data');
mkdirSync(out, { recursive: true });

for (const name of ['hexagrams', 'yaoci', 'interpret']) {
  const src = readFileSync(join(root, 'src', `${name}.js`), 'utf8');
  const body = src.replace(/from '\.\/(hexagrams|yaoci|interpret)\.js'/g, "from './$1.mjs'");
  const banner = `// 자동 생성: scripts/sync-lambda-data.mjs 가 src/${name}.js 에서 복사. 직접 고치지 말 것.\n`;
  writeFileSync(join(out, `${name}.mjs`), banner + body);
  console.log(`lambda/ask/data/${name}.mjs`);
}

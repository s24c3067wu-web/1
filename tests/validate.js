/* 問題データと計算ドリルの整合性チェック:  node tests/validate.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['data-a.js', 'data-b.js', 'data-terms.js', 'drills.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { FE_CATS, FE_QA, FE_QB, FE_TERMS, FE_DRILLS } = ctx.window;
const errors = [];
const cats = new Set(FE_CATS.map((c) => c.id));
const ids = new Set();
function checkQ(q, allowedCats) {
  if (!q.id || ids.has(q.id)) errors.push(`ID重複または欠落: ${q.id}`);
  ids.add(q.id);
  if (!allowedCats.has(q.cat)) errors.push(`${q.id}: 不明な分野 ${q.cat}`);
  if (!q.q || !q.e) errors.push(`${q.id}: 問題文または解説がない`);
  if (!Array.isArray(q.c) || q.c.length !== 4) errors.push(`${q.id}: 選択肢が4つでない`);
  else if (new Set(q.c).size !== 4) errors.push(`${q.id}: 選択肢が重複`);
  if (!(Number.isInteger(q.a) && q.a >= 0 && q.a < (q.c || []).length)) errors.push(`${q.id}: 正解の添字が不正`);
  if (/[アイウエ]が正しい|[アイウエ]は誤り/.test(q.e)) errors.push(`${q.id}: 解説が選択肢の記号に依存している（シャッフルされるため不可）`);
}
FE_QA.forEach((q) => checkQ(q, cats));
FE_QB.forEach((q) => checkQ(q, new Set(['b-algo', 'b-sec'])));
const terms = new Set();
FE_TERMS.forEach((t) => {
  if (terms.has(t.t)) errors.push(`用語重複: ${t.t}`);
  terms.add(t.t);
  if (!cats.has(t.cat)) errors.push(`用語 ${t.t}: 不明な分野 ${t.cat}`);
  if (!t.d) errors.push(`用語 ${t.t}: 説明がない`);
});
// 用語のタップ表示：別名が別の用語と衝突していないか
const aliasOwner = {};
FE_TERMS.forEach((t) => {
  t.t.split(/\s*\/\s*/).concat(t.al || []).forEach((n) => {
    if (aliasOwner[n] && aliasOwner[n] !== t.t) errors.push(`用語の別名「${n}」が「${aliasOwner[n]}」と「${t.t}」で重複`);
    aliasOwner[n] = t.t;
  });
});
for (const [k, g] of Object.entries(FE_DRILLS)) {
  if (!cats.has(g.cat)) errors.push(`ドリル ${k}: 不明な分野`);
  for (let i = 0; i < 500; i++) {
    const q = g.gen();
    if (q.c.length !== 4 || new Set(q.c).size !== 4) { errors.push(`ドリル ${k}: 選択肢が不正 ${JSON.stringify(q.c)}`); break; }
    if (q.a !== 0 || q.c.some((x) => /NaN|undefined|Infinity/.test(x))) { errors.push(`ドリル ${k}: 値が不正 ${JSON.stringify(q)}`); break; }
  }
}
const perCat = {};
FE_QA.forEach((q) => { perCat[q.cat] = (perCat[q.cat] || 0) + 1; });
FE_CATS.forEach((c) => { if ((perCat[c.id] || 0) < c.w) errors.push(`分野 ${c.id}: 模試に必要な問題数(${c.w})に足りない`); });
console.log(`科目A ${FE_QA.length}問 / 科目B ${FE_QB.length}問 / 用語 ${FE_TERMS.length}語 / ドリル ${Object.keys(FE_DRILLS).length}種`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('OK');

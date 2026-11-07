/* IPA公開問題PDF取込みの解析ロジックのテスト（ダミーデータを使用）:  node tests/ipa-import.test.js */
const assert = require('assert');
const IPA = require('../js/ipa-import.js');

// pdf.js の textContent.items を模したダミー（x, y, 文字列）
const it = (s, x, y, fs = 10) => ({ str: s, transform: [fs, 0, 0, fs, x, y], width: s.length * fs, height: fs });

// 表紙と解答例の判定
assert.deepStrictEqual(IPA.detectMeta('令和９年度\n基本情報技術者試験 科目 A\n公開問題'), { reiwa: 9, subject: 'A', kind: 'qs' });
assert.strictEqual(IPA.detectMeta('令和９年度 基本情報技術者試験 公開問題 解答例\n科目 B 試験\n問1 エ').kind, 'ans');
assert.strictEqual(IPA.detectMeta('関係のないPDF'), null);
assert.deepStrictEqual(IPA.parseAnswers('問番号 正解 問番号 正解\n 問1 イ 問 11 ア\n問 2 ウ'), { 1: 'イ', 11: 'ア', 2: 'ウ' });

// 行の組立て：大きな空白でセグメントを分ける（2段組みの選択肢）
const lines = IPA.itemsToLines([
  it('問１', 50, 700), it('ダミーの問題文です。', 80, 700),
  it('ア', 60, 650), it('選択肢その1', 80, 650), it('イ', 300, 650), it('選択肢その2', 320, 650),
  it('ウ', 60, 630), it('選択肢その3', 80, 630), it('エ', 300, 630), it('選択肢その4', 320, 630),
  it('－ 4 －', 280, 40),
  it('問２', 50, 600), it('次の空欄に入れる答えを選べ。', 80, 600),
  it('解答群', 60, 560), it('a', 150, 540), it('b', 300, 540),
  it('ア', 60, 520), it('x ＋ 1', 100, 520), it('y', 260, 520),
  it('イ', 60, 500), it('x － 1', 100, 500), it('z', 260, 500)
], 4);
assert.strictEqual(lines[1].segs.length, 2, '2段組みの選択肢は別セグメントになる');

const qs = IPA.splitQuestions(lines);
assert.strictEqual(qs.length, 2);
const res = IPA.buildQuestions({ reiwa: 9, subject: 'A' }, lines, { 1: 'ウ', 2: 'イ' }, 'r9-A');
assert.strictEqual(res.questions.length, 2);
const q1 = res.questions[0];
assert.deepStrictEqual(q1.c, ['選択肢その1', '選択肢その2', '選択肢その3', '選択肢その4']);
assert.strictEqual(q1.a, 2);
assert.strictEqual(q1.src, '令和9年度 基本情報技術者試験 科目A 公開問題 問1');
assert.ok(!/－ 4 －/.test(q1.q), 'ページ番号は本文に含めない');
assert.deepStrictEqual(q1.ipa.pages, [4]);
const q2 = res.questions[1];
assert.deepStrictEqual(q2.c, ['a: x ＋ 1　b: y', 'a: x － 1　b: z'], '表形式の解答群を列ごとに組み立てる');
assert.strictEqual(q2.a, 1);

// 解答例にない問題は取り込まない
assert.strictEqual(IPA.buildQuestions({ reiwa: 9, subject: 'A' }, lines, { 1: 'ア' }, 'r9-A').questions.length, 1);
console.log('OK');

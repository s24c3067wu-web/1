/* えふいーさん：IPA公開問題PDFの取込み
 * 利用者がIPAの公式サイトからダウンロードした「問題冊子」「解答例」のPDFを端末内で解析し、
 * 出典付きの問題データに変換する。問題文そのものはアプリに同梱しない。
 * ブラウザ（pdf.js）と Node（テスト用）の両方で動くよう、PDFの読込み以外は純粋な関数にしている。
 */
(function (root) {
  'use strict';

  const LABELS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ', 'サ', 'シ', 'ス', 'セ', 'ソ'];
  const z2h = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  /* ---------- PDF → 行（セグメント付き） ---------- */
  // pdf.js の textContent.items から、ページごとの行を作る。
  // 1行は「大きな空白」で区切られたセグメントの列（2段組みの選択肢などを分けるため）
  function itemsToLines(items, pageNo) {
    const toks = items.filter((it) => it.str && it.str.trim() !== '').map((it) => {
      const fs = Math.abs(it.transform[3]) || it.height || 10;
      return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, fs };
    });
    toks.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    for (const t of toks) {
      const L = lines.length ? lines[lines.length - 1] : null;
      if (L && Math.abs(L.y - t.y) <= Math.max(2, t.fs * 0.35)) L.toks.push(t);
      else lines.push({ y: t.y, toks: [t] });
    }
    return lines.map((L) => {
      L.toks.sort((a, b) => a.x - b.x);
      const segs = [];
      let cur = null, end = 0;
      for (const t of L.toks) {
        const gap = t.x - end;
        if (!cur || gap > t.fs * 1.6) { cur = { x: t.x, s: t.s }; segs.push(cur); }
        else cur.s += (gap > t.fs * 0.35 ? ' ' : '') + t.s;
        end = t.x + t.w;
      }
      segs.forEach((g) => { g.s = g.s.replace(/\s+/g, ' ').trim(); });
      return { page: pageNo, y: L.y, x: segs[0].x, fs: L.toks[0].fs, segs, text: segs.map((g) => g.s).join('　') };
    });
  }

  const NOISE = [/^－\s*\d+\s*－$/, /^-\s*\d+\s*-$/, /^〔\s*メ\s*モ\s*用\s*紙\s*〕$/, /^©/, /独立行政法人情報処理推進機構$/,
    /会社名又は製品名/, /^なお，?\s*試験問題では/, /^(TM|™)?\s*(及び)?\s*®?$/, /を明記していません/];
  // 冊子末尾の注意書きなど、これ以降は問題ではない行
  const STOP = /試験問題に記載されている会社名/;
  const isNoise = (t) => NOISE.some((r) => r.test(t.replace(/\s+/g, ' ').trim()));

  /* ---------- ファイルの種類と年度 ---------- */
  function detectMeta(firstPagesText) {
    const t = z2h(firstPagesText.replace(/\s+/g, ''));
    if (!/基本情報技術者試験/.test(t)) return null;
    const m = t.match(/令和(\d+)年度/);
    const subject = /科目A/.test(t) ? 'A' : /科目B/.test(t) ? 'B' : null;
    if (!m || !subject) return null;
    return { reiwa: parseInt(m[1], 10), subject, kind: /解答例/.test(t) && !/問題冊子/.test(t) && t.length < 600 ? 'ans' : 'qs' };
  }

  /* ---------- 解答例 ---------- */
  function parseAnswers(text) {
    const t = z2h(text);
    const ans = {};
    const re = /問\s*(\d+)\s*([ア-ン])/g;
    let m;
    while ((m = re.exec(t))) ans[parseInt(m[1], 10)] = m[2];
    return ans;
  }

  /* ---------- 問題冊子 ---------- */
  const Q_HEAD = /^問\s*([0-9０-９]+)(?![～~0-9０-９])\s*(.*)$/;
  function splitQuestions(lines) {
    const qs = [];
    let cur = null;
    for (const L of lines) {
      if (STOP.test(L.text)) { cur = null; continue; }
      if (isNoise(L.text)) continue;
      const first = L.segs[0].s;
      const m = first.match(Q_HEAD);
      // 表紙の「問題番号 問１～問20」などは除外し、左端から始まる「問N」だけを問題の開始とみなす
      if (m && !/問題番号/.test(L.text) && L.x < 120) {
        cur = { no: parseInt(z2h(m[1]), 10), lines: [], pages: [L.page] };
        qs.push(cur);
        const rest = [m[2]].concat(L.segs.slice(1).map((g) => g.s)).join(' ').trim();
        if (rest) cur.lines.push(Object.assign({}, L, { segs: [{ x: L.x, s: rest }].concat([]), text: rest }));
        continue;
      }
      if (!cur) continue;
      if (!cur.pages.includes(L.page)) cur.pages.push(L.page);
      cur.lines.push(L);
    }
    return qs;
  }

  // セグメントの列から、ア・イ・ウ…の順に並んだ選択肢を探す
  function findChoices(lines, startIdx) {
    const segs = [];
    for (let i = startIdx; i < lines.length; i++) {
      lines[i].segs.forEach((g, j) => segs.push({ li: i, j, s: g.s, x: g.x, lineStart: j === 0 }));
    }
    const labelOf = (s) => { const m = s.match(/^([ア-ソ])(?:\s+|$)/); return m ? m[1] : null; };
    // 最後に現れる「ア」から、イ・ウ・エ…が順に続く並びを採用する
    for (let k = segs.length - 1; k >= 0; k--) {
      if (labelOf(segs[k].s) !== 'ア') continue;
      const starts = [k];
      let want = 1;
      for (let i = k + 1; i < segs.length; i++) {
        if (labelOf(segs[i].s) === LABELS[want]) { starts.push(i); want++; }
      }
      if (starts.length >= 2) {
        const choices = starts.map((s, n) => {
          const endSeg = n + 1 < starts.length ? starts[n + 1] : segs.length;
          const parts = [];
          for (let i = s; i < endSeg; i++) parts.push(i === s ? segs[i].s.replace(/^[ア-ソ]\s*/, '') : segs[i].s);
          return parts.join(' ').replace(/\s+/g, ' ').trim();
        });
        return { firstLine: segs[k].li, choices, rowSegs: starts.map((s, n) => segs.slice(s, n + 1 < starts.length ? starts[n + 1] : segs.length)) };
      }
    }
    return null;
  }

  // 表形式の解答群（列見出し a, b, …）。セルは複数行に折り返され、行の上下中央に置かれるため、
  // 各テキストを「最も近い選択肢記号の行」と「最も近い列」に割り当てて組み立てる
  function parseTable(lines, headIdx) {
    const head = lines[headIdx];
    const cols = head.segs.map((g) => ({ name: g.s, x: g.x }));
    const bounds = cols.slice(1).map((c, i) => (cols[i].x + c.x) / 2);
    const colOf = (x) => { let k = 0; while (k < bounds.length && x >= bounds[k]) k++; return k; };
    const region = lines.slice(headIdx + 1);
    const labelRows = region.filter((l) => /^[ア-ソ](\s|$)/.test(l.segs[0].s));
    if (labelRows.length < 2) return null;
    const rows = labelRows.map((l) => ({ line: l, cells: cols.map(() => []) }));
    region.forEach((l) => {
      let best = null, bd = Infinity;
      rows.forEach((r) => { if (r.line.page !== l.page) return; const d = Math.abs(r.line.y - l.y); if (d < bd) { bd = d; best = r; } });
      if (!best) return;
      l.segs.forEach((g, j) => {
        let text = g.s, x = g.x;
        if (l === best.line && j === 0) { text = text.replace(/^[ア-ソ]\s*/, ''); if (!text) return; x = Math.max(x, cols[0].x - 1e6); }
        best.cells[l === best.line && j === 0 ? 0 : colOf(x)].push({ y: l.y, text });
      });
    });
    // 空のセルがあるときは列の切り分けに失敗しているので使わない
    if (rows.some((r) => r.cells.some((c) => !c.length))) return null;
    return rows.map((r) => cols.map((c, i) => `${c.name}: ${r.cells[i].sort((p, q) => q.y - p.y).map((t) => t.text).join('')}`).join('　'));
  }

  // 本文：PDFの折返しを詰めつつ、プログラムや表の字下げはそのまま残す
  function bodyText(lines, subject) {
    if (!lines.length) return '';
    const left = Math.min(...lines.map((l) => l.x));
    const fs = lines[0].fs || 10;
    let out = '';
    let prevLong = false;
    lines.forEach((L) => {
      const indent = Math.max(0, Math.round((L.x - left) / (fs * 0.5)));
      const isCode = subject === 'B' && /^(○|if|elseif|else|endif|for|endfor|while|endwhile|do|return|大域|整数型|実数型|文字型|文字列型|論理型|\/\*|[a-zA-Z_][\w.]*(\[.*\])?\s*←)/.test(L.segs[0].s);
      const text = L.segs.map((g) => g.s).join('　');
      if (prevLong && !isCode && indent <= 2 && subject === 'A') out += text;
      else out += (out ? '\n' : '') + (isCode || indent > 2 ? '  '.repeat(Math.min(12, Math.round(indent / 2))) : '') + text;
      prevLong = !isCode && text.length >= 30 && !/[。：]$/.test(text);
    });
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- 分野の自動分類（科目A） ---------- */
  const KEYWORDS = {
    sec: ['暗号', '認証', '攻撃', 'マルウェア', 'ウイルス', 'セキュリティ', '脆弱性', 'ファイアウォール', 'デジタル署名', 'ハッシュ', 'なりすまし', '改ざん', 'CSIRT', 'ISMS', 'WAF', 'VPN', 'TLS', 'リスク', 'ログ'],
    nw: ['ネットワーク', 'IPアドレス', 'IP アドレス', 'プロトコル', 'TCP', 'UDP', 'LAN', 'ルータ', 'パケット', 'サブネット', 'DNS', 'DHCP', 'MAC', 'ビット/秒', 'bps', '伝送', 'IPv'],
    db: ['データベース', 'SQL', '表', '正規化', 'トランザクション', '主キー', '外部キー', 'ロック', 'ログファイル', 'SELECT', 'NoSQL'],
    algo: ['探索', 'ソート', '整列', 'スタック', 'キュー', '木', 'リスト', 'アルゴリズム', '再帰', 'ハッシュ表', '配列'],
    theory: ['2進', '16進', '10進', '確率', '論理', '補数', '浮動小数点', '集合', '機械学習', 'ビット列', '誤差', '符号', '正規分布', 'オートマトン', '遷移'],
    hw: ['CPU', 'プロセッサ', 'キャッシュ', 'メモリ', 'クロック', 'MIPS', 'GPU', '割込み', 'RAID', 'SSD', 'フラッシュ', '論理回路', 'FPGA', 'パイプライン'],
    sys: ['稼働率', 'MTBF', 'MTTR', 'クラウド', '仮想化', 'システム構成', 'スループット', 'レスポンスタイム', 'フェール', '冗長', 'クラスタ', 'ベンチマーク'],
    sw: ['OS', 'オペレーティング', 'タスク', 'プロセス', 'スケジューリング', 'ページ', '仮想記憶', 'コンパイラ', 'ファイルシステム', 'ディレクトリ', 'オープンソース', 'デッドロック'],
    dev: ['テスト', 'UML', 'オブジェクト指向', 'アジャイル', 'スクラム', 'モジュール', 'レビュー', '開発', 'クラス', 'DevOps', '要件', 'プログラム'],
    pm: ['プロジェクト', 'WBS', 'EVM', 'アローダイアグラム', 'クリティカルパス', 'ステークホルダ', '工数', 'スケジュール'],
    sm: ['サービス', 'SLA', 'インシデント', 'ITIL', '監査', '内部統制', 'バックアップ', '運用', 'サービスデスク', '変更管理'],
    st: ['システム戦略', 'BPR', 'ERP', 'RFP', 'RFI', '情報システム', 'DX', 'SoE', 'SoR', 'エンタープライズ', '業務プロセス', 'RPA', '調達'],
    biz: ['マーケティング', 'SWOT', 'PPM', '戦略', '競争', '市場', 'イノベーション', 'バランススコアカード', '技術経営', 'ブランド', 'CRM', 'SCM'],
    corp: ['利益', '売上', '費用', '在庫', '財務', '会計', '損益', '貸借', '原価', 'ROE', 'パレート', '管理図', '経営', '発注', '意思決定', 'BCP'],
    law: ['法', '著作権', '契約', '特許', '個人情報', '派遣', '請負', 'ライセンス', '規則', '標準化', 'JIS', 'ISO']
  };
  function classifyA(text) {
    let best = 'theory', bestScore = 0;
    for (const [cat, kws] of Object.entries(KEYWORDS)) {
      let sc = 0;
      kws.forEach((k) => { if (text.includes(k)) sc += k.length >= 3 ? 2 : 1; });
      if (sc > bestScore) { bestScore = sc; best = cat; }
    }
    return best;
  }
  function classifyB(text) {
    return /プログラム|関数|手続|配列/.test(text) ? 'b-algo' : 'b-sec';
  }

  /* ---------- 問題冊子＋解答例 → 問題データ ---------- */
  function buildQuestions(meta, lines, answers, fileKey) {
    const subject = meta.subject;
    const out = [], warnings = [];
    splitQuestions(lines).forEach((q) => {
      const fc = findChoices(q.lines, 0);
      const ansLabel = answers[q.no];
      const src = `令和${meta.reiwa}年度 基本情報技術者試験 科目${subject} 公開問題 問${q.no}`;
      let choices, bodyLines, needsPage = subject === 'B';
      if (fc && fc.choices.length >= 2) {
        choices = fc.choices;
        // 「解答群」の見出しは本文から外す
        bodyLines = q.lines.slice(0, fc.firstLine).filter((l) => !/^解答群$/.test(l.text.trim()));
        // 表形式の解答群（列見出し a, b, c …）なら「a: … ／ b: …」にする
        let hi = -1;
        for (let i = fc.firstLine - 1; i >= Math.max(0, fc.firstLine - 4); i--) {
          const L = q.lines[i];
          if (L.segs.length >= 2 && L.segs.every((g) => /^[a-z]$/.test(g.s))) { hi = i; break; }
        }
        if (hi >= 0) {
          const t = parseTable(q.lines, hi);
          if (t && t.length === choices.length) choices = t;
          else { choices = choices.map(() => ''); needsPage = true; }
          bodyLines = q.lines.slice(0, hi).filter((l) => !/^解答群$/.test(l.text.trim()));
        }
      } else {
        warnings.push(`問${q.no}：選択肢を読み取れませんでした（問題冊子の表示で解答できます）`);
        needsPage = true;
        const n = ansLabel ? Math.max(4, LABELS.indexOf(ansLabel) + 1) : 4;
        choices = LABELS.slice(0, n).map(() => '');
        bodyLines = q.lines;
      }
      // 空の選択肢は記号だけで表示する
      choices = choices.map((c, i) => c || `（解答群の${LABELS[i]}：問題冊子を参照）`);
      const a = ansLabel ? LABELS.indexOf(ansLabel) : -1;
      if (a < 0 || a >= choices.length) { warnings.push(`問${q.no}：解答例と対応付けできなかったため取り込みませんでした`); return; }
      const body = bodyText(bodyLines, subject);
      out.push({
        id: `ipa:r${meta.reiwa}-${subject}-${q.no}`,
        cat: subject === 'A' ? classifyA(body + choices.join(' ')) : classifyB(body),
        src, q: body || `問${q.no}（問題冊子を参照）`, code: '', c: choices, a,
        e: `正解：${ansLabel}（IPA公開の解答例による）。\n解説はIPAから公開されていません。正解の理由と、他の選択肢が誤りである理由を自分の言葉で説明できるか確認しましょう。`,
        ipa: { file: fileKey, pages: q.pages, showPage: needsPage }
      });
    });
    return { questions: out, warnings };
  }

  /* ---------- pdf.js を使った読込み ---------- */
  async function readPdf(pdfjsLib, data) {
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const lines = [];
    let head = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const ls = itemsToLines(tc.items, p);
      if (p <= 2) head += ls.map((l) => l.text).join('\n') + '\n';
      lines.push(...ls);
    }
    return { doc, lines, head, text: lines.map((l) => l.text).join('\n') };
  }

  // files: [{name, data(ArrayBuffer)}] → {sets:[{meta, questions, warnings, fileKey}], errors:[]}
  async function importFiles(pdfjsLib, files) {
    const errors = [];
    const parsed = [];
    for (const f of files) {
      try {
        const r = await readPdf(pdfjsLib, f.data.slice(0));
        const meta = detectMeta(r.head);
        if (!meta) { errors.push(`${f.name}：基本情報技術者試験の公開問題として認識できませんでした`); continue; }
        parsed.push({ name: f.name, meta, r, data: f.data });
      } catch (e) {
        errors.push(`${f.name}：PDFを読み込めませんでした`);
      }
    }
    const sets = [];
    parsed.filter((p) => p.meta.kind === 'qs').forEach((qs) => {
      const ans = parsed.find((p) => p.meta.kind === 'ans' && p.meta.reiwa === qs.meta.reiwa && p.meta.subject === qs.meta.subject);
      const label = `令和${qs.meta.reiwa}年度 科目${qs.meta.subject}`;
      if (!ans) { errors.push(`${label}：解答例のPDFが見つかりません。問題冊子と解答例をいっしょに選んでください`); return; }
      const fileKey = `r${qs.meta.reiwa}-${qs.meta.subject}`;
      const res = buildQuestions(qs.meta, qs.r.lines, parseAnswers(ans.r.text), fileKey);
      sets.push({ label, fileKey, meta: qs.meta, data: qs.data, questions: res.questions, warnings: res.warnings });
    });
    parsed.filter((p) => p.meta.kind === 'ans').forEach((a) => {
      if (!parsed.some((p) => p.meta.kind === 'qs' && p.meta.reiwa === a.meta.reiwa && p.meta.subject === a.meta.subject)) {
        errors.push(`令和${a.meta.reiwa}年度 科目${a.meta.subject}：問題冊子のPDFが見つかりません`);
      }
    });
    return { sets, errors };
  }

  const api = { itemsToLines, detectMeta, parseAnswers, splitQuestions, findChoices, buildQuestions, classifyA, classifyB, readPdf, importFiles, LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FE_IPA = api;
})(typeof window !== 'undefined' ? window : globalThis);

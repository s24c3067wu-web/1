/* えふいーさん 計算ドリル：毎回ランダムに問題を生成する */
(function () {
  const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const round = (x, d) => { const p = Math.pow(10, d); return Math.round(x * p) / p; };
  const fmt = (x) => String(x);

  // 正解と誤答候補から重複のない4択を作る。足りなければ fallback で補う
  function choices(correct, wrong, fallback) {
    const set = [String(correct)];
    for (const w of wrong) {
      const s = String(w);
      if (!set.includes(s) && s !== 'NaN' && s !== '') set.push(s);
      if (set.length === 4) break;
    }
    let guard = 0;
    while (set.length < 4 && guard++ < 100) {
      const s = String(fallback());
      if (!set.includes(s)) set.push(s);
    }
    return { c: set, a: 0 };
  }

  const bin = (n, w) => n.toString(2).padStart(w || 0, '0');

  const G = {
    dec2bin: {
      name: '10進数 → 2進数', cat: 'theory',
      gen() {
        const n = ri(5, 250);
        const ans = bin(n);
        const flip = ans.length > 1 ? ans.split('').reverse().join('') : ans;
        const r = choices(ans, [flip, bin(n + 1), bin(n - 1), bin(n ^ 2)], () => bin(ri(5, 250)));
        return { q: `10進数 ${n} を2進数で表したものはどれか。`, ...r,
          e: `${n} を2で割り続け、余りを下から読む。${n} = ${ans.split('').map((b, i, s) => b === '1' ? Math.pow(2, s.length - 1 - i) : null).filter(Boolean).join(' + ')} なので ${ans}。` };
      }
    },
    bin2dec: {
      name: '2進数 → 10進数', cat: 'theory',
      gen() {
        const n = ri(9, 250);
        const b = bin(n);
        const r = choices(n, [n + 1, n - 1, n + 2, parseInt(b.split('').reverse().join(''), 2)], () => ri(9, 255));
        const terms = b.split('').map((d, i) => d === '1' ? Math.pow(2, b.length - 1 - i) : null).filter((x) => x !== null);
        return { q: `2進数 ${b} を10進数で表したものはどれか。`, ...r,
          e: `1が立っている桁の重みを足す：${terms.join(' + ')} = ${n}。` };
      }
    },
    hex2dec: {
      name: '16進数 ⇔ 10進数', cat: 'theory',
      gen() {
        const n = ri(26, 255);
        const h = n.toString(16).toUpperCase();
        if (Math.random() < 0.5) {
          const r = choices(n, [n + 16, n - 16, n + 10, n - 6], () => ri(26, 255));
          return { q: `16進数 ${h} を10進数で表したものはどれか。`, ...r,
            e: `${h[0]} × 16 + ${h[1]} = ${parseInt(h[0], 16)} × 16 + ${parseInt(h[1], 16)} = ${n}。（A=10, B=11, C=12, D=13, E=14, F=15）` };
        }
        const wrong = [n + 1, n + 16, n - 16, n - 1].filter((x) => x > 15 && x < 256).map((x) => x.toString(16).toUpperCase());
        const r = choices(h, wrong, () => ri(26, 255).toString(16).toUpperCase());
        return { q: `10進数 ${n} を16進数で表したものはどれか。`, ...r,
          e: `${n} ÷ 16 = ${Math.floor(n / 16)} 余り ${n % 16}。商と余りを16進の1桁ずつで表して ${h}。` };
      }
    },
    twos: {
      name: '2の補数', cat: 'theory',
      gen() {
        const n = ri(1, 100);
        const ans = bin(256 - n, 8);
        const ones = bin(255 - n, 8);
        const sm = '1' + bin(n, 7);
        const r = choices(ans, [ones, sm, bin(n, 8)], () => bin(ri(128, 255), 8));
        return { q: `10進数 −${n} を8ビットの2の補数で表したものはどれか。`, ...r,
          e: `+${n} = ${bin(n, 8)}。全ビットを反転すると ${ones}（1の補数）、それに1を足して ${ans}。` };
      }
    },
    series: {
      name: '稼働率（直列・並列）', cat: 'sys',
      gen() {
        const a = pick([0.8, 0.9, 0.95, 0.98]);
        const b = pick([0.8, 0.9, 0.95, 0.98]);
        const ser = round(a * b, 4);
        const par = round(1 - (1 - a) * (1 - b), 4);
        if (Math.random() < 0.5) {
          const r = choices(ser, [par, round((a + b) / 2, 4), round(1 - (1 - a) * (1 - b) * 2, 4)], () => round(ser + ri(-5, 5) / 100, 4));
          return { q: `稼働率 ${a} の装置と稼働率 ${b} の装置を直列に接続したシステムの稼働率はどれか。`, ...r,
            e: `直列はすべて稼働しているときだけ稼働：${a} × ${b} = ${ser}。` };
        }
        const r = choices(par, [ser, round((a + b) / 2, 4), round((1 - a) * (1 - b), 4)], () => round(par - ri(1, 9) / 1000, 4));
        return { q: `稼働率 ${a} の装置と稼働率 ${b} の装置を並列に接続し、どちらか一方が稼働していればよいシステムの稼働率はどれか。`, ...r,
          e: `並列は両方止まる場合以外は稼働：1 − (1 − ${a}) × (1 − ${b}) = 1 − ${round((1 - a) * (1 - b), 4)} = ${par}。` };
      }
    },
    mtbf: {
      name: 'MTBF・MTTR', cat: 'sys',
      gen() {
        const ratio = pick([0.8, 0.9, 0.95, 0.96, 0.98]);
        const total = pick([100, 200, 500, 1000]);
        const mtbf = round(total * ratio, 2);
        const mttr = round(total - mtbf, 2);
        const r = choices(ratio, [round(mttr / total, 2), round(mtbf / (mtbf + 2 * mttr), 3), round(1 - mttr / mtbf, 3)], () => round(ratio - ri(1, 5) / 100, 2));
        return { q: `MTBFが ${mtbf} 時間、MTTRが ${mttr} 時間のシステムの稼働率はどれか。`, ...r,
          e: `稼働率 = MTBF ÷ (MTBF + MTTR) = ${mtbf} ÷ ${total} = ${ratio}。` };
      }
    },
    cache: {
      name: '実効アクセス時間', cat: 'hw',
      gen() {
        const c = pick([5, 10, 20]);
        const m = pick([50, 60, 80, 100]);
        const h = pick([0.8, 0.9, 0.95]);
        const ans = round(h * c + (1 - h) * m, 2);
        const r = choices(ans, [round((1 - h) * c + h * m, 2), round((c + m) / 2, 2), round(h * c, 2)], () => round(ans + ri(1, 9), 2));
        return { q: `キャッシュメモリのアクセス時間が ${c} ナノ秒、主記憶のアクセス時間が ${m} ナノ秒、キャッシュのヒット率が ${h} のとき、実効アクセス時間は何ナノ秒か。`, ...r,
          e: `${h} × ${c} + (1 − ${h}) × ${m} = ${round(h * c, 2)} + ${round((1 - h) * m, 2)} = ${ans} ナノ秒。` };
      }
    },
    mips: {
      name: 'MIPS・CPI', cat: 'hw',
      gen() {
        const ghz = pick([1, 2, 3, 4]);
        const cpi = pick([2, 4, 5, 8]);
        const ans = round(ghz * 1000 / cpi, 2);
        const r = choices(ans, [ghz * 1000 * cpi, round(ghz * 100 / cpi, 2), round(ghz * 1000 / (cpi * 2), 2)], () => ans + ri(1, 9) * 10);
        return { q: `クロック周波数 ${ghz}GHz のCPUで、1命令あたりの平均クロック数（CPI）が ${cpi} のとき、このCPUの性能は何MIPSか。`, ...r,
          e: `${ghz}GHz = ${ghz * 1000} × 10^6 クロック/秒。÷ CPI ${cpi} = ${ans} × 10^6 命令/秒 = ${ans} MIPS。` };
      }
    },
    transfer: {
      name: '伝送時間', cat: 'nw',
      gen() {
        const mb = pick([10, 20, 50, 100, 200]);
        const mbps = pick([10, 50, 100, 200, 1000]);
        const eff = pick([0.5, 0.8, 1]);
        const ans = round(mb * 8 / (mbps * eff), 3);
        const r = choices(ans, [round(mb / (mbps * eff), 3), round(mb * 8 / mbps, 3), round(mb * 8 * eff / mbps, 3)], () => round(ans * pick([2, 4, 10, 0.5]), 3));
        const effTxt = eff === 1 ? '' : `、伝送効率 ${eff * 100}%`;
        return { q: `${mb}Mバイトのデータを、伝送速度 ${mbps}Mビット/秒${effTxt}の回線で送るのにかかる時間は何秒か。（1M = 10^6 とする）`, ...r,
          e: `${mb}Mバイト × 8 = ${mb * 8}Mビット。実効速度 ${mbps} × ${eff} = ${round(mbps * eff, 2)}Mビット/秒。${mb * 8} ÷ ${round(mbps * eff, 2)} = ${ans} 秒。` };
      }
    },
    subnet: {
      name: 'サブネット', cat: 'nw',
      gen() {
        const p = ri(22, 29);
        const ans = Math.pow(2, 32 - p) - 2;
        const r = choices(ans, [ans + 2, ans / 2 - 1, (ans + 2) * 2 - 2], () => Math.pow(2, ri(2, 10)) - 2);
        return { q: `サブネットマスクが /${p} のネットワークで、ホストに割り当て可能なIPアドレスの最大数はどれか。`, ...r,
          e: `ホスト部は 32 − ${p} = ${32 - p} ビット。2^${32 - p} = ${ans + 2} から、ネットワークアドレスとブロードキャストアドレスの2つを引いて ${ans}。` };
      }
    },
    breakeven: {
      name: '損益分岐点', cat: 'corp',
      gen() {
        const vr = pick([0.4, 0.5, 0.6, 0.75, 0.8]);
        const be = pick([500, 800, 1000, 1200, 2000]);
        const fixed = round(be * (1 - vr), 2);
        const r = choices(be, [round(fixed / vr, 0), round(fixed * (1 + vr), 0), round(fixed + fixed * vr, 0) + 1], () => be + ri(1, 9) * 50);
        return { q: `固定費が ${fixed} 万円、変動費率が ${vr} の企業の損益分岐点売上高は何万円か。`, ...r,
          e: `損益分岐点売上高 = 固定費 ÷ (1 − 変動費率) = ${fixed} ÷ ${round(1 - vr, 2)} = ${be} 万円。` };
      }
    },
    keys: {
      name: '暗号の鍵の数', cat: 'sec',
      gen() {
        const n = ri(4, 50);
        const common = n * (n - 1) / 2;
        if (Math.random() < 0.6) {
          const r = choices(common, [n * (n - 1), 2 * n, n], () => common + ri(1, 20));
          return { q: `${n}人が互いに共通鍵暗号方式で個別に通信する。必要な鍵の総数はどれか。`, ...r,
            e: `2人の組合せごとに1つ：n(n − 1) / 2 = ${n} × ${n - 1} / 2 = ${common}。` };
        }
        const r = choices(2 * n, [common, n, n * (n - 1)], () => 2 * n + ri(1, 9));
        return { q: `${n}人が公開鍵暗号方式で互いに通信する。全員が用意する公開鍵と秘密鍵の総数はどれか。`, ...r,
          e: `1人が公開鍵と秘密鍵の1ペアを持てばよいので 2n = ${2 * n}。共通鍵なら ${common} 個必要。` };
      }
    }
  };

  window.FE_DRILLS = G;
})();

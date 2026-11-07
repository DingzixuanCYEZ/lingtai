// 教练回答里可以带的小组件（blocks）。教练只给内容，程序先检查再画出来：
// 不合法的丢掉，错在哪写成 problems，由 coach.js 下次告诉教练。这里不碰 DOM，node 里也能测。

export const POS_NAMES = ['左上', '上', '右上', '左', '中', '右', '左下', '下', '右下'];
const POS_ALIAS = {
  左上: 0, 上: 1, 上中: 1, 中上: 1, 正上: 1, 右上: 2,
  左: 3, 左中: 3, 中左: 3, 中: 4, 中间: 4, 正中: 4, 中心: 4, 右: 5, 右中: 5, 中右: 5,
  左下: 6, 下: 7, 下中: 7, 中下: 7, 正下: 7, 右下: 8,
};
const KEY_ALIAS = { 位置: 'pos', 位置键: 'pos', pos: 'pos', 字母: 'snd', 字母键: 'snd', 声音: 'snd', snd: 'snd' };

const MAX_STEPS = 16;
const MAX_CHOICES = 4;

function parsePos(v) {
  if (Number.isInteger(v) && v >= 0 && v <= 8) return v;
  const s = String(v ?? '').replace(/\s|格/g, '');
  return s in POS_ALIAS ? POS_ALIAS[s] : null;
}

function parseLetter(v) {
  const s = String(v ?? '').trim();
  return /^[a-z]$/i.test(s) ? s.toUpperCase() : null;
}

// 双重N-back 的演示：一串方块和字母，每一步该不该按由程序算；教练说的按法和程序算的不一样，整块不给用户看
function checkDnbDemo(b) {
  const n = Number(b.n);
  const steps = Array.isArray(b.steps) ? b.steps : [];
  if (!Number.isInteger(n) || n < 1 || n > 9) return { problem: `演示的 n=${b.n} 不合法（要 1 到 9 的整数）` };
  if (steps.length <= n || steps.length > MAX_STEPS) return { problem: `演示有 ${steps.length} 步；要比 n 多，最多 ${MAX_STEPS} 步` };
  const pos = steps.map((s) => parsePos(s?.pos));
  const bad = pos.findIndex((p) => p == null);
  if (bad >= 0) return { problem: `演示第 ${bad + 1} 步的位置“${steps[bad]?.pos}”看不懂，要用：${POS_NAMES.join('、')}` };
  const raw = steps.map((s) => s?.letter);
  const useLetters = raw.some((x) => x != null && x !== '');
  const letters = useLetters ? raw.map(parseLetter) : null;
  if (useLetters && letters.some((x) => x == null)) return { problem: '演示里的字母要么每一步都写（单个英文字母），要么都不写' };

  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const truth = {
      pos: i >= n && pos[i] === pos[i - n],
      snd: !!letters && i >= n && letters[i] === letters[i - n],
    };
    const said = new Set((Array.isArray(steps[i].press) ? steps[i].press : []).map((k) => KEY_ALIAS[String(k).trim()]).filter(Boolean));
    for (const [k, name] of [['pos', '位置'], ['snd', '字母']]) {
      if (k === 'snd' && !letters) {
        if (said.has('snd')) return { problem: `演示第 ${i + 1} 步说要按字母键，但这个例子没写字母` };
        continue;
      }
      if (said.has(k) !== truth[k]) {
        const what = k === 'pos' ? `位置是${POS_NAMES[pos[i]]}，${n} 步前是${i >= n ? POS_NAMES[pos[i - n]] : '（还没有）'}`
          : `字母是 ${letters[i]}，${n} 步前是 ${i >= n ? letters[i - n] : '（还没有）'}`;
        return { problem: `演示第 ${i + 1} 步算错了：${what}，应该${truth[k] ? '' : '不'}按${name}键，你写的是${said.has(k) ? '' : '不'}按` };
      }
    }
    out.push({ pos: pos[i], letter: letters ? letters[i] : null, press: truth, note: String(steps[i].note || '').slice(0, 200) });
  }
  return { block: { type: 'demo', game: 'dnb', n, title: String(b.title || '').slice(0, 80), steps: out } };
}

function checkChoices(b) {
  const opts = (Array.isArray(b.options) ? b.options : [])
    .map((x) => String(x ?? '').trim()).filter((x) => x && x.length <= 20);
  const uniq = [...new Set(opts)].slice(0, MAX_CHOICES);
  if (uniq.length < 2) return { problem: '选项（choices）至少要 2 个，每个不超过 20 个字' };
  return { block: { type: 'choices', options: uniq } };
}

// blocks：教练给的数组。返回 { blocks, problems }
export function checkBlocks(blocks) {
  const out = [], problems = [];
  if (blocks == null) return { blocks: out, problems };
  if (!Array.isArray(blocks)) return { blocks: out, problems: ['blocks 要是数组'] };
  for (const b of blocks.slice(0, 4)) {
    let r;
    if (b?.type === 'demo' && (b.game ?? 'dnb') === 'dnb') r = checkDnbDemo(b);
    else if (b?.type === 'choices') r = checkChoices(b);
    else r = { problem: `不认识的组件 ${JSON.stringify(b?.type)}${b?.type === 'demo' ? `（演示目前只支持双重N-back）` : ''}` };
    if (r.block) out.push(r.block); else problems.push(r.problem);
  }
  return { blocks: out, problems };
}

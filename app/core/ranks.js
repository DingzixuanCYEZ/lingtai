// 六条能力线的段位表、修为档位。与 段位释义.md 保持一致；改这里要同时改释义并升版本号。

export const LINES = {
  wm:       { name: '工作记忆', ladder: '修仙',     bigs: ['炼气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫'], subs: ['初期', '中期', '后期'], sep: '', reserved: 2 },
  spatial:  { name: '空间',     ladder: '腰带',     bigs: ['白带', '黄带', '橙带', '绿带', '蓝带', '紫带', '棕带', '黑带'], subs: ['初', '中', '后'], sep: '·', reserved: 1 },
  pattern:  { name: '规律归纳', ladder: '科举',     bigs: ['童生', '秀才', '举人', '贡士', '进士', '探花', '榜眼', '状元'], subs: ['初', '中', '后'], sep: '·', reserved: 1 },
  blackbox: { name: '假设检验', ladder: '格物八目', bigs: ['格物', '致知', '诚意', '正心', '修身', '齐家', '治国', '平天下'], subs: ['初', '中', '后'], sep: '·', reserved: 1 },
  path:     { name: '规划',     ladder: '围棋九品', bigs: ['九品守拙', '八品若愚', '七品斗力', '六品小巧', '五品用智', '四品通幽', '三品具体', '二品坐照', '一品入神'], subs: ['初', '中', '后'], sep: '·', reserved: 1 },
  storm:    { name: '抗干扰',   ladder: '力量',     bigs: ['蛮力', '铜皮', '铁骨', '玉髓', '金身', '霸体', '法相', '涅槃', '至尊', '不灭'], subs: ['初', '中', '后'], sep: '·', reserved: 2 },
};

export const LINE_IDS = Object.keys(LINES);

export const TOTAL_BIGS = ['木头杂役', '石头凡徒', '黑铁行者', '青铜卫士', '白银执事', '黄金护法', '铂金卿相', '翡翠尊使', '紫晶洞主', '钻石真人', '星耀真君', '超凡尊者', '大师掌教', '宗师府主', '王者帝君', '主宰皇极', '史诗天尊', '传说神君', '神话始祖', '不朽冥尊', '超神虚皇'];
export const TOTAL_SUBS = ['IV', 'III', 'II', 'I'];

export const GRADES = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
export const XP_TIERS = { '无': 0, '微': 1, '小': 2, '中': 4, '大': 7 };
export const CASUAL_MAX_TIER = '小';
export const EXAM_RESULTS = ['突破', '半步', '未成'];

// 段位用整数下标表示：big * subs.length + sub
export function rankLabel(line, idx) {
  if (idx == null) return null;
  const L = LINES[line];
  const n = L.subs.length;
  return L.bigs[Math.floor(idx / n)] + L.sep + L.subs[idx % n];
}

export function rankLabels(line) {
  const L = LINES[line];
  const out = [];
  for (let i = 0; i < L.bigs.length * L.subs.length; i++) out.push(rankLabel(line, i));
  return out;
}

// 宽松匹配 AI 写的段位名（去空格、"·" 可有可无）
export function parseRank(line, text) {
  if (typeof text !== 'string') return null;
  const norm = (x) => x.replace(/[\s·・.]/g, '');
  const t = norm(text);
  const labels = rankLabels(line);
  const i = labels.findIndex((l) => norm(l) === t);
  return i < 0 ? null : i;
}

// 最上面 reserved 个大境界是“留着”的
export function isReserved(line, idx) {
  const L = LINES[line];
  return Math.floor(idx / L.subs.length) >= L.bigs.length - L.reserved;
}

export function isBigBoundary(line, idx) {
  // idx 升到 idx+1 是否跨大境界
  const n = LINES[line].subs.length;
  return (idx + 1) % n === 0;
}

// 修为条长度：小段 15，跨大境界 24（大境界突破更难）
export function xpCap(line, idx) {
  if (idx == null) return 15;
  return isBigBoundary(line, idx) ? 24 : 15;
}

export function totalLabel(idx) {
  if (idx == null) return null;
  return TOTAL_BIGS[Math.floor(idx / 4)] + ' ' + TOTAL_SUBS[idx % 4];
}

// ---------- 总段位：积分制，程序实时算 ----------
// 每组判定得分 = 修为档位的分（无 0、微 1、小 2、中 4、大 7）；定级 +5，半步 +3，突破 +10（跨大境界 +20）。
// 21 级 × 4 小段 × 5 星；第 L 级（从 0 数）每颗星要 2+L 分：开头几乎每组都涨星，越往上越慢，一年左右到顶。
export const TOTAL_STARS = 5;
export const POINTS = { placement: 5, half: 3, breakthrough: 10, bigBreakthrough: 20 };
export const starCost = (level) => 2 + level;

export function totalFromPoints(points) {
  let left = Math.max(0, Math.floor(points || 0));
  for (let level = 0; level < TOTAL_BIGS.length; level++) {
    const c = starCost(level);
    const perLevel = TOTAL_SUBS.length * TOTAL_STARS * c;
    if (left < perLevel || level === TOTAL_BIGS.length - 1) {
      const starsIn = Math.min(Math.floor(left / c), TOTAL_SUBS.length * TOTAL_STARS - 1);
      const sub = Math.floor(starsIn / TOTAL_STARS);
      const top = left >= perLevel;
      return {
        points: Math.floor(points || 0), idx: level * TOTAL_SUBS.length + sub, level, sub,
        stars: top ? TOTAL_STARS : starsIn % TOTAL_STARS,
        into: top ? c : left - starsIn * c, need: c, top,
        label: totalLabel(level * TOTAL_SUBS.length + sub),
      };
    }
    left -= perLevel;
  }
}

export function totalLabels() {
  const out = [];
  for (let i = 0; i < TOTAL_BIGS.length * 4; i++) out.push(totalLabel(i));
  return out;
}

export function parseTotal(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s/g, '');
  const i = totalLabels().findIndex((l) => l.replace(/\s/g, '') === t);
  return i < 0 ? null : i;
}

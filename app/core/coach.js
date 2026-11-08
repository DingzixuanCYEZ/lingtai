// AI 教练：拼提示词（按缓存友好的固定顺序）、调用 DeepSeek、校验并执行它的决定。
// 顺序：① 规则+输出格式 ② 段位释义 ③ 段位表 ④ 游戏说明 —— 全部固定
//       ⑤ 判例库+策略名册（只含今天以前的，当天不变） ⑥ 今天开始时的档案 ⑦ 当天对话依次追加

import { LINES, LINE_IDS, rankLabel, rankLabels, totalLabels, isReserved, isBigBoundary, xpCap, parseRank, GRADES, XP_TIERS, XP_SCALE, XP_BANDS, xpShow, roundXp, CASUAL_MAX_TIER, EXAM_RESULTS, POINTS, totalFromPoints } from './ranks.js';
import { getState, save, today, dayKey, hhmm, daysBetween } from './store.js';
import { chatJSON } from './api.js';
import { checkBlocks } from './blocks.js';

const RULES = `你是「灵台试炼」的教练兼考官。用户每天在这里玩几组智力游戏。你负责安排练什么、每组怎么练，判每组表现，并按《段位释义》主观判定段位。程序只执行你的决定，并检查你的输出是否合法。

## 你会收到的内容
1. 本说明、《段位释义》、段位表、游戏说明（固定不变）。
2. 判例库：以前每组的参数、数据、用户反馈和你当时的判定，按时间排列。判定口径要前后一致；要改口径，先在判词里说明理由。
3. 策略名册：你以前起过名的策略。
4. 用户偏好：你从用户的话里记下的偏好（以及用户自己加的），安排和措辞都要照顾到。当天新加或删掉的偏好，会在请求前面用【程序通知】告诉你，以通知为准。
5. 用户档案：今天开始时各线的段位、修为和状态。
6. 今天的对话：先是 plan 请求（今日清单），之后每玩完一组发一次 set 请求（本组判定）。

## 输出
每次只输出一个 json 对象，不要输出别的文字。键名和顺序照下面的格式。给用户看的话用“你”称呼用户，要简洁、具体，不说套话。

## 写给用户看的话（greeting、goal、direction、verdict、free_note、reply）
用户反映过：你说的话“非常不清楚”。这是最要紧的问题，宁可多写半句把话说明白，也不要写得短而含糊。
- 用户常常在手机上、刚玩完一组、有点累的时候看。每段话都要让用户扫一眼就知道：发生了什么、接下来做什么、为什么。
- 每一句都要单独看得懂。用户在开局页只看到这一组的 goal 和 direction，看不到清单、看不到你上一次的回复。不要写“清单第几项”“上一组说的”“按计划”“同上”“老样子”这类指代，要把意思直接写出来。
- 一句话只说一件事。先说结论，再说原因。说原因用“因为……所以……”把因果连起来，不要只摆现象让用户自己猜。
- 只用日常说法。不用心理学、训练学术语，不用内部字段名（如 lurePct、acc_old、intervalMs），不用你自己发明的说法（如“活队列”“重建”“负荷曲线”）。参数换成用户在屏幕上能感受到的东西：“N 从 3 加到 4（要记住 4 步之前的）”“每 2.5 秒出一个，比刚才快半秒”“多放一些容易混的：和 3 步、5 步前一样的”。
- 说数字要带上是什么：“位置对了 85%，字母对了 60%”，不要只写“85/60”或“acc 0.85”。一段话里最多两三个数字，挑最能说明问题的。
- 策略名册里的名字第一次对用户出现时，后面用括号带一句解释它是怎么做的。
- 段位、修为、评级要说成用户能懂的意思：“这组算 B，比你现在的段位该有的水平稍好”。
- direction 是能马上照做的具体做法，一到两句，只给一个要求，说清楚“做什么、怎么做”，例如“这组字母不要在心里念出来，只记它听起来像什么”。不要写“注意节奏”“保持专注”“稳住”这种不知道怎么照做的话。
- 用户不记得前面的对话，也不知道你脑子里的想法。要接着用户以前说过的话讲时，把用户当时的意思在这句里用大白话重说一遍（“你上一组说，方块在两三个格子之间来回跳的时候最容易乱”），不要写“你说的杂糅情况”这种只有你自己知道指什么的简称。不要给现象或做法起新名字；非起不可，就在同一句里解释，并且每次出现都解释。
- 提一个新练法之前，先在心里拿一串具体的刺激走一遍，确认这个办法在当前 N 下真的能用。写的时候也要带上这个例子：“比如方块依次出现在 左上、中间、左上、中间，……，这时你应该在第 4 个按位置键，因为……”。举不出例子、或者例子里说不通的练法，说明你自己也没想清楚，不要提，换一个简单的。
- 不确定的地方直接说不确定，并说你打算怎么确认（“再练两组看看是不是累了”），不要用含糊的话盖过去。
- 写完整、通顺的中文句子，不要电报体、不要省略主语和关键词、不要用顿号和箭头堆短语。游戏用中文名（双重N-back、规则风暴），模式说“认真”“休闲”，不要出现 focus、casual、dnb 这类英文字段值，也不要自己缩写（如 DN）。
- 例子。不好：“下组还在 3-back，专心对付你说的杂糅情况：几个格子来回交替时，别去理整条队列，只把位置按先后拆成‘交替的两串’分别记。”（“杂糅情况”“整条队列”“交替的两串”用户都不知道指什么；而且 3-back 要比的是 3 步前，正好落在另一串里，拆成两串反而对不上，方法本身就不对。）不好：“按清单第二项，N 加一档再加诱饵。活队列在 4-back 上重建会变慢，注意别崩。” 好：“这组从记 3 步前改成记 4 步前，间隔不变。刚开始会觉得记不住、乱，这是正常的；先保证位置按得准，字母错一些没关系。”
- 写完自己读一遍：一个没看过这些说明、也没看过前面对话的人，能不能一次读懂、马上照做？读不懂就重写。

## 小组件（blocks）
除了文字，你可以在回答里放小组件，程序会把它们画成能点、能动的东西，放在你的文字下面。写在 "blocks" 数组里，没有就写 []。plan 的每个任务（画在开局页）、set（画在判定页）、note（画在你的回复下面）都可以带。目前有两种：
1. 演示（只用于双重N-back）：讲一个练法、解释某一步该不该按、用户没看懂时，用一串具体的方块和字母演给用户看，比文字清楚得多。提新练法时尽量带一个。
{"type": "demo", "game": "dnb", "n": 3, "title": "一句话说这个例子演示什么", "steps": [{"pos": "左上", "letter": "c", "press": [], "note": ""}]}
- pos 只能用：左上、上、右上、左、中、右、左下、下、右下。letter 是单个英文字母；只演示位置时，每一步都不写 letter。
- press 写这一步该按的键："位置"、"字母"，都不按写 []。前 n 步永远是 []。
- note 写用户在这一步脑子里该怎么想，一句话；不重要的步可以留空，关键的几步一定要写。
- 一共 n+3 到 16 步，例子要正好演出你想说的情况。程序会逐步核对 press：有一步算错，整个演示就不给用户看，并在下次请求的【程序通知】里告诉你错在哪。所以写之前逐步核对：第 k 步只和第 k−n 步比。
2. 选项：{"type": "choices", "options": ["太难了", "刚好", "想换个练法"]}。2 到 4 个，每个不超过 20 个字，写用户最可能想回你的话（包括“没听懂为什么这样评”这类质疑）。用户点了，程序会把这句话作为 note 请求发给你。set 判定后一般都给一组。
- 有了演示，文字里不要再把例子逐步写一遍，写“看下面的演示”就行；但文字本身仍然要单独读得懂。

### note（用户主动跟你说话）
用户可以随时在首页跟你说话：提意见、说偏好、说今天的状态、问问题。只输出：
{"reply": "回复用户的话", "blocks": [], "prefs_add": [], "replan": false, "dev_suggestions": []}
- 用户对你的意见（例如“你说的我看不懂”“别安排这么多”）也是偏好，要记进 prefs_add，之后照做。
- replan：用户的话意味着今天的清单该重排（例如“今天很累”“我只有十分钟”），写 true，程序会让用户确认后重新请求 plan；否则 false。
- 用户点了“没看懂”或对你写的某段话提问时，请求里会引用那段话，格式多一个键：{"reply": "…", "new_direction": null, "blocks": [], "prefs_add": [], "replan": false, "dev_suggestions": []}。reply 先用一句话说你到底想让用户做什么，再按步骤讲，带一个屏幕上会出现的例子；用户问的是判定或标准，就直接回答依据，不要绕。重新想过后发现原来的练法说不通或太复杂，就承认，在 new_direction 里写新的一到两句练法（程序会替换掉原来的），否则 new_direction 写 null。用户没看懂的说法是哪一类（例如“自己起的名字”“没举例子”），记进 prefs_add，偏好里已有就不要重复。

### plan（今日清单）
{"greeting": "一两句开场", "tasks": [{"game": "dnb", "mode": "focus", "exam": false, "params": {"n": 3}, "goal": "这组想看到什么", "direction": "这组怎么练", "blocks": []}], "free_note": "清单做完后的自由练习建议", "total": null, "prefs_add": [], "dev_suggestions": []}
- tasks：今天的重要任务，2 到 5 项，按建议顺序排。game 只能用游戏说明里有的 id；档案里没有游戏的线不安排。mode 为 "focus"（认真）或 "casual"（休闲），游戏不支持休闲就只能是 focus。
- params 只写要改的参数，没写的沿用这个游戏上一组的参数（第一次玩用默认值）。数值必须在 paramSpec 范围内。
- goal：一句话，说这组练什么、为什么，例如“N 从 3 加到 4，看你记 4 步前的时候位置还能不能对八成”。direction：这组具体怎么做，例如“这组字母不要在心里念出来，只记位置在格子里的形状”。两句合起来要让用户不看别的东西也知道这组要干什么。
- 还没定级的线，先安排几组探底，在 goal 里说明是探底。
- 档案里 exam_ready=true 的线，你可以安排考核：该项写 "exam": true，goal 里说清考什么、想看到什么。其余项 exam 为 false。
- total：总段位由程序按积分实时算（每组按修为档位得分，定级、半步、突破另加分），你不定。档案里 total_review_due=true 时（每周一次）写 {"comment": "这一周的整体评语，两三句：哪条线进步了、哪条练得少、下周重点练什么"}，会显示在首页；否则为 null。
- prefs_add：要记进“用户偏好”的新条目，字符串数组，没有就写 []。见 set 里的说明。
- dev_suggestions：程序做不到但你想要的改动（新参数、新玩法、规则修改、发现的 bug），字符串数组，没有就写 []。不要假装已经做了。

### set（本组判定）
{"feedback_digest": "用户反馈的摘要", "grade": "C", "xp_tier": "小", "xp": 22, "verdict": "判词", "strategy_used": null, "new_strategy": null, "placement": null, "rank_adjust": null, "unstable": null, "exam_result": null, "next": {"params": {}, "direction": "下一组怎么练"}, "blocks": [], "prefs_add": [], "dev_suggestions": []}
- 用户的反馈主要写在 feedback.text 里，常常是语音转的文字，口语、有错字、顺序乱。focus/load/joy（0 到 10）、strategy、compliance 是选填项，大多为 null；用户在 text 里说到的疲劳、专注、负荷、心情、策略、有没有按要求练，你自己读出来。
- situation 是用户开局时自己写的具体情况（在干什么、在哪、身体状态，例如“在吃饭，单手”），选填，常为 null。判定、和以前的组比较时要考虑进去：情况差别大的组不要直接比高低，要比就找情况相近的组；情况明显拖了成绩时在 verdict 里说一句。判例库里写在“情况：”后面。
- feedback_digest：把用户这次的反馈压成一句话（例如“有点累，专注 6 左右；位置用编码，字母靠直觉；按要求做了”），存进判例库方便以后对比。没有反馈写 null。
- prefs_add：用户表达了以后都适用的偏好（例如“晚上不想练 DNB”“不喜欢太长的组”“喜欢先难后易”），用一句话记下来；名册和已有偏好里有的不要重复。一次性的感受不算偏好。没有就写 []。
- grade：F E D C B A S SS SSS 之一。相对当前段位评；还没定级就相对你估计的水平评。
- xp_tier：无 微 小 中 大 之一。休闲组最高“小”；根基不稳期间写“无”；考核组写“无”（考核结果写在 exam_result）。
- xp：这组加多少修为，整数，必须落在档位的范围里：无 0，微 5 到 14，小 15 到 29，中 30 到 54，大 55 到 80。修为条一个小段 150，跨大境界那段 240。在档位里按这组的实际表现细分，不要总写整十：同是“中”，刚够中的写 30 出头，差一点到大的写 50 出头。评 F 的组、定级当组、根基不稳期间、考核组，程序都不加修为。
- verdict：2 到 4 句，按这个顺序写：①这组结果怎么样，用一两个最关键的数字说（带上是什么）；②这说明什么：和你以前同样设置的组比是进步、持平还是退步，比的是哪天、什么设置，用大白话说，不列编号；如果用户的反馈改变了你对结果的理解（例如说了很累、没按要求练），在这里说；③下一组要做什么、为什么（一句）。评级和修为的理由也放在这几句里说清楚。
- strategy_used：本组用的策略在名册里的名字。名册里没有就新起一个短名（2 到 6 个字），同时写 new_strategy：{"name": "短名", "desc": "一句话描述"}。不涉及策略时两项都写 null。
- placement：这条线还没定级、你已心里有数时，写 {"rank": "段位表里的名字", "reason": "依据"}；否则 null。不能定到“留着”的段位。
- rank_adjust：已经定级，但发现定高或定低了，写 {"rank": "段位表里的名字", "reason": "依据"}；否则 null。定级满 14 天后，大境界不能往下调。
- unstable：要判“根基不稳”写 true，要解除写 false，不变写 null。
- exam_result：只有本组是考核组时写 {"result": "突破" | "半步" | "未成", "reason": "依据"}，否则 null。程序的处理：突破升一个小段、修为清零；半步保留八成修为，可以很快再考；未成，修为减半。
- next：这个游戏下一组的调整。params 只写要改的参数；direction 写下一组怎么练。
- dev_suggestions：同上。

## 判定原则（摘要，详见《段位释义》）
- 段位、修为、突破都由你主观判定，但要以数据为依据。看稳定性，不看单组最好成绩。
- 用户的反馈用来理解发生了什么、安排下一组，可以影响判词和“根基不稳”的判断。但只凭反馈，不能给突破，也不能抬高 grade 或 xp_tier。用户老实说没按要求练不扣分，按实际做法记录。
- display_prefs 是用户为了看着舒服调的显示设置（不改难度），一般不影响判定；明显相关时（例如关了计数）可以在判词里提一句。
- 当天清单做完后的自由练习，时间越晚，xp_tier 越要给低。
- 要让用户常常有盼头，但大境界的突破要难得。
- params 超出 paramSpec 范围时程序不会执行，只会记成开发建议。`;

// ---------- 固定前缀 ----------

let docText = null;
async function loadDoc() {
  if (docText) return docText;
  const r = await fetch(new URL('../../段位释义.md', import.meta.url));
  if (!r.ok) throw new Error('读不到 段位释义.md（请用 serve.mjs 从项目根目录启动）');
  let t = (await r.text()).replace(/\r\n/g, '\n');
  // “写给开发”的部分和旧的输出字段草案不给 AI
  const cut = t.indexOf('## 提示词顺序与缓存');
  if (cut > 0) t = t.slice(0, cut);
  docText = t.trim();
  return docText;
}

function rankTable() {
  const out = ['# 段位表（placement、rank_adjust、total 里只能用这些名字）'];
  for (const id of LINE_IDS) {
    const L = LINES[id];
    const kept = L.bigs.slice(L.bigs.length - L.reserved).join('、');
    out.push(`- ${id} ${L.name}（${L.ladder}）：${rankLabels(id).join('、')}。留着：${kept}`);
  }
  out.push(`- 总段位（程序按积分算，你不用定）：${totalLabels().join('、')}`);
  return out.join('\n');
}

function gameTable(games) {
  const out = ['# 游戏说明'];
  for (const g of games) {
    out.push(`## ${g.id} ${g.name}（线：${g.line}；休闲：${g.casual ? '支持' : '不支持'}）`);
    out.push(g.aiDescription);
    out.push('默认参数：' + JSON.stringify(g.defaults));
    out.push('paramSpec：' + JSON.stringify(g.paramSpec));
  }
  return out.join('\n');
}

async function systemPrompt(games) {
  return [RULES, '# 段位释义\n' + await loadDoc(), rankTable(), gameTable(games)].join('\n\n');
}

// ---------- 判例库、名册、档案 ----------

function fbText(s) {
  if (s.judgment?.feedback_digest) return '反馈：' + s.judgment.feedback_digest;
  const f = s.feedback;
  if (!f) return '反馈：无';
  const parts = [];
  for (const [k, name] of [['focus', '专注'], ['load', '负荷'], ['joy', '愉悦']]) if (f[k] != null) parts.push(name + f[k]);
  if (f.strategy) parts.push('策略：' + f.strategy);
  if (f.compliance) parts.push('按要求：' + f.compliance);
  if (f.text) parts.push('原话：' + f.text);
  return '反馈：' + (parts.join('；') || '无');
}

function caseLine(s) {
  const tags = [s.mode === 'casual' ? '休闲' : '认真'];
  if (s.exam) tags.push('考核');
  if (s.result.aborted) tags.push('中断');
  if (s.free) tags.push('自由练习');
  if (s.situation) tags.push('情况：' + s.situation);
  const j = s.judgment;
  let jt = '未判定';
  if (j) {
    jt = `评${j.grade} 修为${j.xp_tier}${j.xp ?  + j.xp : ''}`;
    if (j.strategy_used) jt += ` 策略「${j.strategy_used}」`;
    if (j.exam_result) jt += ` 考核${j.exam_result.result}`;
    if (j.placement) jt += ` 定级${j.placement.rank}`;
    jt += `｜${j.verdict}`;
  }
  return `- ${s.day} ${s.time} ${s.game}（${tags.join('·')}）｜参数${JSON.stringify(s.params)}｜练法：${s.direction || '-'}｜数据${JSON.stringify(s.result.summary)}｜${fbText(s)}｜${jt}`;
}

function history(day) {
  const st = getState();
  const past = st.sessions.filter((s) => s.day < day);
  const lines = ['# 判例库（今天以前，按时间）'];
  if (!past.length) lines.push('（还没有记录）');
  for (const s of past) lines.push(caseLine(s));
  lines.push('', '# 策略名册');
  const roster = st.roster.filter((r) => r.since < day);
  if (!roster.length) lines.push('（还没有）');
  for (const r of roster) lines.push(`- ${r.name}（${r.line}，${r.since} 起）：${r.desc}`);
  lines.push('', '# 用户偏好');
  const prefs = (st.prefsDoc || []).filter((p) => p.since < day);
  if (!prefs.length) lines.push('（还没有）');
  for (const p of prefs) lines.push(`- ${p.text}（${p.since}，${p.source === 'user' ? '用户自己写的' : '你记的'}）`);
  return lines.join('\n');
}

export function lineState(id) {
  const L = getState().lines[id];
  const cap = xpCap(id, L.rank);
  return {
    rank: L.rank == null ? '未定级' : rankLabel(id, L.rank),
    xp: L.rank == null ? null : `${xpShow(L.xp)}/${cap * XP_SCALE}`,
    exam_ready: L.rank != null && L.xp >= cap,
    unstable: L.unstable,
  };
}

// ---------- 总段位积分 ----------
// 老记录没存 points 的，按判定的档位和事件补算
export function sessionPoints(s) {
  if (!s.judgment) return 0;
  if (typeof s.applied?.points === 'number') return s.applied.points;
  let p = XP_TIERS[s.judgment.xp_tier] || 0;
  for (const e of s.applied?.events || []) {
    if (e.startsWith('定级')) p += POINTS.placement;
    else if (e.startsWith('突破')) p += POINTS.breakthrough;
    else if (e.startsWith('半步')) p += POINTS.half;
  }
  return p;
}

export function totalNow() {
  return totalFromPoints(getState().sessions.reduce((a, s) => a + sessionPoints(s), 0));
}

function totalDue(day) {
  const st = getState();
  if (st.sessions.length < 10) return false;
  return !st.total.reviewedAt || daysBetween(st.total.reviewedAt, day) >= 7;
}

function snapshot(games, day) {
  const st = getState();
  const lines = {};
  for (const id of LINE_IDS) {
    const L = st.lines[id];
    const ss = st.sessions.filter((s) => s.line === id);
    const last = ss.length ? ss[ss.length - 1].day : null;
    lines[id] = {
      name: LINES[id].name,
      games: games.filter((g) => g.line === id).map((g) => g.id),
      ...lineState(id),
      placed_at: L.placedAt,
      sets_total: ss.length,
      last_day: last,
      days_since_last: last ? daysBetween(last, day) : null,
    };
  }
  const wd = '日一二三四五六'[new Date(Date.parse(day)).getUTCDay()];
  return {
    date: day,
    weekday: '周' + wd,
    lines,
    total: (({ label, stars, points }) => ({ rank: label, stars, points, last_comment_at: st.total.reviewedAt }))(totalNow()),
    total_review_due: totalDue(day),
    sets_all: st.sessions.length,
  };
}

// ---------- 参数校验 ----------

export function clampParams(game, params) {
  const out = {}, problems = [];
  for (const [k, v] of Object.entries(params || {})) {
    const spec = game.paramSpec[k];
    if (!spec) { problems.push(`${game.id}：没有参数 ${k}（AI 想设为 ${JSON.stringify(v)}）`); continue; }
    if (spec.type === 'int') {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) { problems.push(`${game.id}.${k}=${JSON.stringify(v)} 超出范围 ${spec.min}–${spec.max}`); continue; }
      out[k] = n;
    } else if (spec.type === 'bool') {
      if (typeof v !== 'boolean') { problems.push(`${game.id}.${k}=${JSON.stringify(v)} 不是布尔值`); continue; }
      out[k] = v;
    } else if (spec.type === 'enum') {
      if (!spec.options.includes(v)) { problems.push(`${game.id}.${k}=${JSON.stringify(v)} 不在 ${spec.options.join('/')} 里`); continue; }
      out[k] = v;
    } else if (spec.type === 'set') {
      const arr = Array.isArray(v) ? v : [v];
      const bad = arr.filter((x) => !spec.options.includes(x));
      if (bad.length || !arr.length) { problems.push(`${game.id}.${k}=${JSON.stringify(v)} 含不支持的选项（可选 ${spec.options.join('/')}）`); continue; }
      out[k] = [...new Set(arr)];
    }
  }
  return { params: out, problems };
}

// 实际用于一组的完整参数：默认值 ← 上一组 ← 清单/AI 的调整
export function fullParams(game, patch) {
  const last = getState().lastParams?.[game.id] || {};
  const base = { ...game.defaults, ...last };
  const { params } = clampParams(game, { ...base, ...(patch || {}) });
  return { ...game.defaults, ...params };
}

function addSuggestions(day, list) {
  const st = getState();
  for (const t of list || []) if (typeof t === 'string' && t.trim()) st.suggestions.push({ day, text: t.trim() });
}

export function addPrefs(day, list, source = 'ai') {
  const st = getState();
  if (!st.prefsDoc) st.prefsDoc = [];
  for (const t of Array.isArray(list) ? list : []) {
    const text = typeof t === 'string' ? t.trim() : '';
    if (text && !st.prefsDoc.some((p) => p.text === text)) st.prefsDoc.push({ id: Date.now() + Math.random(), since: day, text, source });
  }
}

// ---------- 今日清单 ----------

export async function ensurePlan(games, { force = false, signal } = {}) {
  const st = getState();
  const day = dayKey();
  const d = today();
  if (d.plan && !force) return d.plan;
  // 旧日子的对话不再需要，只留最近 3 天，省存储
  for (const k of Object.keys(st.days)) if (k !== day && daysBetween(k, day) > 3) delete st.days[k].convo;
  if (!d.profile) d.profile = snapshot(games, day);
  // 重排时保留当天对话：用户刚说的话、已练的组都还在，前缀缓存也不断
  const req = force && d.convo?.length
    ? `【请求：plan】用户要求重新安排今天的清单。现在 ${hhmm()}。今天已经练过的组都在上面的对话里；新清单只排接下来要练的，照顾用户刚说过的话。只输出 json。`
    : `【请求：plan】今天是 ${day}（${d.profile.weekday}），现在 ${hhmm()}。请安排今日清单，只输出 json。`;
  const json = await ask(games, d, day, req, { thinking: thinkOn() || d.profile.total_review_due, kind: 'plan', signal });
  const plan = applyPlan(games, json, day, d.profile.total_review_due);
  plan.madeAt = Date.now(); // 两台设备同步时用来认出是不是同一份清单
  d.plan = plan;
  d.done = [];
  save();
  return plan;
}

// 默认所有调用都开思考模式（贵一点、慢一点，但安排和判词明显更好）；设置里可关
function thinkOn() { return getState().settings.thinking !== 'exam'; }

// 当天第一条 user 消息 = 判例库 + 名册 + 偏好 + 档案 + 请求；之后只追加请求。成功后才写进对话。
async function ask(games, d, day, req, opts) {
  if (!d.profile) d.profile = snapshot(games, day);
  if (!d.convo) d.convo = [];
  const notes = d.notes?.length ? `【程序通知】${d.notes.join('；')}\n` : '';
  const content = (d.convo.length ? '' : `${history(day)}\n\n# 用户档案（今天开始时）\n${JSON.stringify(d.profile)}\n\n`) + notes + req;
  const messages = [{ role: 'system', content: await systemPrompt(games) }, ...d.convo, { role: 'user', content }];
  const { json, raw } = await chatJSON(messages, opts);
  d.convo.push({ role: 'user', content }, { role: 'assistant', content: raw });
  d.notes = [];
  return json;
}

// 用户在设置里改了“我的偏好”等：随下一次请求告诉教练（今天的偏好不在固定前缀里）
// 教练给的组件：检查后返回能画的；不合法的丢掉，下次请求时告诉教练错在哪
function takeBlocks(raw, warn = []) {
  const { blocks, problems } = checkBlocks(raw);
  if (problems.length) {
    warn.push(...problems.map((p) => '组件没显示：' + p));
    queueNote(`你上次给的组件有 ${problems.length} 个没给用户看，原因：${problems.join('；')}。以后放演示前逐步核对。`);
  }
  return blocks;
}

export function queueNote(text) {
  const d = today();
  (d.notes ||= []).push(text);
  save();
}

// ---------- 跟教练说话 ----------

export async function talk(games, text, { signal, req, about } = {}) {
  const day = dayKey();
  const d = today();
  req ||= `【请求：note】现在 ${hhmm()}。用户说：${text}\n只输出 json。`;
  const json = await ask(games, d, day, req, { thinking: thinkOn(), kind: 'note', signal });
  addPrefs(day, json.prefs_add);
  addSuggestions(day, json.dev_suggestions);
  if (!d.talks) d.talks = [];
  const nd = typeof json.new_direction === 'string' && json.new_direction.trim() ? json.new_direction.trim() : null;
  const item = { ts: Date.now(), text, about: about || null, reply: String(json.reply || ''), blocks: takeBlocks(json.blocks), newDirection: nd, replan: !!json.replan, prefs: Array.isArray(json.prefs_add) ? json.prefs_add : [] };
  d.talks.push(item);
  save();
  return item;
}

// 用户对教练写的某段话说“没看懂”或提问。where 说明那段话出现在哪（例如“双重N-back 开局页的‘这组怎么练’”）
export function explain(games, { where, quoted, question = '', picked = false }, { signal } = {}) {
  const asked = question.trim();
  const req = `【请求：note】现在 ${hhmm()}。用户${picked ? '点了你给的选项' : asked ? '对你写的一段话有疑问' : '没看懂你写的一段话'}。` +
    `你写的那段话在${where}：「${quoted}」\n` +
    (picked ? `用户选的是：「${asked}」\n` : asked ? `用户问：${asked}\n` : '') +
    '请重新讲清楚：假设用户完全不记得之前的对话；不用术语、不用你起的名字；是练法就按步骤说并举一个屏幕上会出现的例子（双重N-back 的练法尽量放一个演示组件）。按 note 的格式输出 json（带 new_direction）。';
  const text = asked ? `关于「${quoted}」：${asked}` : `没看懂：「${quoted}」`;
  return talk(games, text, { signal, req, about: where });
}

function applyPlan(games, j, day, due) {
  const st = getState();
  const warn = [];
  const tasks = [];
  for (const t of Array.isArray(j.tasks) ? j.tasks : []) {
    const g = games.find((x) => x.id === t.game);
    if (!g) { warn.push(`清单里的游戏 ${t.game} 不存在，已跳过`); continue; }
    const { params, problems } = clampParams(g, t.params);
    warn.push(...problems);
    const ls = lineState(g.line);
    tasks.push({
      game: g.id,
      mode: t.mode === 'casual' && g.casual ? 'casual' : 'focus',
      exam: !!t.exam && ls.exam_ready,
      params,
      goal: String(t.goal || ''),
      direction: String(t.direction || ''),
      blocks: takeBlocks(t.blocks, warn),
    });
  }
  if (due && j.total && typeof j.total === 'object' && String(j.total.comment || '').trim()) {
    st.total.reviewedAt = day;
    st.total.comment = String(j.total.comment).trim();
  }
  addPrefs(day, j.prefs_add);
  addSuggestions(day, j.dev_suggestions);
  addSuggestions(day, warn.map((w) => '［程序］' + w));
  return {
    greeting: String(j.greeting || ''),
    tasks,
    free_note: String(j.free_note || ''),
    total: due && j.total ? j.total : null,
    warn,
  };
}

// ---------- 本组判定 ----------

export async function judge(games, session, { signal, displayPrefs = null } = {}) {
  const st = getState();
  const day = dayKey();
  const d = today();
  const game = games.find((g) => g.id === session.game);
  const listDone = d.plan ? d.done.length >= d.plan.tasks.length : false;
  const data = {
    time: hhmm(new Date(session.ts)),
    game: session.game,
    mode: session.mode,
    situation: session.situation || null,
    exam: session.exam,
    from: session.free ? '自由练习' : '今日清单',
    list_done_before_this: listDone && session.free,
    params: session.params,
    goal: session.goal || null,
    direction_given: session.direction || null,
    aborted: session.result.aborted,
    summary: session.result.summary,
    feedback: session.feedback,
    display_prefs: displayPrefs,
    line_state_before: lineState(game.line),
    sets_today_this_game: st.sessions.filter((s) => s.day === day && s.game === game.id && s.judgment).length,
  };
  const req = `【请求：set】只输出 json。\n${JSON.stringify(data)}`;
  const json = await ask(games, d, day, req, { thinking: thinkOn() || !!session.exam, kind: session.exam ? 'exam' : 'set', signal });
  const applied = applyJudgment(game, session, json, day);
  save();
  return applied;
}

function applyJudgment(game, session, j, day) {
  const st = getState();
  const L = st.lines[game.line];
  const warn = [], events = [];
  const before = L.rank;

  const grade = GRADES.includes(j.grade) ? j.grade : (warn.push(`grade“${j.grade}”不合法，按 C 记`), 'C');
  let tier = j.xp_tier in XP_TIERS ? j.xp_tier : (warn.push(`xp_tier“${j.xp_tier}”不合法，按 无 记`), '无');
  const capped = session.mode === 'casual' && XP_TIERS[tier] > XP_TIERS[CASUAL_MAX_TIER];
  if (capped) tier = CASUAL_MAX_TIER;

  if (j.unstable === true && !L.unstable) { L.unstable = true; events.push('根基不稳：暂停修为增长'); }
  if (j.unstable === false && L.unstable) { L.unstable = false; events.push('根基已稳'); }

  if (L.rank == null && j.placement && typeof j.placement === 'object') {
    const idx = parseRank(game.line, j.placement.rank);
    if (idx == null) warn.push(`定级“${j.placement.rank}”不在段位表里`);
    else if (isReserved(game.line, idx)) warn.push(`定级“${j.placement.rank}”是留着的段位，未执行`);
    else { L.rank = idx; L.placedAt = day; L.xp = 0; events.push(`定级：${rankLabel(game.line, idx)}`); }
  } else if (L.rank != null && j.rank_adjust && typeof j.rank_adjust === 'object') {
    const idx = parseRank(game.line, j.rank_adjust.rank);
    const n = LINES[game.line].subs.length;
    if (idx == null) warn.push(`调整段位“${j.rank_adjust.rank}”不在段位表里`);
    else if (isReserved(game.line, idx)) warn.push(`调整到留着的段位“${j.rank_adjust.rank}”，未执行`);
    else if (Math.floor(idx / n) < Math.floor(L.rank / n) && L.placedAt && daysBetween(L.placedAt, day) > 14) warn.push('定级满 14 天后大境界不能往下调，未执行');
    else if (idx !== L.rank) { events.push(`段位调整：${rankLabel(game.line, L.rank)} → ${rankLabel(game.line, idx)}`); L.rank = idx; L.xp = Math.min(L.xp, xpCap(game.line, idx)); }
  }

  // 档位范围内的具体修为（显示单位）：教练没给或给错了就用档位默认值
  const [lo, hi] = XP_BANDS[tier];
  const raw = j.xp == null || j.xp === '' ? NaN : Math.round(Number(j.xp));
  let xpShown = XP_TIERS[tier] * XP_SCALE;
  if (Number.isFinite(raw)) {
    if (raw >= lo && raw <= hi) xpShown = raw;
    else if (capped) xpShown = hi; // 休闲组档位被压到“小”，给的数也跟着压
    else if (tier !== '无') warn.push(`xp ${j.xp} 不在“${tier}”的范围 ${lo}–${hi} 里，按 ${xpShown} 记`);
  }

  let xpGain = 0;
  if (session.exam && L.rank != null) {
    const r = j.exam_result && EXAM_RESULTS.includes(j.exam_result.result) ? j.exam_result.result : null;
    if (!r) warn.push('考核组没有给出合法的 exam_result');
    else if (r === '突破') {
      const max = LINES[game.line].bigs.length * LINES[game.line].subs.length - 1;
      if (L.rank < max) { L.rank += 1; L.xp = 0; events.push(`突破！${rankLabel(game.line, before)} → ${rankLabel(game.line, L.rank)}`); }
    } else if (r === '半步') { L.xp = Math.round(xpCap(game.line, L.rank) * 0.8); events.push('半步：差一点，修为保留八成'); }
    else { L.xp = roundXp(L.xp / 2); events.push('未成：修为减半'); }
  } else if (L.rank != null && !L.unstable && grade !== 'F' && !events.some((e) => e.startsWith('定级'))) {
    const cap = xpCap(game.line, L.rank);
    xpGain = roundXp(Math.max(0, Math.min(xpShown / XP_SCALE, cap - L.xp)));
    L.xp = roundXp(L.xp + xpGain);
    if (L.xp >= cap) events.push('修为圆满，可以安排考核');
  }

  if (j.new_strategy && j.new_strategy.name && !st.roster.some((r) => r.name === j.new_strategy.name)) {
    st.roster.push({ name: String(j.new_strategy.name), line: game.line, desc: String(j.new_strategy.desc || ''), since: day });
  }

  const d = today();
  if (!d.next) d.next = {};
  const blocks = takeBlocks(j.blocks, warn);
  if (j.next && typeof j.next === 'object') {
    const { params, problems } = clampParams(game, j.next.params);
    warn.push(...problems);
    // 判定页的演示多半是在讲下一组的练法，开局页也带上
    d.next[game.id] = { params, direction: String(j.next.direction || ''), demos: blocks.filter((b) => b.type === 'demo'), ts: Date.now() };
  }
  addPrefs(day, j.prefs_add);
  addSuggestions(day, j.dev_suggestions);
  addSuggestions(day, warn.map((w) => '［程序］' + w));

  session.judgment = {
    feedback_digest: typeof j.feedback_digest === 'string' && j.feedback_digest.trim() ? j.feedback_digest.trim() : null,
    prefs_add: Array.isArray(j.prefs_add) ? j.prefs_add.filter((x) => typeof x === 'string') : [],
    grade, xp_tier: tier, xp: tier === '无' ? 0 : xpShown,
    verdict: String(j.verdict || ''),
    strategy_used: j.strategy_used || null,
    placement: j.placement || null,
    exam_result: session.exam ? j.exam_result || null : null,
    next: d.next[game.id] || null,
    blocks,
  };
  // 总段位积分：修为档位的分照拿（修为条满了也算），定级、半步、突破另加
  let points = grade === 'F' ? 0 : XP_TIERS[tier];
  for (const e of events) {
    if (e.startsWith('定级')) points += POINTS.placement;
    else if (e.startsWith('半步')) points += POINTS.half;
    else if (e.startsWith('突破')) points += isBigBoundary(game.line, before) ? POINTS.bigBreakthrough : POINTS.breakthrough;
  }
  const others = st.sessions.filter((s) => s !== session).reduce((a, s) => a + sessionPoints(s), 0);
  const t0 = totalFromPoints(others), t1 = totalFromPoints(others + points);
  if (t1.idx > t0.idx) events.push(`总段位升到 ${t1.label}`);
  session.applied = { xpGain, points, totalBefore: t0.label, totalAfter: t1.label, rankBefore: before, rankAfter: L.rank, events, warn };
  return session;
}

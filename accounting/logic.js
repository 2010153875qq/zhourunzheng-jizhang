/* 记账本纯逻辑：迁移、筛选、月度分析、预算、借贷与账单解析。浏览器与 node 测试共用。 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JZ = api;
})(function () {
  var KEY = 'jizhang_v1';
  var PHOTO_PREFIX = 'jizhang_v1_photo_';
  var VERSION = 3;
  var PRESET = {
    expense: ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他'],
    income: ['工资', '奖金', '理财', '红包', '其他']
  };
  var CAT_ICON = {
    '餐饮': '🍜', '交通': '🚌', '购物': '🛍️', '娱乐': '🎬', '居住': '🏠',
    '医疗': '💊', '教育': '📚', '其他': '✨', '工资': '💼', '奖金': '🎁',
    '理财': '📈', '红包': '🧧', '未分类': '📌'
  };
  var RULES = {
    expense: [
      ['餐饮', /餐|饭|食|外卖|美团|饿了么|咖啡|奶茶|茶饮|肯德基|麦当劳|星巴克|瑞幸|面包|烧烤|火锅|小吃|美食/],
      ['交通', /交通|出行|滴滴|打车|地铁|公交|加油|石化|石油|高铁|铁路|12306|航空|机票|停车|ETC|高速|单车|哈啰|曹操/i],
      ['居住', /房租|租金|物业|水费|电费|燃气|宽带|话费|充值缴费|生活缴费|住房|酒店|住宿/],
      ['医疗', /医|药|诊所|体检|健康/],
      ['教育', /学费|教育|课程|培训|书店|图书|文具|知识/],
      ['娱乐', /电影|影城|游戏|会员|视频|音乐|KTV|演出|门票|娱乐|休闲|爱奇艺|腾讯视频|优酷|网易云|Steam/i],
      ['购物', /淘宝|天猫|京东|拼多多|超市|商城|便利店|购物|日用|百货|服饰|数码|唯品会|盒马|山姆|商户消费/]
    ],
    income: [
      ['工资', /工资|薪|代发|劳务/],
      ['奖金', /奖金|奖励|绩效/],
      ['理财', /利息|收益|理财|基金|结息|余额宝|分红/],
      ['红包', /红包|转账|收款/]
    ]
  };
  var SKIP_STATUS = /关闭|失败|全额退款|退款成功|已撤销|撤销|已退款/;

  function catIcon(c) { return CAT_ICON[c] || '⭐'; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function monthKey(y, m) { return y + '-' + pad(m); }
  function monthName(y, m) { return y + '年' + m + '月'; }
  function centsOf(e) {
    var n = e && typeof e.cents === 'number' ? e.cents : Number(e && e.cents);
    return typeof n === 'number' && isFinite(n) ? n : 0;
  }
  function fmt(cents) {
    var n = Number(cents);
    if (typeof n !== 'number' || !isFinite(n)) n = 0;
    return (Math.abs(n) / 100).toFixed(2);
  }
  function money(cents) {
    var n = Number(cents);
    if (typeof n !== 'number' || !isFinite(n)) n = 0;
    return (n < 0 ? '-' : '') + '¥' + (Math.abs(n) / 100).toFixed(2);
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function formatMD(iso) {
    iso = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
    return iso.slice(5, 7) + '月' + iso.slice(8, 10) + '日';
  }
  function shiftMonth(y, m, delta) {
    var idx = (y * 12 + (m - 1)) + delta;
    var ny = Math.floor(idx / 12);
    return { y: ny, m: idx - ny * 12 + 1 };
  }
  function userCents(v) {
    v = String(v == null ? '' : v).replace(/\s/g, '').replace('，', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(v) || parseFloat(v) <= 0 || parseFloat(v) > 99999999) return null;
    var p = v.split('.');
    return parseInt(p[0], 10) * 100 + (p[1] ? parseInt((p[1] + '0').slice(0, 2), 10) : 0);
  }
  function positiveCents(v) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return 0;
    return Math.round(n);
  }

  function normalize(d) {
    if (!d || typeof d !== 'object' || d instanceof Array) throw new Error('bad');
    if (!(d.entries instanceof Array)) throw new Error('bad');
    if (!d.custom || typeof d.custom !== 'object' || d.custom instanceof Array) d.custom = {};
    if (!(d.custom.expense instanceof Array)) d.custom.expense = [];
    if (!(d.custom.income instanceof Array)) d.custom.income = [];
    if (!(d.loans instanceof Array)) d.loans = [];
    if (!d.budgets || typeof d.budgets !== 'object' || d.budgets instanceof Array) d.budgets = { months: {} };
    if (!d.budgets.months || typeof d.budgets.months !== 'object' || d.budgets.months instanceof Array) d.budgets.months = {};
    d.version = VERSION;
    return d;
  }
  function prepareBackup(text) {
    var d = JSON.parse(text);
    if (!d || typeof d !== 'object' || d instanceof Array) throw new Error('bad');
    var photos = (d.photos && typeof d.photos === 'object' && !(d.photos instanceof Array)) ? d.photos : null;
    delete d.photos;
    return { db: normalize(d), photos: photos };
  }
  function exportPayload(db, photos) {
    var data = JSON.parse(JSON.stringify(db));
    delete data.photos;
    if (photos && typeof photos === 'object') data.photos = photos;
    return data;
  }
  function isOwnStorageKey(k) {
    k = String(k || '');
    return k === KEY || k.indexOf(PHOTO_PREFIX) === 0;
  }
  function categories(db, type) {
    var extra = (db && db.custom && db.custom[type]) || [];
    return (PRESET[type] || []).concat(extra);
  }
  function recentCategories(entries, type, limit) {
    var sorted = (entries || []).filter(function (e) { return e && e.type === type && e.cat; });
    sorted.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    var out = [], seen = {}, i, cap = limit || 4;
    for (i = 0; i < sorted.length && out.length < cap; i++) {
      if (seen[sorted[i].cat]) continue;
      seen[sorted[i].cat] = 1;
      out.push(sorted[i].cat);
    }
    return out;
  }
  function entryHaystack(e) {
    var abs = Math.abs(Math.round(centsOf(e)));
    var y = (abs / 100).toFixed(2);
    var shortY = y.replace(/0+$/, '').replace(/\.$/, '');
    return [
      e.cat || '',
      e.note || '',
      e.date || '',
      e.date ? formatMD(e.date) : '',
      e.type === 'income' ? '收入' : e.type === 'expense' ? '支出' : '',
      y,
      shortY
    ].join(' ');
  }
  function filterEntries(entries, opt) {
    opt = opt || {};
    var text = String(opt.text || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    var type = opt.type || '';
    var cat = opt.cat || '';
    var month = opt.month || '';
    return (entries || []).filter(function (e) {
      if (!e) return false;
      if (type && e.type !== type) return false;
      if (cat && e.cat !== cat) return false;
      if (month && (!e.date || String(e.date).slice(0, 7) !== month)) return false;
      if (text && entryHaystack(e).toLowerCase().indexOf(text) < 0) return false;
      return true;
    });
  }
  function listMonths(entries) {
    var seen = {}, out = [];
    (entries || []).forEach(function (e) {
      if (!e || !e.date) return;
      var k = String(e.date).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(k) || seen[k]) return;
      seen[k] = 1;
      out.push(k);
    });
    out.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    return out;
  }
  function totals(entries) {
    var income = 0, expense = 0;
    (entries || []).forEach(function (e) {
      if (!e) return;
      if (e.type === 'income') income += centsOf(e);
      else if (e.type === 'expense') expense += centsOf(e);
    });
    return { income: income, expense: expense, balance: income - expense };
  }
  function monthEntries(entries, y, m) {
    var k = monthKey(y, m);
    return (entries || []).filter(function (e) { return e && e.date && String(e.date).slice(0, 7) === k; });
  }
  function categoryBreakdown(entries, type) {
    var map = {}, sum = 0;
    (entries || []).forEach(function (e) {
      if (!e || e.type !== type) return;
      var name = e.cat || '未分类';
      var c = centsOf(e);
      map[name] = (map[name] || 0) + c;
      sum += c;
    });
    var rows = [];
    Object.keys(map).forEach(function (cat) {
      rows.push({ cat: cat, cents: map[cat], pct: sum ? round1(map[cat] / sum * 100) : 0 });
    });
    rows.sort(function (a, b) {
      if (b.cents !== a.cents) return b.cents - a.cents;
      return a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0;
    });
    return { sum: sum, rows: rows };
  }
  function dailySeries(entries, y, m, type) {
    var n = new Date(y, m, 0).getDate();
    var days = [], d, max = 0, peakDays = [];
    for (d = 0; d < n; d++) days.push(0);
    var key = monthKey(y, m);
    (entries || []).forEach(function (e) {
      if (!e || e.type !== type || !e.date || String(e.date).slice(0, 7) !== key) return;
      var day = parseInt(String(e.date).slice(8, 10), 10);
      if (day >= 1 && day <= n) days[day - 1] += centsOf(e);
    });
    for (d = 0; d < n; d++) {
      if (days[d] > max) { max = days[d]; peakDays = [d + 1]; }
      else if (max > 0 && days[d] === max) peakDays.push(d + 1);
    }
    return { days: days, max: max, peakDays: max ? peakDays : [], peakCents: max };
  }
  function calendarCells(y, m, days) {
    var first = new Date(y, m - 1, 1).getDay();
    var lead = (first + 6) % 7;
    var cells = [], i, d;
    for (i = 0; i < lead; i++) cells.push(null);
    for (d = 0; d < days.length; d++) cells.push({ day: d + 1, cents: days[d] || 0 });
    return { lead: lead, cells: cells, weekStart: 'monday' };
  }
  function heatLevel(cents, max) {
    if (!cents || !max) return 0;
    if (cents === max) return 4;
    var r = cents / max;
    if (r > 0.66) return 3;
    if (r > 0.33) return 2;
    return 1;
  }
  function largest(entries, type) {
    var best = 0, items = [];
    (entries || []).forEach(function (e) {
      if (!e || e.type !== type) return;
      var c = centsOf(e);
      if (c > best) { best = c; items = [e]; }
      else if (c === best && c > 0) items.push(e);
    });
    if (!best) return null;
    return { cents: best, items: items };
  }
  function changeClause(name, cur, prev) {
    var d = cur - prev;
    if (d === 0) return name + '与上月相同（' + money(cur) + '）';
    if (prev <= 0) return name + '上月为 ' + money(prev) + '，本月 ' + money(cur);
    var pctNum = round1(d / prev * 100);
    var pct = (pctNum > 0 ? '+' : '') + pctNum.toFixed(1) + '%';
    return name + '比上月' + (d > 0 ? '多 ' : '少 ') + money(Math.abs(d)) + '（' + pct + '）';
  }
  function catSentence(kind, pack) {
    var rows = pack.rows;
    var top = rows[0].cents;
    var tops = rows.filter(function (r) { return r.cents === top; });
    if (tops.length === 1) {
      return kind + '最多的分类是' + tops[0].cat + '，占 ' + tops[0].pct.toFixed(1) + '%（' + money(tops[0].cents) + '）';
    }
    return kind + '最多的分类是' + tops.map(function (r) { return r.cat; }).join('、') + '，金额同为 ' + money(top) + '（各占 ' + tops[0].pct.toFixed(1) + '%）';
  }
  function txSentence(kind, pack) {
    var items = pack.items.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.ts || 0) - (a.ts || 0);
    });
    var sample = items[0];
    var note = sample.note ? '，备注「' + sample.note + '」' : '';
    if (items.length === 1) {
      return '最大的一笔' + kind + '是 ' + formatMD(sample.date) + ' ' + sample.cat + ' ' + money(sample.cents) + note;
    }
    return '最大的' + kind + '有 ' + items.length + ' 笔并列，金额均为 ' + money(pack.cents) + '；最近的一笔是 ' + formatMD(sample.date) + ' ' + sample.cat + note;
  }
  function peakSentence(y, m, daily) {
    var labels = daily.peakDays.map(function (d) { return formatMD(monthKey(y, m) + '-' + pad(d)); });
    if (daily.peakDays.length === 1) return '花费最高的一天是 ' + labels[0] + '，当天支出 ' + money(daily.peakCents);
    return '花费最高的是 ' + labels.join('、') + '，当天支出均为 ' + money(daily.peakCents);
  }
  function compareSentence(prevM, curT, prevT) {
    return '与' + monthName(prevM.y, prevM.m) + '相比：' +
      changeClause('支出', curT.expense, prevT.expense) + '；' +
      changeClause('收入', curT.income, prevT.income) + '；' +
      changeClause('结余', curT.balance, prevT.balance) + '。';
  }
  function monthBrief(entries, y, m) {
    var curList = monthEntries(entries, y, m);
    var prevM = shiftMonth(y, m, -1);
    var prevList = monthEntries(entries, prevM.y, prevM.m);
    var curT = totals(curList);
    var prevT = totals(prevList);
    var exp = categoryBreakdown(curList, 'expense');
    var inc = categoryBreakdown(curList, 'income');
    var daily = dailySeries(entries, y, m, 'expense');
    var largestE = largest(curList, 'expense');
    var largestI = largest(curList, 'income');
    var text;
    if (!curList.length) {
      text = monthName(y, m) + '还没有记账。';
      if (prevList.length) text += compareSentence(prevM, curT, prevT);
    } else {
      var parts = [monthName(y, m) + '：收入 ' + money(curT.income) + '，支出 ' + money(curT.expense) + '，结余 ' + money(curT.balance) + '。'];
      if (curT.expense > 0) {
        parts.push(catSentence('支出', exp) + '。');
        parts.push(txSentence('支出', largestE) + '。');
        if (daily.peakCents > 0) parts.push(peakSentence(y, m, daily) + '。');
      } else parts.push('本月没有支出。');
      if (curT.income > 0) {
        parts.push(catSentence('收入', inc) + '。');
        parts.push(txSentence('收入', largestI) + '。');
      }
      parts.push(compareSentence(prevM, curT, prevT));
      text = parts.join('');
    }
    return {
      y: y, m: m, key: monthKey(y, m), prev: prevM,
      totals: curT, prevTotals: prevT,
      expenseCats: exp.rows, incomeCats: inc.rows,
      daily: daily, largestExpense: largestE, largestIncome: largestI,
      text: text
    };
  }
  function heroLine(brief) {
    var cur = brief.totals, prev = brief.prevTotals;
    if (!cur.income && !cur.expense && !prev.income && !prev.expense) return '本月还没有记账';
    return changeClause('支出', cur.expense, prev.expense) + '；' + changeClause('收入', cur.income, prev.income);
  }

  function ensureBudgets(db) {
    if (!db.budgets || typeof db.budgets !== 'object') db.budgets = { months: {} };
    if (!db.budgets.months || typeof db.budgets.months !== 'object') db.budgets.months = {};
  }
  function budgetTone(type, state) {
    if (type === 'income') return state === 'none' ? 'neutral' : 'income';
    if (state === 'over') return 'expense-over';
    if (state === 'none') return 'neutral';
    return 'expense';
  }
  function budgetLabel(row, type) {
    var spent = (type === 'income' ? '本月已入 ' : '本月已花 ') + money(row.spent);
    if (row.state === 'none') return spent + (type === 'income' ? ' · 未设目标' : ' · 未设限额');
    if (type === 'income') {
      if (row.state === 'progress') return spent + ' · 还差 ' + money(row.remaining);
      if (row.spent === row.limit) return spent + ' · 已达成目标';
      return spent + ' · 已超过目标 ' + money(row.spent - row.limit);
    }
    if (row.state === 'over') return spent + ' · 已超 ' + money(row.spent - row.limit);
    if (row.state === 'met') return spent + ' · 限额已用完';
    return spent + ' · 剩余 ' + money(row.remaining);
  }
  function budgetRows(db, entries, monthKeyStr, type, cats) {
    var box = db && db.budgets && db.budgets.months && db.budgets.months[monthKeyStr];
    var map = (box && box[type]) || {};
    var spent = {};
    (entries || []).forEach(function (e) {
      if (!e || e.type !== type || !e.date || String(e.date).slice(0, 7) !== monthKeyStr) return;
      var c = e.cat || '未分类';
      spent[c] = (spent[c] || 0) + centsOf(e);
    });
    var order = [], seen = {};
    function add(c) { if (!c || seen[c]) return; seen[c] = 1; order.push(c); }
    (cats || []).forEach(add);
    Object.keys(spent).forEach(add);
    Object.keys(map).forEach(function (c) { if (positiveCents(map[c]) > 0) add(c); });
    return order.map(function (cat) {
      var limit = positiveCents(map[cat]);
      var use = spent[cat] || 0;
      var row = { cat: cat, spent: use, limit: limit, remaining: null, ratio: null, state: 'none' };
      if (limit) {
        row.remaining = limit - use;
        row.ratio = use / limit;
        if (type === 'income') row.state = use >= limit ? 'met' : 'progress';
        else row.state = use > limit ? 'over' : use === limit ? 'met' : 'ok';
      }
      row.tone = budgetTone(type, row.state);
      row.label = budgetLabel(row, type);
      return row;
    });
  }
  function setMonthBudget(db, monthKeyStr, type, cat, cents) {
    if ((type !== 'expense' && type !== 'income') || !cat) return;
    ensureBudgets(db);
    if (!db.budgets.months[monthKeyStr]) db.budgets.months[monthKeyStr] = {};
    var box = db.budgets.months[monthKeyStr];
    if (!box[type]) box[type] = {};
    var n = positiveCents(cents);
    if (!n) delete box[type][cat];
    else box[type][cat] = n;
  }
  function copyBudgets(db, fromKey, toKey) {
    ensureBudgets(db);
    var src = db.budgets.months[fromKey];
    if (!src) return false;
    var has = false, ti, types = ['expense', 'income'], m, k;
    for (ti = 0; ti < types.length; ti++) {
      m = src[types[ti]] || {};
      for (k in m) if (Object.prototype.hasOwnProperty.call(m, k) && positiveCents(m[k]) > 0) has = true;
    }
    if (!has) return false;
    db.budgets.months[toKey] = JSON.parse(JSON.stringify({
      expense: src.expense || {},
      income: src.income || {}
    }));
    return true;
  }
  function monthHasBudget(db, monthKeyStr) {
    var box = db && db.budgets && db.budgets.months && db.budgets.months[monthKeyStr];
    if (!box) return false;
    var types = ['expense', 'income'], ti, m, k;
    for (ti = 0; ti < types.length; ti++) {
      m = box[types[ti]] || {};
      for (k in m) if (Object.prototype.hasOwnProperty.call(m, k) && positiveCents(m[k]) > 0) return true;
    }
    return false;
  }

  function loanReport(loans) {
    var owedMe = 0, iOwe = 0, openOut = 0, openIn = 0, repaid = 0, people = {};
    (loans || []).forEach(function (l) {
      if (!l || !l.person) return;
      var p = people[l.person];
      if (!p) {
        p = people[l.person] = {
          person: l.person, openOut: 0, openIn: 0, openOutN: 0, openInN: 0, repaidN: 0
        };
      }
      if (l.repaid) { repaid++; p.repaidN++; return; }
      if (l.dir === 'out') { owedMe += centsOf(l); openOut++; p.openOut += centsOf(l); p.openOutN++; }
      else { iOwe += centsOf(l); openIn++; p.openIn += centsOf(l); p.openInN++; }
    });
    var list = Object.keys(people).map(function (name) {
      var p = people[name];
      p.net = p.openOut - p.openIn;
      p.openCount = p.openOutN + p.openInN;
      if (p.net > 0) { p.status = 'owed'; p.statusText = '待收回'; }
      else if (p.net < 0) { p.status = 'owing'; p.statusText = '待归还'; }
      else if (p.openCount > 0) { p.status = 'offset'; p.statusText = '已抵平'; }
      else { p.status = 'settled'; p.statusText = '已结清'; }
      return p;
    });
    list.sort(function (a, b) {
      var ao = a.openCount ? 0 : 1, bo = b.openCount ? 0 : 1;
      if (ao !== bo) return ao - bo;
      var an = Math.abs(a.net), bn = Math.abs(b.net);
      if (bn !== an) return bn - an;
      return a.person < b.person ? -1 : a.person > b.person ? 1 : 0;
    });
    var net = owedMe - iOwe;
    return {
      owedMe: owedMe, iOwe: iOwe, net: net,
      netText: net > 0 ? '别人还欠我' : net < 0 ? '我还欠别人' : '已两清',
      openOutCount: openOut, openInCount: openIn, repaidCount: repaid,
      people: list
    };
  }

  function clean(c) { return String(c == null ? '' : c).replace(/^[\s\uFEFF\u00A0]+|[\s\u00A0]+$/g, ''); }
  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], f = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.map(function (r) { return r.map(clean); });
  }
  function parseAmt(s) {
    s = clean(s).replace(/[¥￥,，元\s]/g, '');
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
    var v = Math.round(parseFloat(s) * 100);
    return neg ? -v : v;
  }
  function parseDate(s) {
    s = clean(s);
    var m = s.match(/(\d{4})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  function findCol(hdr, kws, excl) {
    var i, k, h;
    for (k = 0; k < kws.length; k++) for (i = 0; i < hdr.length; i++) if (String(hdr[i] || '').toLowerCase() === kws[k]) return i;
    for (k = 0; k < kws.length; k++) for (i = 0; i < hdr.length; i++) {
      h = String(hdr[i] || '').toLowerCase();
      if (h && h.indexOf(kws[k]) >= 0 && !(excl && excl.test(h))) return i;
    }
    return -1;
  }
  function findCols(hdr, kws) {
    var out = [];
    kws.forEach(function (k) { var i = findCol(hdr, [k]); if (i >= 0 && out.indexOf(i) < 0) out.push(i); });
    return out;
  }
  function guessCat(type, text, categories) {
    text = String(text || '');
    var rules = RULES[type] || [], i;
    for (i = 0; i < rules.length; i++) if (rules[i][1].test(text)) return rules[i][0];
    var cs = categories || [];
    for (i = 0; i < cs.length; i++) if (cs[i] !== '其他' && cs[i] && text.indexOf(cs[i]) >= 0) return cs[i];
    return '其他';
  }
  function mapRows(rows, h, c, categoriesByType) {
    var out = [], skipped = 0, r, row, date, type, cents, parts, note, hay;
    categoriesByType = categoriesByType || {};
    for (r = h + 1; r < rows.length; r++) {
      row = rows[r]; if (!row) continue;
      date = parseDate(row[c.date] || ''); if (!date) continue;
      if (c.status >= 0 && SKIP_STATUS.test(row[c.status] || '')) { skipped++; continue; }
      type = null; cents = null;
      if (c.io >= 0) {
        var io = clean(row[c.io]);
        if (/收入|^收$|^贷$|贷方/.test(io)) type = 'income';
        else if (/支出|^支$|^借$|借方/.test(io)) type = 'expense';
        else continue;
        cents = parseAmt(row[c.amount]); if (cents === null) continue; cents = Math.abs(cents);
      } else if (c.inc >= 0 && c.exp >= 0) {
        var a = parseAmt(row[c.inc]), b = parseAmt(row[c.exp]);
        if (a) { type = 'income'; cents = Math.abs(a); }
        else if (b) { type = 'expense'; cents = Math.abs(b); }
        else continue;
      } else {
        cents = parseAmt(row[c.amount]); if (!cents) continue;
        type = cents < 0 ? 'expense' : 'income'; cents = Math.abs(cents);
      }
      if (!cents) continue;
      parts = [];
      (c.desc || []).forEach(function (i) {
        var v = clean(row[i]); if (v && v !== '/' && parts.indexOf(v) < 0) parts.push(v);
      });
      note = parts.join(' ').slice(0, 50);
      hay = (c.cat >= 0 ? clean(row[c.cat]) + ' ' : '') + note;
      out.push({
        type: type, cents: cents, date: date, note: note,
        cat: guessCat(type, hay, categoriesByType[type] || PRESET[type])
      });
    }
    return { items: out, skipped: skipped };
  }
  function detect(rows) {
    var lim = Math.min(rows.length, 60), r, hdr, tCol, ioCol, wx, d, inc, exp, amt, io;
    for (r = 0; r < lim; r++) {
      hdr = rows[r]; if (!hdr || hdr.length < 3) continue;
      tCol = findCol(hdr, ['交易时间', '交易创建时间', '付款时间']);
      ioCol = findCol(hdr, ['收/支', '收支']);
      if (tCol >= 0 && ioCol >= 0) {
        wx = findCol(hdr, ['当前状态']) >= 0 || (findCol(hdr, ['支付方式']) >= 0 && findCol(hdr, ['交易类型']) >= 0);
        return {
          name: wx ? '微信支付账单' : '支付宝账单', header: r,
          cols: {
            date: tCol, io: ioCol,
            amount: findCol(hdr, ['金额(元)', '金额（元）', '金额'], /余额/),
            status: findCol(hdr, wx ? ['当前状态'] : ['交易状态']),
            inc: -1, exp: -1,
            cat: findCol(hdr, wx ? ['交易类型'] : ['交易分类', '类型']),
            desc: findCols(hdr, ['交易对方', '商品说明', '商品名称', '商品'])
          }
        };
      }
    }
    for (r = 0; r < lim; r++) {
      hdr = rows[r]; if (!hdr || hdr.length < 2) continue;
      d = findCol(hdr, ['交易日期', '记账日期', '交易时间', '入账日期', '日期', '时间', 'date', 'transaction date']);
      if (d < 0) continue;
      inc = findCol(hdr, ['收入金额', '贷方金额', '收入', '贷方发生额', '贷方', 'credit'], /余额/);
      exp = findCol(hdr, ['支出金额', '借方金额', '支出', '借方发生额', '借方', 'debit'], /余额/);
      amt = findCol(hdr, ['交易金额', '发生额', '金额', 'amount'], /余额|balance/);
      io = findCol(hdr, ['收/支', '收支', '借贷标志', '借贷', '收付']);
      if (inc === exp) inc = exp = -1;
      if (amt < 0 && (inc < 0 || exp < 0)) continue;
      return {
        name: '银行流水（通用）', header: r,
        cols: {
          date: d, amount: amt,
          inc: amt >= 0 && io >= 0 ? -1 : inc,
          exp: amt >= 0 && io >= 0 ? -1 : exp,
          io: amt >= 0 ? io : -1,
          status: findCol(hdr, ['交易状态', '状态']),
          cat: -1,
          desc: findCols(hdr, ['摘要', '交易摘要', '对方户名', '对方账户名', '交易对方', '对方', '备注', '附言', '用途', '交易类型', 'description', 'memo'])
        }
      };
    }
    return null;
  }
  function dupKey(e) { return (e.date || '') + '|' + (e.cents || 0) + '|' + (e.note || ''); }
  function markDuplicates(items, entries) {
    var keys = {};
    (entries || []).forEach(function (e) { keys[dupKey(e)] = 1; });
    return (items || []).map(function (it) {
      var dup = !!keys[dupKey(it)];
      return {
        type: it.type, cents: it.cents, date: it.date, note: it.note, cat: it.cat,
        dup: dup, on: it.on != null ? !!it.on : !dup
      };
    });
  }

  return {
    KEY: KEY, PHOTO_PREFIX: PHOTO_PREFIX, VERSION: VERSION, PRESET: PRESET,
    catIcon: catIcon, pad: pad, monthKey: monthKey, monthName: monthName, shiftMonth: shiftMonth,
    fmt: fmt, money: money, formatMD: formatMD, userCents: userCents,
    normalize: normalize, prepareBackup: prepareBackup, exportPayload: exportPayload, isOwnStorageKey: isOwnStorageKey,
    categories: categories, recentCategories: recentCategories, filterEntries: filterEntries, listMonths: listMonths,
    totals: totals, monthEntries: monthEntries, categoryBreakdown: categoryBreakdown,
    dailySeries: dailySeries, calendarCells: calendarCells, heatLevel: heatLevel, largest: largest,
    monthBrief: monthBrief, heroLine: heroLine, changeClause: changeClause,
    budgetRows: budgetRows, budgetTone: budgetTone, setMonthBudget: setMonthBudget, copyBudgets: copyBudgets, monthHasBudget: monthHasBudget,
    loanReport: loanReport,
    clean: clean, parseCSV: parseCSV, parseAmt: parseAmt, parseDate: parseDate, findCol: findCol,
    guessCat: guessCat, mapRows: mapRows, detect: detect, dupKey: dupKey, markDuplicates: markDuplicates
  };
});

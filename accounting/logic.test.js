/* 运行：node accounting/logic.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var JZ = require('./logic.js');
var passed = 0;
function eq(a, b, msg) { assert.strictEqual(a, b, msg || (JSON.stringify(a) + ' !== ' + JSON.stringify(b))); passed++; }
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

(function migration() {
  var raw = {
    entries: [{ id: 'a', ts: 1, type: 'expense', cents: 3680, cat: '餐饮', date: '2026-11-05', note: '午餐', photo: true }],
    custom: { expense: ['宠物'], income: ['稿费'] },
    loans: [{ id: 'l', ts: 2, dir: 'out', person: '张三', cents: 5000, date: '2026-11-01', note: '饭钱', repaid: false, repaidDate: '' }],
    version: 2,
    nickname: '保留'
  };
  var db = JZ.normalize(raw);
  eq(db.entries[0].cents, 3680);
  eq(db.entries[0].photo, true);
  eq(db.entries[0].note, '午餐');
  eq(db.custom.expense[0], '宠物');
  eq(db.custom.income[0], '稿费');
  eq(db.loans[0].person, '张三');
  eq(db.loans[0].repaid, false);
  eq(db.nickname, '保留');
  eq(db.version, 3);
  ok(db.budgets.months && typeof db.budgets.months === 'object');
  var repaired = JZ.normalize({ entries: [{ id: 'b', cents: 1 }] });
  eq(repaired.loans.length, 0);
  eq(repaired.custom.expense.length, 0);
  assert.throws(function () { JZ.normalize(null); });
  assert.throws(function () { JZ.normalize({ loans: [] }); });
  passed += 2;

  var old = JSON.stringify({
    entries: [{ id: 'a', type: 'expense', cents: 100, cat: '餐饮', date: '2026-11-01', note: '', photo: true, ts: 1 }],
    custom: { expense: ['宠物'], income: [] },
    loans: [{ id: 'l', dir: 'out', person: '张三', cents: 500, date: '2026-11-01', note: '', repaid: false, repaidDate: '', ts: 1 }],
    version: 2,
    photos: { a: 'data:image/jpeg;base64,xx' }
  });
  var imported = JZ.prepareBackup(old);
  eq(imported.db.entries[0].cat, '餐饮');
  eq(imported.db.entries[0].photo, true);
  eq(imported.db.loans[0].person, '张三');
  eq(imported.db.custom.expense[0], '宠物');
  eq(imported.db.photos, undefined);
  eq(imported.photos.a, 'data:image/jpeg;base64,xx');
  var payload = JZ.exportPayload(imported.db, imported.photos);
  eq(payload.loans[0].person, '张三');
  eq(payload.entries[0].cents, 100);
  eq(payload.photos.a.indexOf('data:image') >= 0, true);
  ok(payload.budgets.months);
  var bare = JZ.exportPayload(imported.db, null);
  eq(bare.photos, undefined);
  eq(bare.loans.length, 1);
})();

(function moneyAndInput() {
  eq(JZ.userCents('25.5'), 2550);
  eq(JZ.userCents('25.50'), 2550);
  eq(JZ.userCents('25，5'), 2550);
  eq(JZ.userCents('0'), null);
  eq(JZ.userCents('-1'), null);
  eq(JZ.userCents('1.234'), null);
  eq(JZ.userCents(''), null);
  eq(JZ.userCents('abc'), null);
  eq(JZ.fmt(3680), '36.80');
  eq(JZ.money(4680), '¥46.80');
  eq(JZ.money(-5000), '-¥50.00');
  eq(JZ.shiftMonth(2026, 1, -1).y, 2025);
  eq(JZ.shiftMonth(2026, 1, -1).m, 12);
})();

(function filters() {
  var entries = [
    { id: '1', ts: 1, type: 'expense', cents: 3680, cat: '餐饮', date: '2026-11-05', note: '午餐' },
    { id: '2', ts: 2, type: 'expense', cents: 1000, cat: '交通', date: '2026-11-01', note: '地铁' },
    { id: '3', ts: 3, type: 'income', cents: 500000, cat: '工资', date: '2026-11-02', note: '' },
    { id: '4', ts: 4, type: 'expense', cents: 2000, cat: '餐饮', date: '2026-10-02', note: '聚餐' },
    { id: '5', ts: 5, type: 'expense', cents: 100, cat: '餐饮', date: null, note: '缺日期' }
  ];
  eq(JZ.filterEntries(entries, { text: '午餐' }).length, 1);
  eq(JZ.filterEntries(entries, { text: '36.8' })[0].id, '1');
  eq(JZ.filterEntries(entries, { text: '36.80' })[0].id, '1');
  eq(JZ.filterEntries(entries, { cat: '交通' }).length, 1);
  eq(JZ.filterEntries(entries, { type: 'income' }).length, 1);
  eq(JZ.filterEntries(entries, { month: '2026-10' }).length, 1);
  eq(JZ.filterEntries(entries, { month: '2026-11', type: 'expense', cat: '餐饮', text: '午餐' }).length, 1);
  eq(JZ.filterEntries(entries, { month: '2026-11', text: '聚餐' }).length, 0);
  eq(JZ.filterEntries(entries, { text: '收入' }).length, 1);
  eq(JZ.filterEntries(entries, {}).length, 5);
  eq(JZ.listMonths(entries).join(','), '2026-11,2026-10');
  eq(JZ.recentCategories(entries, 'expense', 4).join(','), '餐饮,交通');
  eq(JZ.recentCategories([{ type: 'expense', cat: '购物', ts: 9 }, { type: 'expense', cat: '餐饮', ts: 8 }, { type: 'income', cat: '工资', ts: 10 }], 'expense', 1)[0], '购物');
})();

(function analysis() {
  var entries = [
    { id: '1', ts: 1, type: 'expense', cents: 3680, cat: '餐饮', date: '2026-11-05', note: '午餐' },
    { id: '2', ts: 2, type: 'expense', cents: 1000, cat: '交通', date: '2026-11-01', note: '地铁' },
    { id: '3', ts: 3, type: 'income', cents: 500000, cat: '工资', date: '2026-11-02', note: '' },
    { id: '4', ts: 4, type: 'expense', cents: 2000, cat: '餐饮', date: '2026-10-02', note: '聚餐' }
  ];
  var brief = JZ.monthBrief(entries, 2026, 11);
  eq(brief.totals.income, 500000);
  eq(brief.totals.expense, 4680);
  eq(brief.totals.balance, 495320);
  eq(brief.prevTotals.expense, 2000);
  eq(brief.expenseCats[0].cat, '餐饮');
  eq(brief.expenseCats[0].cents, 3680);
  eq(brief.expenseCats[0].pct, 78.6);
  eq(brief.expenseCats[1].cat, '交通');
  eq(brief.expenseCats[1].pct, 21.4);
  eq(brief.largestExpense.cents, 3680);
  eq(brief.largestExpense.items[0].note, '午餐');
  eq(brief.daily.days.length, 30);
  eq(brief.daily.peakDays.join(','), '5');
  eq(brief.daily.days[4], 3680);
  eq(brief.daily.days[0], 1000);
  var text = brief.text;
  ok(text.indexOf('收入 ¥5000.00') >= 0, text);
  ok(text.indexOf('支出 ¥46.80') >= 0, text);
  ok(text.indexOf('结余 ¥4953.20') >= 0, text);
  ok(text.indexOf('支出最多的分类是餐饮，占 78.6%（¥36.80）') >= 0, text);
  ok(text.indexOf('最大的一笔支出是 11月05日 餐饮 ¥36.80，备注「午餐」') >= 0, text);
  ok(text.indexOf('花费最高的一天是 11月05日，当天支出 ¥36.80') >= 0, text);
  ok(text.indexOf('支出比上月多 ¥26.80（+134.0%）') >= 0, text);
  ok(text.indexOf('收入上月为 ¥0.00，本月 ¥5000.00') >= 0, text);
  eq(text.indexOf('购物'), -1);
  eq(text.indexOf('可能'), -1);
  eq(text.indexOf('大约'), -1);
  eq(JZ.heroLine(brief).indexOf('支出比上月多 ¥26.80（+134.0%）') >= 0, true);

  var tie = JZ.monthBrief([
    { type: 'expense', cents: 1000, cat: '交通', date: '2026-11-02', note: '地铁', ts: 2 },
    { type: 'expense', cents: 1000, cat: '餐饮', date: '2026-11-03', note: '面', ts: 3 },
    { type: 'expense', cents: 1000, cat: '购物', date: '2026-11-01', note: '', ts: 1 }
  ], 2026, 11);
  ok(tie.text.indexOf('支出最多的分类是交通、购物、餐饮，金额同为 ¥10.00（各占 33.3%）') >= 0, tie.text);
  ok(tie.text.indexOf('最大的支出有 3 笔并列，金额均为 ¥10.00') >= 0, tie.text);
  ok(tie.text.indexOf('最近的一笔是 11月03日 餐饮，备注「面」') >= 0, tie.text);
  eq(tie.daily.peakDays.join(','), '1,2,3');
  ok(tie.text.indexOf('花费最高的是 11月01日、11月02日、11月03日，当天支出均为 ¥10.00') >= 0, tie.text);

  var onlyIn = JZ.monthBrief([
    { type: 'income', cents: 800, cat: '红包', date: '2026-11-08', note: '生日', ts: 1 }
  ], 2026, 11);
  ok(onlyIn.text.indexOf('本月没有支出。') >= 0, onlyIn.text);
  eq(onlyIn.text.indexOf('支出最多的分类'), -1);
  ok(onlyIn.text.indexOf('收入最多的分类是红包，占 100.0%（¥8.00）') >= 0, onlyIn.text);
  ok(onlyIn.text.indexOf('最大的一笔收入是 11月08日 红包 ¥8.00，备注「生日」') >= 0, onlyIn.text);

  var empty = JZ.monthBrief(entries, 2020, 1);
  eq(empty.text, '2020年1月还没有记账。');
  eq(JZ.heroLine(empty), '本月还没有记账');
  var dec = JZ.monthBrief(entries, 2026, 12);
  ok(dec.text.indexOf('2026年12月还没有记账。') === 0, dec.text);
  ok(dec.text.indexOf('支出比上月少 ¥46.80（-100.0%）') >= 0, dec.text);
  eq(dec.text.indexOf('Infinity'), -1);
  eq(dec.text.indexOf('NaN'), -1);

  var negPrev = JZ.monthBrief([
    { type: 'expense', cents: 5000, cat: '居住', date: '2026-10-01', note: '', ts: 1 },
    { type: 'income', cents: 1000, cat: '工资', date: '2026-11-01', note: '', ts: 2 }
  ], 2026, 11);
  ok(negPrev.text.indexOf('结余上月为 -¥50.00，本月 ¥10.00') >= 0, negPrev.text);
  ok(negPrev.text.split('结余上月为')[1].indexOf('%') < 0, negPrev.text);
  ok(negPrev.text.indexOf('结余比上月') < 0, negPrev.text);

  var cells = JZ.calendarCells(2026, 11, brief.daily.days);
  eq(cells.weekStart, 'monday');
  eq(cells.lead, 6);
  eq(cells.cells[0], null);
  eq(cells.cells[6].day, 1);
  eq(cells.cells[6].cents, 1000);
  eq(JZ.heatLevel(0, 100), 0);
  eq(JZ.heatLevel(100, 100), 4);
  eq(JZ.heatLevel(10, 100), 1);
})();

(function budgets() {
  var db = JZ.normalize({ entries: [] });
  var entries = [
    { type: 'expense', cents: 15000, cat: '餐饮', date: '2026-11-02' },
    { type: 'expense', cents: 2000, cat: '交通', date: '2026-11-03' },
    { type: 'income', cents: 120000, cat: '工资', date: '2026-11-01' }
  ];
  JZ.setMonthBudget(db, '2026-11', 'expense', '餐饮', 10000);
  JZ.setMonthBudget(db, '2026-11', 'expense', '交通', 2000);
  JZ.setMonthBudget(db, '2026-11', 'income', '工资', 100000);
  var exp = JZ.budgetRows(db, entries, '2026-11', 'expense', JZ.PRESET.expense);
  eq(exp[0].cat, '餐饮');
  eq(exp[0].state, 'over');
  eq(exp[0].tone, 'expense-over');
  eq(exp[0].remaining, -5000);
  ok(exp[0].label.indexOf('已超 ¥50.00') >= 0, exp[0].label);
  var traffic = exp.filter(function (r) { return r.cat === '交通'; })[0];
  eq(traffic.state, 'met');
  eq(traffic.tone, 'expense');
  ok(traffic.label.indexOf('限额已用完') >= 0);
  var shop = exp.filter(function (r) { return r.cat === '购物'; })[0];
  eq(shop.state, 'none');
  eq(shop.tone, 'neutral');
  var inc = JZ.budgetRows(db, entries, '2026-11', 'income', JZ.PRESET.income);
  var wage = inc.filter(function (r) { return r.cat === '工资'; })[0];
  eq(wage.state, 'met');
  eq(wage.tone, 'income');
  ok(wage.tone !== 'expense-over');
  ok(wage.label.indexOf('已超过目标 ¥200.00') >= 0, wage.label);
  ok(wage.label.indexOf('超支') < 0, wage.label);
  JZ.setMonthBudget(db, '2026-11', 'income', '奖金', 5000);
  var bonus = JZ.budgetRows(db, entries, '2026-11', 'income', JZ.PRESET.income).filter(function (r) { return r.cat === '奖金'; })[0];
  eq(bonus.state, 'progress');
  eq(bonus.tone, 'income');
  ok(bonus.label.indexOf('还差 ¥50.00') >= 0, bonus.label);
  eq(JZ.copyBudgets(db, '2026-11', '2026-12'), true);
  JZ.setMonthBudget(db, '2026-12', 'expense', '餐饮', 1);
  eq(db.budgets.months['2026-11'].expense['餐饮'], 10000);
  JZ.setMonthBudget(db, '2026-11', 'expense', '餐饮', 0);
  eq(db.budgets.months['2026-11'].expense['餐饮'], undefined);
  eq(JZ.copyBudgets(db, '2026-01', '2026-02'), false);
  eq(JZ.monthHasBudget(db, '2026-01'), false);
})();

(function loans() {
  var report = JZ.loanReport([
    { person: '张三', dir: 'out', cents: 5000, repaid: false },
    { person: '张三', dir: 'out', cents: 1000, repaid: true },
    { person: '李四', dir: 'in', cents: 3000, repaid: false },
    { person: '王五', dir: 'out', cents: 800, repaid: false },
    { person: '王五', dir: 'in', cents: 800, repaid: false },
    { person: '赵六', dir: 'in', cents: 200, repaid: true }
  ]);
  eq(report.owedMe, 5800);
  eq(report.iOwe, 3800);
  eq(report.net, 2000);
  eq(report.netText, '别人还欠我');
  eq(report.openOutCount, 2);
  eq(report.openInCount, 2);
  eq(report.repaidCount, 2);
  eq(report.people[0].person, '张三');
  eq(report.people[0].status, 'owed');
  eq(report.people[0].statusText, '待收回');
  eq(report.people[0].repaidN, 1);
  var li = report.people.filter(function (p) { return p.person === '李四'; })[0];
  eq(li.status, 'owing');
  eq(li.statusText, '待归还');
  var wang = report.people.filter(function (p) { return p.person === '王五'; })[0];
  eq(wang.status, 'offset');
  eq(wang.statusText, '已抵平');
  eq(wang.net, 0);
  var zhao = report.people.filter(function (p) { return p.person === '赵六'; })[0];
  eq(zhao.status, 'settled');
  eq(zhao.statusText, '已结清');
  eq(zhao.openCount, 0);
})();

(function imports() {
  var csv = JZ.parseCSV('\uFEFF日期,备注\n2026-01-01,"午饭,加汤"\n');
  eq(csv[0][0], '日期');
  eq(csv[1][1], '午饭,加汤');
  eq(JZ.parseAmt('¥1,234.50'), 123450);
  eq(JZ.parseAmt('(12.00)'), -1200);
  eq(JZ.parseAmt(''), null);
  eq(JZ.parseDate('2026年11月5日'), '2026-11-05');
  eq(JZ.parseDate('2026/1/2 12:00:00'), '2026-01-02');
  eq(JZ.guessCat('expense', '美团外卖', JZ.PRESET.expense), '餐饮');
  eq(JZ.guessCat('income', '工资代发', JZ.PRESET.income), '工资');
  eq(JZ.guessCat('expense', '宠物店', JZ.PRESET.expense.concat(['宠物'])), '宠物');

  var wx = JZ.detect([
    ['微信支付账单明细'],
    ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态'],
    ['2026-11-03 08:00:00', '商户消费', '美团', '外卖', '支出', '25.50', '零钱', '支付成功'],
    ['2026-11-03 09:00:00', '转账', '李四', '/', '收入', '10.00', '零钱', '已全额退款']
  ]);
  eq(wx.name, '微信支付账单');
  var wxRows = JZ.mapRows([
    ['微信支付账单明细'],
    ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态'],
    ['2026-11-03 08:00:00', '商户消费', '美团', '外卖', '支出', '25.50', '零钱', '支付成功'],
    ['2026-11-03 09:00:00', '转账', '李四', '/', '收入', '10.00', '零钱', '已全额退款']
  ], wx.header, wx.cols, { expense: JZ.PRESET.expense, income: JZ.PRESET.income });
  eq(wxRows.skipped, 1);
  eq(wxRows.items.length, 1);
  eq(wxRows.items[0].cat, '餐饮');
  eq(wxRows.items[0].cents, 2550);
  eq(wxRows.items[0].type, 'expense');

  var aliRows = [
    ['支付宝交易记录明细查询'],
    ['交易时间', '交易分类', '交易对方', '商品说明', '收/支', '金额', '交易状态'],
    ['2026-11-01 12:00:00', '餐饮美食', '肯德基', '午餐', '支出', '36.80', '交易成功'],
    ['2026-11-02 12:00:00', '转账', '公司', '工资', '收入', '5000.00', '交易成功'],
    ['2026-10-01 12:00:00', '购物', '淘宝', '退货', '支出', '10.00', '退款成功']
  ];
  var ali = JZ.detect(aliRows);
  eq(ali.name, '支付宝账单');
  var aliMapped = JZ.mapRows(aliRows, ali.header, ali.cols);
  eq(aliMapped.skipped, 1);
  eq(aliMapped.items.length, 2);
  eq(aliMapped.items[0].cat, '餐饮');
  eq(aliMapped.items[1].type, 'income');
  eq(aliMapped.items[1].cat, '工资');

  var bankRows = [
    ['交易日期', '收入金额', '支出金额', '账户余额', '摘要', '对方户名'],
    ['2026-11-04', '', '88.00', '1000.00', '地铁', '交通卡'],
    ['2026-11-05', '2000.00', '', '3000.00', '工资', '公司']
  ];
  var bank = JZ.detect(bankRows);
  eq(bank.name, '银行流水（通用）');
  var bankMapped = JZ.mapRows(bankRows, bank.header, bank.cols);
  eq(bankMapped.items.length, 2);
  eq(bankMapped.items[0].type, 'expense');
  eq(bankMapped.items[0].cents, 8800);
  eq(bankMapped.items[0].cat, '交通');
  eq(bankMapped.items[1].type, 'income');
  eq(bankMapped.items[1].cat, '工资');

  var signed = [
    ['交易日期', '交易金额', '摘要'],
    ['2026-11-06', '-12.50', '地铁'],
    ['2026-11-07', '100.00', '红包']
  ];
  var signedDet = JZ.detect(signed);
  var signedMapped = JZ.mapRows(signed, signedDet.header, signedDet.cols);
  eq(signedMapped.items[0].type, 'expense');
  eq(signedMapped.items[0].cents, 1250);
  eq(signedMapped.items[1].type, 'income');
  eq(signedMapped.items[1].cat, '红包');

  var marked = JZ.markDuplicates(aliMapped.items, [
    { date: '2026-11-01', cents: 3680, note: '肯德基 午餐' }
  ]);
  eq(marked[0].dup, true);
  eq(marked[0].on, false);
  eq(marked[1].dup, false);
  eq(marked[1].on, true);
})();

(function isolation() {
  eq(JZ.isOwnStorageKey('jizhang_v1'), true);
  eq(JZ.isOwnStorageKey('jizhang_v1_photo_abc'), true);
  eq(JZ.isOwnStorageKey('qingzhang-transactions-v1'), false);
  eq(JZ.isOwnStorageKey('other'), false);
  var root = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(root.indexOf('轻账') >= 0);
  ok(root.indexOf('qingzhang-transactions-v1') >= 0);
  ok(root.indexOf('jizhang_v1') < 0);
  var app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  var logic = fs.readFileSync(path.join(__dirname, 'logic.js'), 'utf8');
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(app.indexOf('qingzhang') < 0);
  ok(logic.indexOf('qingzhang') < 0);
  ok(html.indexOf('logic.js') >= 0);
  ok(html.indexOf('vendor/xlsx.full.min.js') >= 0);
  ok(html.indexOf('https://') < 0 && html.indexOf('http://') < 0);
  ok(app.indexOf('https://') < 0 && app.indexOf('http://') < 0);
})();

console.log('logic tests passed: ' + passed);

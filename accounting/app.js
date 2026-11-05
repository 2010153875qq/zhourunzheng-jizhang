(function () {
  'use strict';
  if (!window.JZ) { alert('记账脚本没有加载完整'); return; }
  var JZ = window.JZ;
  var KEY = JZ.KEY;
  var PHOTO = JZ.PHOTO_PREFIX;

  function $(id) { return document.getElementById(id); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + JZ.pad(d.getMonth() + 1) + '-' + JZ.pad(d.getDate()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function show(el, on) { if (el) el.classList[on ? 'remove' : 'add']('hidden'); }
  function isQuota(e) { return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014); }
  var QUOTA_MSG = '手机浏览器存储空间已满（约5MB），无法保存。请删除部分照片或导出备份后清理旧记录。';
  function emptyHTML(kind, msg, sub) {
    return '<div class="empty"><img src="assets/empty-' + kind + '.svg" alt=""><div class="msg">' + msg + '</div><div class="sub">' + sub + '</div></div>';
  }
  var toastTimer = null;
  function toast(msg, ok) {
    var el = $('toast'); if (!el) return;
    el.textContent = msg;
    el.className = ok ? 'show ok' : 'show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 1800);
  }
  function closestAttr(node, name, stop) {
    while (node && node !== stop) {
      if (node.getAttribute && node.getAttribute(name) != null) return node;
      node = node.parentNode;
    }
    return null;
  }

  function blank() { return JZ.normalize({ entries: [] }); }
  function load() {
    var raw;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { return blank(); }
    if (!raw) return blank();
    try { return JZ.normalize(JSON.parse(raw)); }
    catch (e) {
      try { window.localStorage.setItem(KEY + '_corrupt_' + Date.now(), raw); } catch (e2) {}
      alert('本地数据读取失败，已备份原数据并重置。');
      return blank();
    }
  }
  var db = load();
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { alert(isQuota(e) ? QUOTA_MSG : '保存失败：浏览器存储不可用'); return false; }
  }
  function getPhoto(id) { try { return window.localStorage.getItem(PHOTO + id); } catch (e) { return null; } }
  function setPhoto(id, data) {
    try { window.localStorage.setItem(PHOTO + id, data); return true; }
    catch (e) { alert(isQuota(e) ? QUOTA_MSG : '照片保存失败'); return false; }
  }
  function delPhoto(id) { try { window.localStorage.removeItem(PHOTO + id); } catch (e) {} }
  function ownStorage() {
    var bytes = 0, photos = 0, i, k, v;
    try {
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i);
        if (!JZ.isOwnStorageKey(k)) continue;
        v = localStorage.getItem(k) || '';
        bytes += (k.length + v.length) * 2;
        if (k.indexOf(PHOTO) === 0) photos++;
      }
    } catch (e) {}
    return { bytes: bytes, photos: photos };
  }
  function kb(b) { return b > 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB'; }

  var tabbar = document.querySelector('.tabbar');
  function showTab(t) {
    var bs = tabbar.querySelectorAll('button'), i, on;
    for (i = 0; i < bs.length; i++) {
      on = bs[i].getAttribute('data-tab') === t;
      bs[i].className = on ? 'on' : '';
      bs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    show($('tab-book'), t === 'book');
    show($('tab-loan'), t === 'loan');
    show($('tab-import'), t === 'import');
    document.body.classList[t === 'book' ? 'add' : 'remove']('dock-on');
    window.scrollTo(0, 0);
    if (t === 'book') render();
    if (t === 'loan') renderLoans();
  }
  tabbar.addEventListener('click', function (ev) {
    var btn = closestAttr(ev.target, 'data-tab', tabbar);
    if (!btn) return;
    showTab(btn.getAttribute('data-tab'));
  });

  var now = new Date();
  var state = { y: now.getFullYear(), m: now.getMonth() + 1, type: 'expense', cat: null, editId: null, breakType: 'expense', photo: undefined };
  var filter = { text: '', type: '', cat: '', month: '__view__' };
  function monthKey() { return JZ.monthKey(state.y, state.m); }
  function setToggle(box, attr, val) {
    var bs = box.querySelectorAll('button'), i;
    for (i = 0; i < bs.length; i++) bs[i].className = bs[i].getAttribute(attr) === val ? 'on' : '';
  }
  function catBtnClass(c) {
    var known = JZ.PRESET.expense.concat(JZ.PRESET.income);
    return 'cat' + (known.indexOf(c) >= 0 ? ' cat-' + c : '') + (c === state.cat ? ' on' : '');
  }
  function renderCats() {
    var list = JZ.categories(db, state.type);
    if (list.indexOf(state.cat) < 0) state.cat = list[0];
    var recent = JZ.recentCategories(db.entries, state.type, 4), rh = '', i, c, custom, h = '';
    if (recent.length) {
      rh = '<span class="recent-label">最近</span>';
      for (i = 0; i < recent.length; i++) {
        c = recent[i];
        rh += '<button type="button" class="' + catBtnClass(c) + '" data-cat="' + esc(c) + '"><span class="ico" aria-hidden="true">' + JZ.catIcon(c) + '</span>' + esc(c) + '</button>';
      }
    }
    $('recentRow').innerHTML = rh;
    show($('recentRow'), recent.length > 0);
    for (i = 0; i < list.length; i++) {
      c = list[i];
      custom = db.custom[state.type].indexOf(c) >= 0;
      h += '<button type="button" class="' + catBtnClass(c) + '" data-cat="' + esc(c) + '"><span class="ico" aria-hidden="true">' + JZ.catIcon(c) + '</span>' + esc(c) +
        (custom ? '<span class="x" data-del="' + esc(c) + '" aria-label="删除分类">×</span>' : '') + '</button>';
    }
    h += '<button type="button" class="cat add" data-add="1"><span class="ico">＋</span>自定义</button>';
    $('cats').innerHTML = h;
  }
  function setType(t, keepCat) {
    state.type = t;
    var list = JZ.categories(db, t);
    if (!keepCat || list.indexOf(state.cat) < 0) {
      var recent = JZ.recentCategories(db.entries, t, 1);
      state.cat = recent[0] || list[0];
    }
    setToggle($('typeToggle'), 'data-type', t);
    var box = $('typeToggle');
    if (t === 'income') box.classList.add('income-on'); else box.classList.remove('income-on');
    renderCats();
  }

  function catOptions(type, sel) {
    var list = JZ.categories(db, type).slice();
    if (sel && list.indexOf(sel) < 0) list.push(sel);
    return list.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  }
  function namesForFilter() {
    var types = filter.type ? [filter.type] : ['expense', 'income'];
    var names = [], ti, list, i, e;
    for (ti = 0; ti < types.length; ti++) {
      list = JZ.categories(db, types[ti]);
      for (i = 0; i < list.length; i++) if (names.indexOf(list[i]) < 0) names.push(list[i]);
    }
    for (i = 0; i < db.entries.length; i++) {
      e = db.entries[i];
      if (!e || (filter.type && e.type !== filter.type)) continue;
      if (e.cat && names.indexOf(e.cat) < 0) names.push(e.cat);
    }
    return names;
  }
  function fillFilters() {
    $('fType').value = filter.type;
    var names = namesForFilter(), h = '<option value="">全部分类</option>', i;
    for (i = 0; i < names.length; i++) h += '<option value="' + esc(names[i]) + '">' + esc(names[i]) + '</option>';
    $('fCat').innerHTML = h;
    if (names.indexOf(filter.cat) < 0) filter.cat = '';
    $('fCat').value = filter.cat;
    var months = JZ.listMonths(db.entries), mk = monthKey();
    if (months.indexOf(mk) < 0) months.push(mk);
    months.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    var mh = '<option value="__view__">当前月（' + state.y + '年' + state.m + '月）</option><option value="__all__">全部月份</option>';
    for (i = 0; i < months.length; i++) mh += '<option value="' + months[i] + '">' + months[i].slice(0, 4) + '年' + (+months[i].slice(5)) + '月</option>';
    $('fMonth').innerHTML = mh;
    if (['__view__', '__all__'].indexOf(filter.month) < 0 && months.indexOf(filter.month) < 0) filter.month = '__view__';
    $('fMonth').value = filter.month;
    if (document.activeElement !== $('q')) $('q').value = filter.text;
  }
  function resolvedMonth() {
    if (filter.month === '__all__') return '';
    if (filter.month === '__view__') return monthKey();
    return filter.month;
  }
  function renderList() {
    var month = resolvedMonth();
    var items = JZ.filterEntries(db.entries, { text: filter.text, type: filter.type, cat: filter.cat, month: month });
    items.sort(function (a, b) {
      if (a.date !== b.date) {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? 1 : -1;
      }
      return (b.ts || 0) - (a.ts || 0);
    });
    var inc = 0, exp = 0, i;
    for (i = 0; i < items.length; i++) { if (items[i].type === 'income') inc += items[i].cents || 0; else exp += items[i].cents || 0; }
    var narrowed = !!(String(filter.text || '').replace(/^\s+|\s+$/g, '') || filter.type || filter.cat || filter.month !== '__view__');
    var scope = filter.month === '__all__' ? '全部月份' : (month ? month.slice(0, 4) + '年' + (+month.slice(5)) + '月' : '');
    $('filterMeta').textContent = (scope ? scope + ' · ' : '') + '显示 ' + items.length + ' 笔 · 收入 ' + JZ.fmt(inc) + ' · 支出 ' + JZ.fmt(exp);
    if (!items.length) {
      $('list').innerHTML = narrowed
        ? '<div class="empty"><div class="msg">没有符合条件的记录</div><div class="sub">换个关键词、分类或月份试试</div></div>'
        : emptyHTML('book', '这个月还是空白的', '先记一笔支出，保存按钮一直在下面');
      return;
    }
    var lh = '', cur = null, e, isIn, ph, day;
    for (i = 0; i < items.length; i++) {
      e = items[i];
      day = e.date || '';
      if (day !== cur) {
        cur = day;
        lh += '<div class="day"><span>' + (e.date ? e.date.slice(5).replace('-', '月') + '日' : '日期不详') + '</span></div>';
      }
      isIn = e.type === 'income';
      ph = e.photo ? getPhoto(e.id) : null;
      lh += '<div class="item">' + (ph ? '<button type="button" class="pic" data-view="' + esc(e.id) + '"><img src="' + ph + '" alt="照片"></button>' : '') +
        '<div class="info"><div class="c"><span class="dot" aria-hidden="true">' + JZ.catIcon(e.cat) + '</span><select class="inline-cat" data-cat-for="' + esc(e.id) + '" aria-label="修改分类">' + catOptions(e.type, e.cat) + '</select></div>' +
        (e.note ? '<div class="n">' + esc(e.note) + '</div>' : '') + '</div><span class="amt ' + (isIn ? 'inc' : 'exp') + '">' + (isIn ? '+' : '-') + JZ.fmt(e.cents) + '</span>' +
        '<button type="button" class="icon" data-edit="' + esc(e.id) + '">编辑</button><button type="button" class="icon" data-rm="' + esc(e.id) + '">删除</button></div>';
    }
    $('list').innerHTML = lh;
  }
  function renderBudget(type, id) {
    var rows = JZ.budgetRows(db, db.entries, monthKey(), type, JZ.categories(db, type));
    var h = '', i, row, width, cls;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      width = row.limit ? Math.min(100, Math.round(row.ratio * 1000) / 10) : 0;
      cls = 'bud' + (row.tone === 'income' ? ' income' : '') + (row.tone === 'expense-over' ? ' over' : '');
      h += '<div class="' + cls + '"><div class="bud-top"><span class="bud-name">' + JZ.catIcon(row.cat) + ' ' + esc(row.cat) + '</span>' +
        '<input class="limit-input" inputmode="decimal" autocomplete="off" data-blimit="' + type + '" data-bcat="' + esc(row.cat) + '" value="' + (row.limit ? JZ.fmt(row.limit) : '') + '" placeholder="' + (type === 'income' ? '月目标' : '月限额') + '" aria-label="' + esc(row.cat + (type === 'income' ? '月目标' : '月限额')) + '"></div>' +
        '<div class="bud-meta">' + esc(row.label) + '</div>';
      if (row.limit) {
        h += '<div class="bar' + (row.tone === 'income' ? ' income' : '') + (row.tone === 'expense-over' ? ' over' : '') + '"><div class="track"><div class="fill" style="width:' + width + '%"></div></div></div>';
      }
      h += '</div>';
    }
    $(id).innerHTML = h;
  }
  function renderAnalysis(brief) {
    $('analysisMonth').textContent = JZ.monthName(state.y, state.m);
    $('brief').textContent = brief.text;
    var bal = brief.totals.balance, prevBal = brief.prevTotals.balance;
    $('cmp').innerHTML =
      '<div><span>支出</span><b>' + JZ.fmt(brief.totals.expense) + '</b><em>' + esc(JZ.changeClause('支出', brief.totals.expense, brief.prevTotals.expense).slice(2)) + '</em></div>' +
      '<div><span>收入</span><b>' + JZ.fmt(brief.totals.income) + '</b><em>' + esc(JZ.changeClause('收入', brief.totals.income, brief.prevTotals.income).slice(2)) + '</em></div>' +
      '<div><span>结余</span><b>' + (bal < 0 ? '-' : '') + JZ.fmt(bal) + '</b><em>' + esc(JZ.changeClause('结余', bal, prevBal).slice(2)) + '</em></div>';
    var cal = JZ.calendarCells(state.y, state.m, brief.daily.days);
    var html = '<div class="cal">', w = ['一', '二', '三', '四', '五', '六', '日'], i, cellDay, lv, iso, label;
    for (i = 0; i < w.length; i++) html += '<div class="hd">' + w[i] + '</div>';
    var todayStr = today();
    for (i = 0; i < cal.cells.length; i++) {
      cellDay = cal.cells[i];
      if (!cellDay) { html += '<div class="cell blank"></div>'; continue; }
      lv = JZ.heatLevel(cellDay.cents, brief.daily.max);
      iso = monthKey() + '-' + JZ.pad(cellDay.day);
      label = JZ.formatMD(iso) + (cellDay.cents ? ' 支出 ' + JZ.money(cellDay.cents) : ' 无支出');
      html += '<div class="cell lv' + lv + (iso === todayStr ? ' today' : '') + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + cellDay.day + '</div>';
    }
    $('calendar').innerHTML = html + '</div>';
    var rows = state.breakType === 'income' ? brief.incomeCats : brief.expenseCats;
    $('breakType').textContent = state.breakType === 'income' ? '收入' : '支出';
    var bh = '', r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      bh += '<div class="bar ' + state.breakType + '"><div class="t"><span>' + esc(r.cat) + ' ' + r.pct.toFixed(1) + '%</span><span>¥' + JZ.fmt(r.cents) + '</span></div><div class="track"><div class="fill" style="width:' + Math.min(100, r.pct).toFixed(1) + '%"></div></div></div>';
    }
    $('breakdown').innerHTML = bh || emptyHTML('book', '还没有' + (state.breakType === 'income' ? '收入' : '支出'), '记一笔就能看到分类占比');
  }
  function render() {
    var brief = JZ.monthBrief(db.entries, state.y, state.m);
    $('monthLabel').textContent = state.y + '年' + state.m + '月';
    $('sumIn').textContent = JZ.fmt(brief.totals.income);
    $('sumOut').textContent = JZ.fmt(brief.totals.expense);
    $('sumBal').textContent = (brief.totals.balance < 0 ? '-' : '') + JZ.fmt(brief.totals.balance);
    $('sumDelta').textContent = JZ.heroLine(brief);
    renderCats();
    fillFilters();
    renderList();
    renderAnalysis(brief);
    $('budgetMonth').textContent = JZ.monthName(state.y, state.m);
    renderBudget('expense', 'budgetExp');
    renderBudget('income', 'budgetInc');
    var prev = JZ.shiftMonth(state.y, state.m, -1);
    $('copyBudget').disabled = !JZ.monthHasBudget(db, JZ.monthKey(prev.y, prev.m));
    var s = ownStorage();
    $('storageInfo').textContent = '本机只保存这份记账本（' + KEY + '），约 ' + kb(s.bytes) + '（照片 ' + s.photos + ' 张）。记账、借贷、预算、自定义分类和照片都在其中，不会改写其他页面的数据。浏览器单站上限通常约 5 MB。';
  }

  function setPhotoPreview(src) {
    var img = $('photoPreview');
    if (src) { img.src = src; show(img, true); show($('photoRemove'), true); $('photoLabel').textContent = '换'; $('photoLabel').setAttribute('aria-label', '更换照片'); }
    else { img.removeAttribute('src'); show(img, false); show($('photoRemove'), false); $('photoLabel').textContent = '📷'; $('photoLabel').setAttribute('aria-label', '添加照片'); }
  }
  function resetForm() {
    state.editId = null; state.photo = undefined;
    $('amount').value = ''; $('note').value = ''; $('err').textContent = '';
    $('formTitle').textContent = '✏️ 记一笔'; $('saveBtn').textContent = '保存'; show($('cancelEdit'), false);
    setPhotoPreview(null);
  }
  function find(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i; return -1; }

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var cents = JZ.userCents($('amount').value);
    if (cents === null) { $('err').textContent = '请输入大于0的金额，最多两位小数'; toast('请输入大于0的金额'); $('amount').focus(); return; }
    var d = $('date').value || today();
    var e = { type: state.type, cents: cents, cat: state.cat, date: d, note: $('note').value.trim() };
    var i = state.editId ? find(db.entries, state.editId) : -1, old = i >= 0 ? db.entries[i] : null;
    e.id = old ? old.id : uid(); e.ts = old ? old.ts : Date.now(); e.photo = old ? !!old.photo : false;
    if (state.photo === null) { delPhoto(e.id); e.photo = false; }
    else if (state.photo) { e.photo = setPhoto(e.id, state.photo) ? true : e.photo; }
    if (old) db.entries[i] = e; else db.entries.push(e);
    if (!save()) {
      if (!old) db.entries.pop();
      else db.entries[i] = old;
      return;
    }
    var wasEdit = !!old;
    state.y = +d.slice(0, 4); state.m = +d.slice(5, 7);
    resetForm(); render();
    toast(wasEdit ? '已更新' : '已记下', true);
    if (!wasEdit) $('amount').focus();
  });
  $('cancelEdit').addEventListener('click', function () { resetForm(); renderCats(); });
  $('typeToggle').addEventListener('click', function (ev) {
    var t = ev.target.getAttribute && ev.target.getAttribute('data-type');
    if (t) setType(t, false);
  });
  $('catBox').addEventListener('click', function (ev) {
    var del = closestAttr(ev.target, 'data-del', $('catBox'));
    if (del) {
      var name = del.getAttribute('data-del');
      if (confirm('删除自定义分类「' + name + '」？（已有记录不受影响）')) {
        db.custom[state.type] = db.custom[state.type].filter(function (c) { return c !== name; });
        save(); renderCats();
      }
      return;
    }
    var add = closestAttr(ev.target, 'data-add', $('catBox'));
    if (add) {
      var n = prompt('新分类名称：');
      if (n === null) return; n = n.trim().slice(0, 8);
      if (!n) return;
      if (JZ.categories(db, state.type).indexOf(n) >= 0) { alert('分类已存在'); return; }
      db.custom[state.type].push(n); save(); state.cat = n; renderCats(); return;
    }
    var cat = closestAttr(ev.target, 'data-cat', $('catBox'));
    if (cat) { state.cat = cat.getAttribute('data-cat'); renderCats(); }
  });
  $('breakToggle').addEventListener('click', function (ev) {
    var t = ev.target.getAttribute && ev.target.getAttribute('data-type');
    if (!t) return;
    state.breakType = t; setToggle(this, 'data-type', t); render();
  });
  $('list').addEventListener('change', function (ev) {
    var id = ev.target.getAttribute('data-cat-for');
    if (!id) return;
    var i = find(db.entries, id);
    if (i < 0) return;
    db.entries[i].cat = ev.target.value;
    if (state.editId === id) state.cat = ev.target.value;
    if (!save()) { render(); return; }
    render();
  });
  $('list').addEventListener('click', function (ev) {
    var view = closestAttr(ev.target, 'data-view', $('list'));
    var rm = closestAttr(ev.target, 'data-rm', $('list'));
    var ed = closestAttr(ev.target, 'data-edit', $('list'));
    var i;
    if (view) { openModal(getPhoto(view.getAttribute('data-view'))); return; }
    if (rm && confirm('确定删除这条记录？')) {
      var id = rm.getAttribute('data-rm');
      i = find(db.entries, id);
      if (i >= 0) { db.entries.splice(i, 1); delPhoto(id); save(); if (state.editId === id) resetForm(); render(); }
    }
    if (ed) {
      i = find(db.entries, ed.getAttribute('data-edit')); if (i < 0) return;
      var e = db.entries[i];
      resetForm();
      state.editId = e.id; state.cat = e.cat; setType(e.type, true);
      $('amount').value = JZ.fmt(e.cents); $('date').value = e.date; $('note').value = e.note || '';
      setPhotoPreview(e.photo ? getPhoto(e.id) : null);
      $('formTitle').textContent = '✏️ 编辑记录'; $('saveBtn').textContent = '保存修改'; show($('cancelEdit'), true);
      if ($('formTitle').scrollIntoView) $('formTitle').scrollIntoView();
    }
  });
  function shift(n) {
    var next = JZ.shiftMonth(state.y, state.m, n);
    state.y = next.y; state.m = next.m; render();
  }
  $('prevM').addEventListener('click', function () { shift(-1); });
  $('nextM').addEventListener('click', function () { shift(1); });
  $('q').addEventListener('input', function () { filter.text = this.value; renderList(); });
  $('fType').addEventListener('change', function () {
    filter.type = this.value;
    if (namesForFilter().indexOf(filter.cat) < 0) filter.cat = '';
    fillFilters(); renderList();
  });
  $('fCat').addEventListener('change', function () { filter.cat = this.value; renderList(); });
  $('fMonth').addEventListener('change', function () { filter.month = this.value; renderList(); });
  document.querySelector('.jumps').addEventListener('click', function (ev) {
    var id = ev.target.getAttribute && ev.target.getAttribute('data-jump');
    var el = id && $(id);
    if (el && el.scrollIntoView) el.scrollIntoView();
  });
  $('budgetCard').addEventListener('change', function (ev) {
    var t = ev.target, type = t.getAttribute('data-blimit'), cat = t.getAttribute('data-bcat'), raw, cents;
    if (!type || !cat) return;
    raw = String(t.value || '').replace(/^\s+|\s+$/g, '');
    if (!raw || raw === '0' || raw === '0.0' || raw === '0.00') cents = 0;
    else {
      cents = JZ.userCents(raw);
      if (cents === null) { toast('限额请填大于 0 的金额，最多两位小数'); render(); return; }
    }
    JZ.setMonthBudget(db, monthKey(), type, cat, cents);
    if (!save()) return;
    render();
    toast(cents ? '已保存本月限额' : '已清除限额', true);
  });
  $('copyBudget').addEventListener('click', function () {
    var prev = JZ.shiftMonth(state.y, state.m, -1);
    var from = JZ.monthKey(prev.y, prev.m);
    if (!JZ.monthHasBudget(db, from)) { toast('上月没有限额可复制'); return; }
    if (!confirm('用' + JZ.monthName(prev.y, prev.m) + '的限额覆盖' + JZ.monthName(state.y, state.m) + '已填写的限额？')) return;
    JZ.copyBudgets(db, from, monthKey());
    if (!save()) return;
    render(); toast('已复制上月限额', true);
  });

  function openModal(src) { if (!src) return; $('modalImg').src = src; show($('modal'), true); }
  $('modal').addEventListener('click', function () { show($('modal'), false); $('modalImg').removeAttribute('src'); });
  function compress(file, cb) {
    var url = (window.URL || window.webkitURL).createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 1024, w = img.naturalWidth, h = img.naturalHeight, out, q = 0.7;
      for (var attempt = 0; attempt < 6; attempt++) {
        var s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length * 0.75 < 200 * 1024) break;
        if (q > 0.5) q -= 0.1; else max = Math.round(max * 0.8);
      }
      (window.URL || window.webkitURL).revokeObjectURL(url);
      cb(null, out);
    };
    img.onerror = function () { cb(new Error('无法读取该图片')); };
    img.src = url;
  }
  $('photoInput').addEventListener('change', function () {
    var f = this.files && this.files[0], inp = this; if (!f) return;
    $('err').textContent = '正在处理照片…';
    compress(f, function (err, data) {
      inp.value = '';
      if (err) { $('err').textContent = '照片处理失败：' + err.message; return; }
      $('err').textContent = '';
      state.photo = data; setPhotoPreview(data);
    });
  });
  $('photoRemove').addEventListener('click', function () { state.photo = null; setPhotoPreview(null); });
  $('photoPreview').addEventListener('click', function () { openModal(this.src); });

  var loan = { dir: 'out', editId: null };
  $('dirToggle').addEventListener('click', function (ev) {
    var d = ev.target.getAttribute && ev.target.getAttribute('data-dir');
    if (d) { loan.dir = d; setToggle(this, 'data-dir', d); }
  });
  function resetLoan() {
    loan.editId = null; $('loanPerson').value = ''; $('loanAmount').value = ''; $('loanNote').value = ''; $('loanDate').value = today();
    $('loanErr').textContent = ''; $('loanTitle').textContent = '➕ 新增借贷'; $('loanSave').textContent = '保存'; show($('loanCancel'), false);
  }
  $('loanCancel').addEventListener('click', resetLoan);
  $('loanForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var person = $('loanPerson').value.trim(), cents = JZ.userCents($('loanAmount').value);
    if (!person) { $('loanErr').textContent = '请输入对方姓名'; return; }
    if (cents === null) { $('loanErr').textContent = '请输入大于0的金额，最多两位小数'; return; }
    var item = { dir: loan.dir, person: person, cents: cents, date: $('loanDate').value || today(), note: $('loanNote').value.trim() };
    var i = loan.editId ? find(db.loans, loan.editId) : -1;
    if (i >= 0) { var o = db.loans[i]; item.id = o.id; item.ts = o.ts; item.repaid = o.repaid; item.repaidDate = o.repaidDate; db.loans[i] = item; }
    else { item.id = uid(); item.ts = Date.now(); item.repaid = false; item.repaidDate = ''; db.loans.push(item); }
    if (!save()) {
      if (i >= 0) db.loans[i] = o; else db.loans.pop();
      return;
    }
    var edited = i >= 0;
    resetLoan(); renderLoans();
    toast(edited ? '借贷已更新' : '借贷已记下', true);
  });
  function renderLoans() {
    var report = JZ.loanReport(db.loans);
    $('owedMe').textContent = JZ.fmt(report.owedMe);
    $('iOwe').textContent = JZ.fmt(report.iOwe);
    $('owedMeta').textContent = '未还 ' + report.openOutCount + ' 笔';
    $('oweMeta').textContent = '未还 ' + report.openInCount + ' 笔';
    $('netLine').textContent = '净额：' + report.netText + (report.net === 0 ? '' : ' ' + JZ.fmt(Math.abs(report.net))) +
      ' · 未还 ' + (report.openOutCount + report.openInCount) + ' 笔 · 已还清 ' + report.repaidCount + ' 笔';
    var ph = '', i, p, bits, amt, amtClass;
    for (i = 0; i < report.people.length; i++) {
      p = report.people[i];
      bits = [];
      bits.push(p.openCount ? '未还 ' + p.openCount + ' 笔' : '没有未还');
      if (p.net > 0) bits.push('待收 ' + JZ.fmt(p.net));
      else if (p.net < 0) bits.push('待还 ' + JZ.fmt(-p.net));
      if (p.openOutN && p.openInN) bits.push('借出 ' + JZ.fmt(p.openOut) + ' / 借入 ' + JZ.fmt(p.openIn));
      if (p.repaidN) bits.push('已还清 ' + p.repaidN + ' 笔');
      amt = p.status === 'settled' ? '已结清' : p.status === 'offset' ? '已抵平' : JZ.fmt(Math.abs(p.net));
      amtClass = p.status === 'owed' ? 'inc' : p.status === 'owing' ? 'exp' : '';
      ph += '<div class="item"><div class="info"><div class="c"><span class="dot" aria-hidden="true">👤</span>' + esc(p.person) +
        '<span class="pill ' + p.status + '">' + p.statusText + '</span></div><div class="n">' + esc(bits.join(' · ')) + '</div></div>' +
        '<span class="amt ' + amtClass + '">' + amt + '</span></div>';
    }
    $('perPerson').innerHTML = ph || emptyHTML('loan', '还没有借贷对象', '记一笔借出或借入，这里会按人显示状态');
    var list = db.loans.slice().sort(function (a, b) { return ((a.repaid ? 1 : 0) - (b.repaid ? 1 : 0)) || (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0)); });
    var lh = '', l, out, statusLabel;
    for (i = 0; i < list.length; i++) {
      l = list[i]; out = l.dir === 'out';
      statusLabel = l.repaid ? '已还清' : (out ? '待收回' : '待归还');
      lh += '<div class="item' + (l.repaid ? ' repaid' : '') + '"><div class="info"><div class="c"><span class="dot" aria-hidden="true">' + (out ? '📤' : '📥') + '</span>' +
        (out ? '借出给 ' : '借入自 ') + esc(l.person) + '</div><div class="n">' + esc(l.date) + ' · ' + statusLabel + (l.note ? ' · ' + esc(l.note) : '') + '</div></div>' +
        '<span class="amt ' + (out ? 'inc' : 'exp') + '">' + JZ.fmt(l.cents) + '</span>' +
        '<button type="button" class="status' + (l.repaid ? ' done' : '') + '" data-toggle="' + esc(l.id) + '" aria-label="' + (l.repaid ? '标为未还' : '标为已还') + '">' + (l.repaid ? '已还' : '未还') + '</button>' +
        '<button type="button" class="icon" data-ledit="' + esc(l.id) + '">编辑</button><button type="button" class="icon" data-lrm="' + esc(l.id) + '">删除</button></div>';
    }
    $('loanList').innerHTML = lh || emptyHTML('loan', '还没有借贷记录', '上面可以记一笔借出或借入');
  }
  $('loanList').addEventListener('click', function (ev) {
    var t = ev.target, tg = t.getAttribute('data-toggle'), ed = t.getAttribute('data-ledit'), rm = t.getAttribute('data-lrm'), i;
    if (tg) {
      i = find(db.loans, tg); if (i < 0) return; var l = db.loans[i];
      if (!l.repaid) {
        var d = prompt('标记为已还，还款日期：', today()); if (d === null) return;
        l.repaid = true; l.repaidDate = /^\d{4}-\d{2}-\d{2}$/.test(d.trim()) ? d.trim() : today();
      } else if (confirm('改回未还？')) { l.repaid = false; l.repaidDate = ''; } else return;
      save(); renderLoans();
    }
    if (rm && confirm('确定删除这条借贷记录？')) {
      i = find(db.loans, rm); if (i >= 0) { db.loans.splice(i, 1); save(); if (loan.editId === rm) resetLoan(); renderLoans(); }
    }
    if (ed) {
      i = find(db.loans, ed); if (i < 0) return; var o = db.loans[i];
      loan.editId = ed; loan.dir = o.dir; setToggle($('dirToggle'), 'data-dir', o.dir);
      $('loanPerson').value = o.person; $('loanAmount').value = JZ.fmt(o.cents); $('loanDate').value = o.date; $('loanNote').value = o.note || '';
      $('loanTitle').textContent = '✏️ 编辑借贷'; $('loanSave').textContent = '保存修改'; show($('loanCancel'), true);
      if ($('loanTitle').scrollIntoView) $('loanTitle').scrollIntoView();
    }
  });

  function bad(s) { var m = String(s).match(/\uFFFD/g); return m ? m.length : 0; }
  function decode(buf) {
    var bytes = new Uint8Array(buf), u = null, g = null;
    if (window.TextDecoder) {
      try { u = new TextDecoder('utf-8').decode(bytes); } catch (e) {}
      if (u !== null && !bad(u)) return { text: u.replace(/^\uFEFF/, ''), enc: 'UTF-8' };
      try { g = new TextDecoder('gb18030').decode(bytes); } catch (e2) {}
      if (g !== null && (u === null || bad(g) < bad(u))) return { text: g, enc: 'GB18030' };
      if (u !== null && g !== null) return { text: u.replace(/^\uFEFF/, ''), enc: 'UTF-8' };
    }
    if (window.cptable && cptable.utils) {
      try { u = cptable.utils.decode(65001, bytes); } catch (e3) { u = null; }
      if (u !== null && !bad(u)) return { text: u.replace(/^\uFEFF/, ''), enc: 'UTF-8' };
      try { return { text: cptable.utils.decode(936, bytes), enc: 'GBK' }; } catch (e4) {}
    }
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { text: s, enc: '未知' };
  }
  function catArg() { return { expense: JZ.categories(db, 'expense'), income: JZ.categories(db, 'income') }; }
  var imp = { rows: null, items: [], skipped: 0, header: 0 };
  function showPreview(name, items) {
    imp.items = JZ.markDuplicates(items, db.entries);
    $('fmtName').textContent = '（' + name + '）';
    show($('previewCard'), true);
    renderPreview();
  }
  function renderPreview() {
    var h = '', i, it;
    for (i = 0; i < imp.items.length; i++) {
      it = imp.items[i];
      h += '<div class="prow' + (it.dup ? ' dup' : '') + '"><div class="h"><input type="checkbox" data-i="' + i + '"' + (it.on ? ' checked' : '') + ' aria-label="选择这条">' +
        '<span class="d">' + esc(it.date) + ' ' + JZ.catIcon(it.cat) + '</span><span class="amt ' + (it.type === 'income' ? 'inc' : 'exp') + '">' + (it.type === 'income' ? '+' : '-') + JZ.fmt(it.cents) + '</span></div>' +
        '<div class="n">' + esc(it.note || '（无说明）') + '</div>' +
        '<div class="sel"><select data-ty="' + i + '" aria-label="收支"><option value="expense"' + (it.type === 'expense' ? ' selected' : '') + '>支出</option><option value="income"' + (it.type === 'income' ? ' selected' : '') + '>收入</option></select>' +
        '<select data-ca="' + i + '" aria-label="分类">' + catOptions(it.type, it.cat) + '</select></div>' +
        (it.dup ? '<div class="flag">疑似重复，默认不导入（已有相同日期、金额和备注）</div>' : '') + '</div>';
    }
    $('previewList').innerHTML = h || '<div class="empty"><div class="msg">没有可导入的收支记录</div></div>';
    updateStat();
  }
  function updateStat() {
    var n = 0, inc = 0, exp = 0, dup = 0, i, it;
    for (i = 0; i < imp.items.length; i++) {
      it = imp.items[i];
      if (it.dup) dup++;
      if (!it.on) continue;
      n++;
      if (it.type === 'income') inc += it.cents; else exp += it.cents;
    }
    $('pvN').textContent = String(n);
    $('pvIn').textContent = JZ.fmt(inc);
    $('pvOut').textContent = JZ.fmt(exp);
    $('previewStat').textContent = '共解析 ' + imp.items.length + ' 条' +
      (dup ? '，' + dup + ' 条疑似重复，默认不勾选' : '') +
      (imp.skipped ? '。已跳过 ' + imp.skipped + ' 条关闭、失败或退款' : '');
    $('impConfirm').textContent = '导入选中的 ' + n + ' 条';
    $('impConfirm').disabled = !n;
  }
  $('previewList').addEventListener('change', function (ev) {
    var t = ev.target, i;
    if ((i = t.getAttribute('data-i')) !== null) { imp.items[+i].on = t.checked; updateStat(); }
    else if ((i = t.getAttribute('data-ty')) !== null) {
      var it = imp.items[+i]; it.type = t.value; it.cat = JZ.guessCat(it.type, it.note, JZ.categories(db, it.type)); renderPreview();
    } else if ((i = t.getAttribute('data-ca')) !== null) imp.items[+i].cat = t.value;
  });
  $('selAll').addEventListener('click', function () { imp.items.forEach(function (it) { it.on = true; }); renderPreview(); });
  $('selNone').addEventListener('click', function () { imp.items.forEach(function (it) { it.on = false; }); renderPreview(); });
  $('impConfirm').addEventListener('click', function () {
    var sel = imp.items.filter(function (it) { return it.on; });
    if (!sel.length) return;
    var t = Date.now(), before = db.entries.length;
    sel.forEach(function (it, k) {
      db.entries.push({ id: uid() + k, ts: t + k, type: it.type, cents: it.cents, cat: it.cat, date: it.date, note: it.note, photo: false });
    });
    if (!save()) { db.entries.splice(before, db.entries.length - before); return; }
    alert('已导入 ' + sel.length + ' 条记录');
    toast('导入成功 · ' + sel.length + ' 条', true);
    imp.items = []; show($('previewCard'), false); show($('mapCard'), false);
    $('impMsg').textContent = '已导入 ' + sel.length + ' 条记录。';
    var last = sel[0].date; state.y = +last.slice(0, 4); state.m = +last.slice(5, 7);
    render();
  });
  function colOptions(hdr) {
    var h = '<option value="-1">（无）</option>', i;
    for (i = 0; i < hdr.length; i++) h += '<option value="' + i + '">第' + (i + 1) + '列：' + esc(String(hdr[i] || '').slice(0, 12)) + '</option>';
    return h;
  }
  function fillMap() {
    var r = +$('mapHeader').value, hdr = imp.rows[r] || [];
    ['mapDate', 'mapAmount', 'mapDesc'].forEach(function (id) { $(id).innerHTML = colOptions(hdr); });
    var dateCol = JZ.findCol(hdr, ['交易时间', '交易创建时间', '付款时间', '交易日期', '记账日期', '入账日期', '日期', '时间', 'date']);
    var amtCol = JZ.findCol(hdr, ['金额(元)', '金额（元）', '交易金额', '发生额', '金额', 'amount'], /余额/);
    var descCol = JZ.findCol(hdr, ['商品说明', '商品', '摘要', '交易对方', '备注', 'description']);
    if (dateCol >= 0) $('mapDate').value = String(dateCol);
    if (amtCol >= 0) $('mapAmount').value = String(amtCol);
    if (descCol >= 0) $('mapDesc').value = String(descCol);
  }
  function showMap() {
    var h = '', lim = Math.min(imp.rows.length, 30), r;
    for (r = 0; r < lim; r++) h += '<option value="' + r + '">第' + (r + 1) + '行：' + esc(imp.rows[r].join(' | ').slice(0, 30)) + '</option>';
    $('mapHeader').innerHTML = h;
    if (imp.header != null && $('mapHeader').querySelector('option[value="' + imp.header + '"]')) $('mapHeader').value = String(imp.header);
    fillMap(); show($('mapCard'), true);
  }
  $('mapHeader').addEventListener('change', fillMap);
  $('manualBtn').addEventListener('click', function () {
    if (!imp.rows || !imp.rows.length) { toast('请先选择账单文件'); return; }
    showMap();
    if ($('mapCard').scrollIntoView) $('mapCard').scrollIntoView();
  });
  $('mapApply').addEventListener('click', function () {
    var c = { date: +$('mapDate').value, amount: +$('mapAmount').value, desc: +$('mapDesc').value >= 0 ? [+$('mapDesc').value] : [], io: -1, inc: -1, exp: -1, status: -1, cat: -1 };
    if (c.date < 0 || c.amount < 0) { alert('请选择日期列和金额列'); return; }
    var parsed = JZ.mapRows(imp.rows, +$('mapHeader').value, c, catArg());
    imp.skipped = parsed.skipped;
    if (!parsed.items.length) { alert('按所选列没有解析到记录，请检查'); return; }
    showPreview('手动指定列', parsed.items);
  });
  function handleRows(rows, enc) {
    imp.rows = rows.filter(function (r) { return r.join('') !== ''; });
    show($('previewCard'), false); show($('mapCard'), false);
    var f = JZ.detect(imp.rows);
    imp.header = f ? f.header : 0;
    if (f) {
      var parsed = JZ.mapRows(imp.rows, f.header, f.cols, catArg());
      imp.skipped = parsed.skipped;
      $('impMsg').textContent = '识别为：' + f.name + (enc ? '（编码 ' + enc + '）' : '');
      if (parsed.items.length) { showPreview(f.name, parsed.items); return; }
      $('impMsg').textContent += '，但没有可导入的收支记录' + (parsed.skipped ? '（已跳过 ' + parsed.skipped + ' 条关闭、失败或退款）' : '') + '，可手动指定列。';
    } else $('impMsg').textContent = '未能自动识别格式' + (enc ? '（编码 ' + enc + '）' : '') + '，请手动指定列。';
    if (imp.rows.length) showMap();
  }
  $('stmtFile').addEventListener('change', function () {
    var f = this.files && this.files[0], inp = this; if (!f) return;
    $('impMsg').textContent = '正在读取 ' + f.name + ' …';
    var rd = new FileReader();
    rd.onload = function () {
      inp.value = '';
      try {
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          if (!window.XLSX) throw new Error('Excel 组件未加载');
          var wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: true, codepage: 936 });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
          handleRows(rows.map(function (r) { return r.map(JZ.clean); }), '');
        } else {
          var d = decode(rd.result);
          handleRows(JZ.parseCSV(d.text), d.enc);
        }
      } catch (e) { $('impMsg').textContent = '读取失败：' + (e.message || e); }
    };
    rd.onerror = function () { $('impMsg').textContent = '文件读取失败'; };
    rd.readAsArrayBuffer(f);
  });

  $('exportBtn').addEventListener('click', function () {
    var photos = null;
    if ($('incPhotos').checked) {
      photos = {};
      db.entries.forEach(function (e) { if (e.photo) { var p = getPhoto(e.id); if (p) photos[e.id] = p; } });
    }
    var data = JZ.exportPayload(db, photos);
    var json = JSON.stringify(data);
    var box = $('backupBox'); show(box, true); box.value = json;
    try {
      var a = document.createElement('a');
      if (window.Blob && window.URL && URL.createObjectURL) a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      else a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
      a.download = 'jizhang-backup-' + today() + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {}
    box.select();
    alert('已导出（含记账、借贷、预算和自定义分类' + (photos ? '、照片' : '') + '，约 ' + kb(json.length * 2) + '）。若未自动下载（如在微信中），请复制文本框内容保存。');
  });
  function doImport(text) {
    try {
      var prepared = JZ.prepareBackup(text);
      var d = prepared.db, photos = prepared.photos || {};
      if (!confirm('导入将覆盖当前数据（' + d.entries.length + ' 条记账、' + d.loans.length + ' 条借贷），确定？')) return;
      var old = db; db = d;
      if (!save()) { db = old; return; }
      var fail = 0;
      d.entries.forEach(function (e) {
        if (photos[e.id]) { try { localStorage.setItem(PHOTO + e.id, photos[e.id]); e.photo = true; } catch (x) { fail++; e.photo = false; } }
        else if (e.photo && !getPhoto(e.id)) e.photo = false;
      });
      save(); renderCats(); render(); renderLoans();
      alert('导入成功' + (fail ? '，但有 ' + fail + ' 张照片因存储空间不足未能导入' : ''));
    } catch (e) { alert('备份内容格式不正确'); }
  }
  $('importBtn').addEventListener('click', function () {
    var box = $('backupBox');
    if (!box.classList.contains('hidden') && box.value.trim()) { doImport(box.value.trim()); return; }
    $('importFile').click();
  });
  $('importFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var r = new FileReader(); r.onload = function () { doImport(r.result); }; r.readAsText(f); this.value = '';
  });

  $('date').value = today(); $('loanDate').value = today();
  setType('expense', false); render(); renderLoans();
  if (window.IntersectionObserver) {
    var dockObserver = new IntersectionObserver(function (entries) {
      var onBook = !$('tab-book').classList.contains('hidden');
      document.body.classList.toggle('dock-on', onBook && entries[0].isIntersecting);
    }, { threshold: 0.2 });
    dockObserver.observe($('entryCard'));
  }
  window.__jizhang = { db: function () { return db; }, JZ: JZ };
})();

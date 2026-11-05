(function () {
  'use strict';
  var KEY = 'jizhang_v1';
  var PHOTO = KEY + '_photo_';
  var PRESET = {
    expense: ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他'],
    income: ['工资', '奖金', '理财', '红包', '其他']
  };
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmt(c) { return (c / 100).toFixed(2); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function show(el, on) { el.classList[on ? 'remove' : 'add']('hidden'); }
  function isQuota(e) { return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014); }
  var QUOTA_MSG = '手机浏览器存储空间已满（约5MB），无法保存。请删除部分照片或导出备份后清理旧记录。';

  var CAT_ICON = {
    '餐饮': '🍜', '交通': '🚌', '购物': '🛍️', '娱乐': '🎬', '居住': '🏠',
    '医疗': '💊', '教育': '📚', '其他': '✨', '工资': '💼', '奖金': '🎁',
    '理财': '📈', '红包': '🧧'
  };
  function catIcon(c) { return CAT_ICON[c] || '⭐'; }
  function emptyHTML(kind, msg, sub) {
    var src = 'assets/empty-' + kind + '.svg';
    return '<div class="empty"><img src="' + src + '" alt=""><div class="msg">' + msg + '</div><div class="sub">' + sub + '</div></div>';
  }
  var toastTimer = null;
  function toast(msg, ok) {
    var el = $('toast'); if (!el) return;
    el.textContent = msg;
    el.className = ok ? 'show ok' : 'show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 1800);
  }

  // 金额字符串 -> 分（整数），用户输入校验：正数，最多两位小数
  function userCents(v) {
    v = String(v).replace(/\s/g, '').replace('，', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(v) || parseFloat(v) <= 0 || parseFloat(v) > 99999999) return null;
    var p = v.split('.');
    return parseInt(p[0], 10) * 100 + (p[1] ? parseInt((p[1] + '0').slice(0, 2), 10) : 0);
  }

  // ---------- 数据 ----------
  function normalize(d) {
    if (!d || !(d.entries instanceof Array)) throw new Error('bad');
    d.custom = d.custom || {}; d.custom.expense = d.custom.expense || []; d.custom.income = d.custom.income || [];
    d.loans = d.loans instanceof Array ? d.loans : [];
    d.version = 2;
    return d;
  }
  function blank() { return normalize({ entries: [] }); }
  function load() {
    var raw;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { return blank(); }
    if (!raw) return blank();
    try { return normalize(JSON.parse(raw)); }
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
  function storageUsed() {
    var n = 0, total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i), v = localStorage.getItem(k) || '';
        total += (k.length + v.length) * 2; // UTF-16 约2字节/字符
        if (k.indexOf(PHOTO) === 0) n++;
      }
    } catch (e) {}
    return { bytes: total, photos: n };
  }
  function kb(b) { return b > 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB'; }

  // ---------- 标签页 ----------
  var tabbar = document.querySelector('.tabbar');
  tabbar.addEventListener('click', function (ev) {
    var btn = ev.target;
    while (btn && btn !== tabbar && (!btn.getAttribute || !btn.getAttribute('data-tab'))) btn = btn.parentNode;
    if (!btn || btn === tabbar) return;
    var t = btn.getAttribute('data-tab'); if (!t) return;
    var bs = tabbar.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute('data-tab') === t;
      bs[i].className = on ? 'on' : '';
      bs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    show($('tab-book'), t === 'book'); show($('tab-loan'), t === 'loan'); show($('tab-import'), t === 'import');
    window.scrollTo(0, 0);
    if (t === 'book') render(); if (t === 'loan') renderLoans();
  });

  // ---------- 记账 ----------
  var now = new Date();
  var state = { y: now.getFullYear(), m: now.getMonth() + 1, type: 'expense', cat: null, editId: null, breakType: 'expense', photo: undefined };
  function monthKey() { return state.y + '-' + pad(state.m); }
  function cats(t) { return PRESET[t].concat(db.custom[t]); }

  function renderCats() {
    var list = cats(state.type), h = '';
    if (list.indexOf(state.cat) < 0) state.cat = list[0];
    for (var i = 0; i < list.length; i++) {
      var c = list[i], custom = db.custom[state.type].indexOf(c) >= 0;
      h += '<button type="button" class="cat cat-' + esc(c) + (c === state.cat ? ' on' : '') + '" data-cat="' + esc(c) + '"><span class="ico" aria-hidden="true">' + catIcon(c) + '</span>' + esc(c) +
        (custom ? '<span class="x" data-del="' + esc(c) + '">×</span>' : '') + '</button>';
    }
    h += '<button type="button" class="cat add" data-add="1"><span class="ico">＋</span>自定义</button>';
    $('cats').innerHTML = h;
  }
  function setToggle(box, attr, val) {
    var bs = box.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].className = bs[i].getAttribute(attr) === val ? 'on' : '';
  }
  function setType(t) {
    state.type = t; setToggle($('typeToggle'), 'data-type', t); renderCats();
    var box = $('typeToggle');
    if (box) { if (t === 'income') box.classList.add('income-on'); else box.classList.remove('income-on'); }
  }

  function monthEntries() {
    var k = monthKey();
    return db.entries.filter(function (e) { return e.date.slice(0, 7) === k; });
  }
  function render() {
    $('monthLabel').textContent = state.y + '年' + state.m + '月';
    var es = monthEntries(), inc = 0, exp = 0;
    es.forEach(function (e) { if (e.type === 'income') inc += e.cents; else exp += e.cents; });
    $('sumIn').textContent = fmt(inc); $('sumOut').textContent = fmt(exp);
    var bal = inc - exp;
    $('sumBal').textContent = (bal < 0 ? '-' : '') + fmt(Math.abs(bal));
    $('sumBal').className = bal < 0 ? 'exp' : '';
    var bt = state.breakType, totals = {}, total = 0;
    es.forEach(function (e) { if (e.type === bt) { totals[e.cat] = (totals[e.cat] || 0) + e.cents; total += e.cents; } });
    var keys = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    $('breakType').textContent = bt === 'income' ? '（收入）' : '（支出）';
    var bh = '';
    keys.forEach(function (k) {
      var p = total ? totals[k] / total * 100 : 0;
      bh += '<div class="bar ' + bt + '"><div class="t"><span>' + esc(k) + ' ' + p.toFixed(1) + '%</span><span>¥' + fmt(totals[k]) +
        '</span></div><div class="track"><div class="fill" style="width:' + p.toFixed(1) + '%"></div></div></div>';
    });
    $('breakdown').innerHTML = bh || emptyHTML('book', '还没有' + (bt === 'income' ? '收入' : '支出'), '记一笔就能看到分类占比啦');
    es.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.ts - a.ts; });
    var lh = '', cur = null;
    es.forEach(function (e) {
      if (e.date !== cur) { cur = e.date; lh += '<div class="day"><span>' + e.date.slice(5).replace('-', '月') + '日</span></div>'; }
      var isIn = e.type === 'income', ph = e.photo ? getPhoto(e.id) : null;
      lh += '<div class="item">' + (ph ? '<button class="pic" data-view="' + e.id + '"><img src="' + ph + '" alt="照片" data-view="' + e.id + '"></button>' : '') +
        '<div class="info"><div class="c"><span class="dot" aria-hidden="true">' + catIcon(e.cat) + '</span>' + esc(e.cat) + '</div>' + (e.note ? '<div class="n">' + esc(e.note) + '</div>' : '') +
        '</div><span class="amt ' + (isIn ? 'inc' : 'exp') + '">' + (isIn ? '+' : '-') + fmt(e.cents) + '</span>' +
        '<button class="icon" data-edit="' + e.id + '" aria-label="编辑">编辑</button><button class="icon" data-rm="' + e.id + '" aria-label="删除">删除</button></div>';
    });
    $('list').innerHTML = lh || emptyHTML('book', '本月还是空白的', '记一笔，开启本月账本吧');
    var s = storageUsed();
    $('storageInfo').textContent = '已用存储约 ' + kb(s.bytes) + '（含 ' + s.photos + ' 张照片），浏览器上限通常约 5 MB。';
  }

  function setPhotoPreview(src) {
    var img = $('photoPreview');
    if (src) { img.src = src; show(img, true); show($('photoRemove'), true); $('photoLabel').textContent = '📷 更换照片'; }
    else { img.removeAttribute('src'); show(img, false); show($('photoRemove'), false); $('photoLabel').textContent = '📷 添加照片'; }
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
    var cents = userCents($('amount').value);
    if (cents === null) { $('err').textContent = '请输入大于0的金额，最多两位小数'; return; }
    var d = $('date').value || today();
    var e = { type: state.type, cents: cents, cat: state.cat, date: d, note: $('note').value.trim() };
    var i = state.editId ? find(db.entries, state.editId) : -1, old = i >= 0 ? db.entries[i] : null;
    e.id = old ? old.id : uid(); e.ts = old ? old.ts : Date.now(); e.photo = old ? !!old.photo : false;
    if (state.photo === null) { delPhoto(e.id); e.photo = false; }
    else if (state.photo) { e.photo = setPhoto(e.id, state.photo) ? true : e.photo; }
    if (old) db.entries[i] = e; else db.entries.push(e);
    save();
    state.y = +d.slice(0, 4); state.m = +d.slice(5, 7);
    resetForm(); render();
    toast(old ? '✏️ 已更新' : '🎉 记好啦', true);
  });
  $('cancelEdit').addEventListener('click', resetForm);
  $('typeToggle').addEventListener('click', function (ev) { var t = ev.target.getAttribute('data-type'); if (t) setType(t); });
  $('cats').addEventListener('click', function (ev) {
    var t = ev.target, del = t.getAttribute('data-del');
    if (del) {
      if (confirm('删除自定义分类「' + del + '」？（已有记录不受影响）')) {
        db.custom[state.type] = db.custom[state.type].filter(function (c) { return c !== del; }); save(); renderCats();
      }
      return;
    }
    if (t.getAttribute('data-add')) {
      var n = prompt('新分类名称：');
      if (n === null) return; n = n.trim().slice(0, 8);
      if (!n) return;
      if (cats(state.type).indexOf(n) >= 0) { alert('分类已存在'); return; }
      db.custom[state.type].push(n); save(); state.cat = n; renderCats(); return;
    }
    var c = t.getAttribute('data-cat'); if (c) { state.cat = c; renderCats(); }
  });
  $('breakToggle').addEventListener('click', function (ev) {
    var t = ev.target.getAttribute('data-type'); if (!t) return;
    state.breakType = t; setToggle(this, 'data-type', t); render();
  });
  $('list').addEventListener('click', function (ev) {
    var rm = ev.target.getAttribute('data-rm'), ed = ev.target.getAttribute('data-edit'), vw = ev.target.getAttribute('data-view'), i;
    if (vw) { openModal(getPhoto(vw)); return; }
    if (rm && confirm('确定删除这条记录？')) {
      i = find(db.entries, rm);
      if (i >= 0) { db.entries.splice(i, 1); delPhoto(rm); save(); if (state.editId === rm) resetForm(); render(); }
    }
    if (ed) {
      i = find(db.entries, ed); if (i < 0) return; var e = db.entries[i];
      resetForm();
      state.editId = ed; state.cat = e.cat; setType(e.type);
      $('amount').value = fmt(e.cents); $('date').value = e.date; $('note').value = e.note || '';
      setPhotoPreview(e.photo ? getPhoto(e.id) : null);
      $('formTitle').textContent = '✏️ 编辑记录'; $('saveBtn').textContent = '保存修改'; show($('cancelEdit'), true);
      window.scrollTo(0, $('formTitle').offsetTop - 10);
    }
  });
  function shift(n) { state.m += n; if (state.m < 1) { state.m = 12; state.y--; } if (state.m > 12) { state.m = 1; state.y++; } render(); }
  $('prevM').addEventListener('click', function () { shift(-1); });
  $('nextM').addEventListener('click', function () { shift(1); });

  // ---------- 照片 ----------
  function openModal(src) { if (!src) return; $('modalImg').src = src; show($('modal'), true); }
  $('modal').addEventListener('click', function () { show($('modal'), false); $('modalImg').removeAttribute('src'); });
  // 压缩：最长边1024，JPEG 质量0.7起逐步降低，目标 <200KB
  // 现代浏览器（Chrome 81+/iOS 13.4+）绘制 <img> 时会自动按 EXIF 方向旋转
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

  // ---------- 借贷 ----------
  var loan = { dir: 'out', editId: null };
  $('dirToggle').addEventListener('click', function (ev) { var d = ev.target.getAttribute('data-dir'); if (d) { loan.dir = d; setToggle(this, 'data-dir', d); } });
  function resetLoan() {
    loan.editId = null; $('loanPerson').value = ''; $('loanAmount').value = ''; $('loanNote').value = ''; $('loanDate').value = today();
    $('loanErr').textContent = ''; $('loanTitle').textContent = '➕ 新增借贷'; $('loanSave').textContent = '保存'; show($('loanCancel'), false);
  }
  $('loanCancel').addEventListener('click', resetLoan);
  $('loanForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var person = $('loanPerson').value.trim(), cents = userCents($('loanAmount').value);
    if (!person) { $('loanErr').textContent = '请输入对方姓名'; return; }
    if (cents === null) { $('loanErr').textContent = '请输入大于0的金额，最多两位小数'; return; }
    var item = { dir: loan.dir, person: person, cents: cents, date: $('loanDate').value || today(), note: $('loanNote').value.trim() };
    var i = loan.editId ? find(db.loans, loan.editId) : -1;
    if (i >= 0) { var o = db.loans[i]; item.id = o.id; item.ts = o.ts; item.repaid = o.repaid; item.repaidDate = o.repaidDate; db.loans[i] = item; }
    else { item.id = uid(); item.ts = Date.now(); item.repaid = false; item.repaidDate = ''; db.loans.push(item); }
    save(); resetLoan(); renderLoans();
    toast(i >= 0 ? '✏️ 借贷已更新' : '🤝 借贷已记下', true);
  });
  function renderLoans() {
    var owed = 0, owe = 0, per = {};
    db.loans.forEach(function (l) {
      if (l.repaid) return;
      if (l.dir === 'out') owed += l.cents; else owe += l.cents;
      per[l.person] = (per[l.person] || 0) + (l.dir === 'out' ? l.cents : -l.cents);
    });
    $('owedMe').textContent = fmt(owed); $('iOwe').textContent = fmt(owe);
    var ph = '';
    Object.keys(per).sort(function (a, b) { return Math.abs(per[b]) - Math.abs(per[a]); }).forEach(function (p) {
      var v = per[p];
      ph += '<div class="item"><div class="info"><div class="c"><span class="dot" aria-hidden="true">👤</span>' + esc(p) + '</div></div><span class="amt ' + (v >= 0 ? 'inc' : 'exp') + '">' +
        (v > 0 ? '欠我 ' + fmt(v) : v < 0 ? '我欠 ' + fmt(-v) : '已抵平') + '</span></div>';
    });
    $('perPerson').innerHTML = ph || emptyHTML('loan', '大家都两清啦', '暂时没有未还的借贷');
    var list = db.loans.slice().sort(function (a, b) { return (a.repaid - b.repaid) || (a.date < b.date ? 1 : a.date > b.date ? -1 : b.ts - a.ts); });
    var lh = '';
    list.forEach(function (l) {
      var out = l.dir === 'out';
      lh += '<div class="item' + (l.repaid ? ' repaid' : '') + '"><div class="info"><div class="c"><span class="dot" aria-hidden="true">' + (out ? '📤' : '📥') + '</span>' + (out ? '借出给 ' : '借入自 ') + esc(l.person) + '</div>' +
        '<div class="n">' + esc(l.date) + (l.repaid ? ' · ' + esc(l.repaidDate) + ' 已还' : '') + (l.note ? ' · ' + esc(l.note) : '') + '</div></div>' +
        '<span class="amt ' + (out ? 'inc' : 'exp') + '">' + fmt(l.cents) + '</span>' +
        '<button class="status' + (l.repaid ? ' done' : '') + '" data-toggle="' + l.id + '">' + (l.repaid ? '已还' : '未还') + '</button>' +
        '<button class="icon" data-ledit="' + l.id + '">编辑</button><button class="icon" data-lrm="' + l.id + '">删除</button></div>';
    });
    $('loanList').innerHTML = lh || emptyHTML('loan', '还没有借贷记录', '记一笔借出或借入吧');
  }
  $('loanList').addEventListener('click', function (ev) {
    var t = ev.target, tg = t.getAttribute('data-toggle'), ed = t.getAttribute('data-ledit'), rm = t.getAttribute('data-lrm'), i;
    if (tg) {
      i = find(db.loans, tg); if (i < 0) return; var l = db.loans[i];
      if (!l.repaid) {
        var d = prompt('标记为已还，还款日期：', today()); if (d === null) return;
        l.repaid = true; l.repaidDate = /^\d{4}-\d{2}-\d{2}$/.test(d.trim()) ? d.trim() : today();
      } else if (confirm('改回“未还”？')) { l.repaid = false; l.repaidDate = ''; } else return;
      save(); renderLoans();
    }
    if (rm && confirm('确定删除这条借贷记录？')) { i = find(db.loans, rm); if (i >= 0) { db.loans.splice(i, 1); save(); if (loan.editId === rm) resetLoan(); renderLoans(); } }
    if (ed) {
      i = find(db.loans, ed); if (i < 0) return; var o = db.loans[i];
      loan.editId = ed; loan.dir = o.dir; setToggle($('dirToggle'), 'data-dir', o.dir);
      $('loanPerson').value = o.person; $('loanAmount').value = fmt(o.cents); $('loanDate').value = o.date; $('loanNote').value = o.note || '';
      $('loanTitle').textContent = '✏️ 编辑借贷'; $('loanSave').textContent = '保存修改'; show($('loanCancel'), true);
      window.scrollTo(0, $('loanTitle').offsetTop - 10);
    }
  });

  // ---------- 账单导入 ----------
  function clean(c) { return String(c == null ? '' : c).replace(/^[\s\uFEFF\u00A0]+|[\s\u00A0]+$/g, ''); }
  function parseCSV(text) {
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
  function bad(s) { var m = s.match(/\uFFFD/g); return m ? m.length : 0; }
  function decode(buf) {
    var bytes = new Uint8Array(buf), u = null, g = null;
    if (window.TextDecoder) {
      try { u = new TextDecoder('utf-8').decode(bytes); } catch (e) {}
      if (u !== null && !bad(u)) return { text: u.replace(/^\uFEFF/, ''), enc: 'UTF-8' };
      try { g = new TextDecoder('gb18030').decode(bytes); } catch (e) {}
      if (g !== null && (u === null || bad(g) < bad(u))) return { text: g, enc: 'GB18030' };
      if (u !== null && g !== null) return { text: u.replace(/^\uFEFF/, ''), enc: 'UTF-8' };
    }
    // 旧浏览器无 TextDecoder/gb18030：用 SheetJS 内置代码页
    if (window.cptable && cptable.utils) {
      try { u = cptable.utils.decode(65001, bytes); } catch (e) { u = null; }
      if (u !== null && !bad(u)) return { text: u.replace(/^\uFEFF/, ''), enc: 'UTF-8' };
      try { return { text: cptable.utils.decode(936, bytes), enc: 'GBK' }; } catch (e) {}
    }
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { text: s, enc: '未知' };
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
    var i, k;
    for (k = 0; k < kws.length; k++) for (i = 0; i < hdr.length; i++) if (hdr[i].toLowerCase() === kws[k]) return i;
    for (k = 0; k < kws.length; k++) for (i = 0; i < hdr.length; i++) {
      var h = hdr[i].toLowerCase();
      if (h && h.indexOf(kws[k]) >= 0 && !(excl && excl.test(h))) return i;
    }
    return -1;
  }
  function findCols(hdr, kws) {
    var out = [];
    kws.forEach(function (k) { var i = findCol(hdr, [k]); if (i >= 0 && out.indexOf(i) < 0) out.push(i); });
    return out;
  }
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
  function guessCat(type, text) {
    var r = RULES[type];
    for (var i = 0; i < r.length; i++) if (r[i][1].test(text)) return r[i][0];
    var cs = cats(type);
    for (i = 0; i < cs.length; i++) if (cs[i] !== '其他' && text.indexOf(cs[i]) >= 0) return cs[i];
    return '其他';
  }
  var SKIP_STATUS = /关闭|失败|全额退款|退款成功|已撤销|撤销|已退款/;
  function mapRows(rows, h, c) {
    var out = [];
    for (var r = h + 1; r < rows.length; r++) {
      var row = rows[r]; if (!row) continue;
      var date = parseDate(row[c.date] || ''); if (!date) continue;
      if (c.status >= 0 && SKIP_STATUS.test(row[c.status] || '')) continue;
      var type = null, cents = null;
      if (c.io >= 0) {
        var io = clean(row[c.io]);
        if (/收入|^收$|^贷$|贷方/.test(io)) type = 'income';
        else if (/支出|^支$|^借$|借方/.test(io)) type = 'expense';
        else continue; // 不计收支、/ 等
        cents = parseAmt(row[c.amount]); if (cents === null) continue; cents = Math.abs(cents);
      } else if (c.inc >= 0 && c.exp >= 0) {
        var a = parseAmt(row[c.inc]), b = parseAmt(row[c.exp]);
        if (a) { type = 'income'; cents = Math.abs(a); } else if (b) { type = 'expense'; cents = Math.abs(b); } else continue;
      } else {
        cents = parseAmt(row[c.amount]); if (!cents) continue;
        type = cents < 0 ? 'expense' : 'income'; cents = Math.abs(cents);
      }
      if (!cents) continue;
      var parts = [];
      c.desc.forEach(function (i) { var v = clean(row[i]); if (v && v !== '/' && parts.indexOf(v) < 0) parts.push(v); });
      var note = parts.join(' ').slice(0, 50);
      var hay = (c.cat >= 0 ? clean(row[c.cat]) + ' ' : '') + note;
      out.push({ type: type, cents: cents, date: date, note: note, cat: guessCat(type, hay) });
    }
    return out;
  }
  function detect(rows) {
    var lim = Math.min(rows.length, 60), r, hdr;
    for (r = 0; r < lim; r++) {
      hdr = rows[r]; if (!hdr || hdr.length < 3) continue;
      var tCol = findCol(hdr, ['交易时间', '交易创建时间', '付款时间']), ioCol = findCol(hdr, ['收/支', '收支']);
      if (tCol >= 0 && ioCol >= 0) {
        var wx = findCol(hdr, ['当前状态']) >= 0 || findCol(hdr, ['支付方式']) >= 0 && findCol(hdr, ['交易类型']) >= 0;
        return {
          name: wx ? '微信支付账单' : '支付宝账单', header: r,
          cols: { date: tCol, io: ioCol, amount: findCol(hdr, ['金额(元)', '金额（元）', '金额'], /余额/),
            status: findCol(hdr, wx ? ['当前状态'] : ['交易状态']), inc: -1, exp: -1,
            cat: findCol(hdr, wx ? ['交易类型'] : ['交易分类', '类型']),
            desc: findCols(hdr, ['交易对方', '商品说明', '商品名称', '商品']) }
        };
      }
    }
    for (r = 0; r < lim; r++) {
      hdr = rows[r]; if (!hdr || hdr.length < 2) continue;
      var d = findCol(hdr, ['交易日期', '记账日期', '交易时间', '入账日期', '日期', '时间', 'date', 'transaction date']);
      if (d < 0) continue;
      var inc = findCol(hdr, ['收入金额', '贷方金额', '收入', '贷方发生额', '贷方', 'credit'], /余额/);
      var exp = findCol(hdr, ['支出金额', '借方金额', '支出', '借方发生额', '借方', 'debit'], /余额/);
      var amt = findCol(hdr, ['交易金额', '发生额', '金额', 'amount'], /余额|balance/);
      var io = findCol(hdr, ['收/支', '收支', '借贷标志', '借贷', '收付']);
      if (inc === exp) inc = exp = -1;
      if (amt < 0 && (inc < 0 || exp < 0)) continue;
      return {
        name: '银行流水（通用）', header: r,
        cols: { date: d, amount: amt, inc: amt >= 0 && io >= 0 ? -1 : inc, exp: amt >= 0 && io >= 0 ? -1 : exp,
          io: amt >= 0 ? io : -1, status: findCol(hdr, ['交易状态', '状态']), cat: -1,
          desc: findCols(hdr, ['摘要', '交易摘要', '对方户名', '对方账户名', '交易对方', '对方', '备注', '附言', '用途', '交易类型', 'description', 'memo']) }
      };
    }
    return null;
  }

  var imp = { rows: null, items: [] };
  function dupKey(e) { return e.date + '|' + e.cents + '|' + (e.note || ''); }
  function showPreview(name, items) {
    var keys = {};
    db.entries.forEach(function (e) { keys[dupKey(e)] = 1; });
    items.forEach(function (it) { it.dup = !!keys[dupKey(it)]; it.on = !it.dup; });
    imp.items = items;
    $('fmtName').textContent = '（' + name + '）';
    show($('previewCard'), true);
    renderPreview();
  }
  function catOptions(type, sel) {
    return cats(type).map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }
  function renderPreview() {
    var h = '';
    imp.items.forEach(function (it, i) {
      h += '<div class="prow' + (it.dup ? ' dup' : '') + '"><div class="h"><input type="checkbox" data-i="' + i + '"' + (it.on ? ' checked' : '') + '>' +
        '<span class="d">' + it.date + '</span><span class="amt ' + (it.type === 'income' ? 'inc' : 'exp') + '">' + (it.type === 'income' ? '+' : '-') + fmt(it.cents) + '</span></div>' +
        '<div class="n">' + esc(it.note || '（无说明）') + '</div>' +
        '<div class="sel"><select data-ty="' + i + '"><option value="expense"' + (it.type === 'expense' ? ' selected' : '') + '>支出</option><option value="income"' + (it.type === 'income' ? ' selected' : '') + '>收入</option></select>' +
        '<select data-ca="' + i + '">' + catOptions(it.type, it.cat) + '</select></div>' +
        (it.dup ? '<div class="flag">⚠ 可能重复（已有相同日期、金额和备注的记录）</div>' : '') + '</div>';
    });
    $('previewList').innerHTML = h || '<div class="empty">没有可导入的收支记录</div>';
    updateStat();
  }
  function updateStat() {
    var n = 0, inc = 0, exp = 0, dup = 0;
    imp.items.forEach(function (it) { if (it.dup) dup++; if (!it.on) return; n++; if (it.type === 'income') inc += it.cents; else exp += it.cents; });
    $('previewStat').textContent = '共解析 ' + imp.items.length + ' 条，已选 ' + n + ' 条' + (dup ? '（' + dup + ' 条疑似重复未勾选）' : '') +
      '；收入 ¥' + fmt(inc) + '，支出 ¥' + fmt(exp);
    $('impConfirm').disabled = !n;
  }
  $('previewList').addEventListener('change', function (ev) {
    var t = ev.target, i;
    if ((i = t.getAttribute('data-i')) !== null) { imp.items[+i].on = t.checked; updateStat(); }
    else if ((i = t.getAttribute('data-ty')) !== null) { var it = imp.items[+i]; it.type = t.value; it.cat = guessCat(it.type, it.note); renderPreview(); }
    else if ((i = t.getAttribute('data-ca')) !== null) { imp.items[+i].cat = t.value; }
  });
  $('selAll').addEventListener('click', function () { imp.items.forEach(function (it) { it.on = true; }); renderPreview(); });
  $('selNone').addEventListener('click', function () { imp.items.forEach(function (it) { it.on = false; }); renderPreview(); });
  $('impConfirm').addEventListener('click', function () {
    var sel = imp.items.filter(function (it) { return it.on; });
    if (!sel.length) return;
    var t = Date.now();
    sel.forEach(function (it, k) { db.entries.push({ id: uid() + k, ts: t + k, type: it.type, cents: it.cents, cat: it.cat, date: it.date, note: it.note, photo: false }); });
    if (!save()) { db.entries.splice(db.entries.length - sel.length, sel.length); return; }
    alert('已导入 ' + sel.length + ' 条记录');
    toast('📥 导入成功 · ' + sel.length + ' 条', true);
    imp.items = []; show($('previewCard'), false); show($('mapCard'), false); $('impMsg').textContent = '已导入 ' + sel.length + ' 条记录。';
    var last = sel[0].date; state.y = +last.slice(0, 4); state.m = +last.slice(5, 7);
  });

  function colOptions(hdr) {
    var h = '<option value="-1">（无）</option>';
    for (var i = 0; i < hdr.length; i++) h += '<option value="' + i + '">第' + (i + 1) + '列：' + esc((hdr[i] || '').slice(0, 12)) + '</option>';
    return h;
  }
  function fillMap() {
    var r = +$('mapHeader').value, hdr = imp.rows[r] || [];
    ['mapDate', 'mapAmount', 'mapDesc'].forEach(function (id) { $(id).innerHTML = colOptions(hdr); });
  }
  function showMap() {
    var h = '', lim = Math.min(imp.rows.length, 30);
    for (var r = 0; r < lim; r++) h += '<option value="' + r + '">第' + (r + 1) + '行：' + esc(imp.rows[r].join(' | ').slice(0, 30)) + '</option>';
    $('mapHeader').innerHTML = h; fillMap(); show($('mapCard'), true);
  }
  $('mapHeader').addEventListener('change', fillMap);
  $('mapApply').addEventListener('click', function () {
    var c = { date: +$('mapDate').value, amount: +$('mapAmount').value, desc: +$('mapDesc').value >= 0 ? [+$('mapDesc').value] : [], io: -1, inc: -1, exp: -1, status: -1, cat: -1 };
    if (c.date < 0 || c.amount < 0) { alert('请选择日期列和金额列'); return; }
    var items = mapRows(imp.rows, +$('mapHeader').value, c);
    if (!items.length) { alert('按所选列没有解析到记录，请检查'); return; }
    showPreview('手动指定列', items);
  });

  function handleRows(rows, enc) {
    imp.rows = rows.filter(function (r) { return r.join('') !== ''; });
    show($('previewCard'), false); show($('mapCard'), false);
    var f = detect(imp.rows);
    if (f) {
      var items = mapRows(imp.rows, f.header, f.cols);
      $('impMsg').textContent = '识别为：' + f.name + (enc ? '（编码 ' + enc + '）' : '');
      if (items.length) { showPreview(f.name, items); return; }
      $('impMsg').textContent += '，但没有可导入的收支记录，可手动指定列。';
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
          handleRows(rows.map(function (r) { return r.map(clean); }), '');
        } else {
          var d = decode(rd.result);
          handleRows(parseCSV(d.text), d.enc);
        }
      } catch (e) { $('impMsg').textContent = '读取失败：' + (e.message || e); }
    };
    rd.onerror = function () { $('impMsg').textContent = '文件读取失败'; };
    rd.readAsArrayBuffer(f);
  });

  // ---------- 备份 ----------
  $('exportBtn').addEventListener('click', function () {
    var data = JSON.parse(JSON.stringify(db));
    if ($('incPhotos').checked) {
      data.photos = {};
      db.entries.forEach(function (e) { if (e.photo) { var p = getPhoto(e.id); if (p) data.photos[e.id] = p; } });
    }
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
    alert('已导出（约 ' + kb(json.length * 2) + '）。若未自动下载（如在微信中），请复制文本框内容保存。');
  });
  function doImport(text) {
    try {
      var d = normalize(JSON.parse(text));
      if (!confirm('导入将覆盖当前数据（' + d.entries.length + ' 条记账、' + d.loans.length + ' 条借贷），确定？')) return;
      var photos = d.photos || {}; delete d.photos;
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
  setType('expense'); render(); renderLoans();
  window.__jizhang = { db: function () { return db; } };
})();

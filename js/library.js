// zunaari music - library.js
// Music Library の検索・絞り込み。
// - 一覧はHTMLにすべて書かれているので、JSが動かない環境でも全件と詳細へのリンクを使える。
// - 条件はURL（?q=…&year=…）に保持し、共有・再読み込み・戻る操作で同じ結果を出す。
// - 条件どうしは AND、各項目は単一選択。

(function () {
  var form = document.querySelector('.library-filter');
  var items = Array.prototype.slice.call(document.querySelectorAll('.library-item'));
  var empty = document.querySelector('.library-empty');
  if (!form || !items.length) {
    return;
  }
  var count = form.querySelector('[data-count]');
  var search = form.querySelector('[name="q"]');
  var selects = Array.prototype.slice.call(form.querySelectorAll('select'));
  var KEYS = ['q'].concat(selects.map(function (s) { return s.name; }));

  function normalize(text) {
    return (text || '').toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
  }

  function readUrl() {
    var params = new URLSearchParams(window.location.search);
    search.value = params.get('q') || '';
    selects.forEach(function (select) {
      var value = params.get(select.name) || '';
      // URLに一覧にない値が入っていたら「すべて」に戻す
      var exists = Array.prototype.some.call(select.options, function (o) { return o.value === value; });
      select.value = exists ? value : '';
    });
  }

  function writeUrl() {
    var params = new URLSearchParams(window.location.search);
    KEYS.forEach(function (key) { params.delete(key); });
    if (search.value.trim()) {
      params.set('q', search.value.trim());
    }
    selects.forEach(function (select) {
      if (select.value) {
        params.set(select.name, select.value);
      }
    });
    var query = params.toString();
    var url = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
    if (url !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, '', url);
    }
  }

  function apply() {
    var words = normalize(search.value).split(' ').filter(Boolean);
    var shown = 0;
    items.forEach(function (item) {
      var text = normalize(item.getAttribute('data-search'));
      var ok = words.every(function (w) { return text.indexOf(w) !== -1; });
      selects.forEach(function (select) {
        if (ok && select.value) {
          var values = (item.getAttribute('data-' + select.name) || '').split(' ');
          ok = values.indexOf(select.value) !== -1;
        }
      });
      item.hidden = !ok;
      if (ok) {
        shown++;
      }
    });
    count.textContent = String(shown);
    empty.hidden = shown !== 0;
  }

  form.addEventListener('input', function () {
    apply();
    writeUrl();
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
  });
  form.addEventListener('reset', function () {
    // reset の既定動作（値を戻す）が終わってから反映する
    window.setTimeout(function () {
      apply();
      writeUrl();
      search.focus();
    }, 0);
  });
  window.addEventListener('popstate', function () {
    readUrl();
    apply();
  });
  // 「戻る」でページがキャッシュから復元されたときも、URLの条件に合わせ直す
  window.addEventListener('pageshow', function () {
    readUrl();
    apply();
  });

  readUrl();
  apply();
})();

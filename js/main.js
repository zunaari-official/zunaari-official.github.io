// zunaari music - main.js
// 1. スマートフォン用メニューの開閉
// 2. スクロール時のフェードイン演出（控えめ・初回表示時のみ・reduced motion対応）

(function () {
  var header = document.getElementById('header');
  var toggle = header && header.querySelector('.menu-toggle');
  var nav = document.getElementById('site-nav');

  // 必要な要素がなければ何もしない（CSS側も .js-nav-ready が付かない限り
  // メニューは常に表示されるため、メニューが使えなくなることはない）
  if (!toggle || !nav) {
    return;
  }

  document.documentElement.classList.add('js-nav-ready');

  function setOpen(open) {
    header.classList.toggle('is-nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  }

  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // メニュー内のリンクを押したら閉じる
  nav.addEventListener('click', function (event) {
    if (event.target.closest('a')) {
      setOpen(false);
    }
  });

  // Escキーで閉じて、ボタンにフォーカスを戻す
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && header.classList.contains('is-nav-open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  // PC幅に戻ったら開いた状態をリセットする
  var desktopQuery = window.matchMedia('(min-width: 769px)');
  var onDesktopChange = function (query) {
    if (query.matches) {
      setOpen(false);
    }
  };
  if (desktopQuery.addEventListener) {
    desktopQuery.addEventListener('change', onDesktopChange);
  } else if (desktopQuery.addListener) {
    desktopQuery.addListener(onDesktopChange);
  }
})();

(function () {
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // reduced motion、またはIntersectionObserver非対応の場合は何もしない
  // （CSS側も .js-reveal-ready が付かない限り要素は常に表示されるため、
  //   コンテンツが非表示のままになることはない）
  if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
    return;
  }

  var targets = document.querySelectorAll('.reveal');
  if (!targets.length) {
    return;
  }

  document.documentElement.classList.add('js-reveal-ready');

  var observer = new IntersectionObserver(function (entries, obs) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -10% 0px'
  });

  targets.forEach(function (target) {
    observer.observe(target);
  });
})();

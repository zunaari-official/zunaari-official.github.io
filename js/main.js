// zunaari music - main.js
// スクロール時のフェードイン演出（控えめ・初回表示時のみ・reduced motion対応）

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

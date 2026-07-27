(function() {
  const saved = localStorage.getItem('vd-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();
document.getElementById('theme-toggle').addEventListener('click', function() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('vd-theme', next);
});

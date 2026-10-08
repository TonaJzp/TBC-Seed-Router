// Apply the saved (or system) theme before the first paint: no white flash.
// Loaded synchronously from <head>; a separate file so the Content Security
// Policy can forbid inline scripts.
(function () {
  var t = null;
  try { t = localStorage.getItem('bc-seed-router-theme'); } catch (e) {}
  if (t !== 'dark' && t !== 'light') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
})();

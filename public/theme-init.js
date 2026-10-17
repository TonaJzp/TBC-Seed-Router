// Apply the saved (or system) theme before the first paint: no white flash.
// Loaded synchronously from <head>; a separate file so the Content Security
// Policy can forbid inline scripts.
(function () {
  var t = null;
  try { t = localStorage.getItem('bc-seed-router-theme'); } catch { /* site data blocked: the system theme */ }
  if (t !== 'dark' && t !== 'light') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  // The phone's browser bar takes the colour of the page header.
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.content = t === 'dark' ? '#211f1d' : '#f5f4f1';
})();

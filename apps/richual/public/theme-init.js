// Applies the saved theme before first paint so the page never flashes the wrong colours.
// A separate file rather than an inline script, because the CSP forbids inline scripts.
try {
  const theme = localStorage.getItem("richual:theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // Storage can be unavailable; the system preference applies.
}

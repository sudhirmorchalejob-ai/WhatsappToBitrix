/**
 * Bitrix24 install completion helper.
 *
 * Local apps with a user interface stay in "not installed" state until
 * the installer page calls BX24.installFinish(). Until then Bitrix24
 * blocks bound-event delivery, placements and the app UI. The page below
 * is served by the install endpoints so that the installation completes
 * as soon as the portal opens the installer URL.
 *
 * BX24.init(cb) fires cb once the app frame handshake with the portal
 * succeeds; when the page is opened outside the portal (e.g. plain
 * browser), the callback simply never runs and the page stays idle.
 */
const BX24_SCRIPT_SRC = 'https://api.bitrix24.com/api/v1/';

function b24InstallFinishScript() {
  return `<script src="${BX24_SCRIPT_SRC}"></script>
<script>
  (function () {
    function finish() {
      try {
        if (window.BX24 && typeof window.BX24.installFinish === 'function') {
          window.BX24.installFinish();
        }
      } catch (e) {}
    }
    if (window.BX24 && typeof window.BX24.init === 'function') {
      window.BX24.init(finish);
    } else {
      window.addEventListener('load', function () {
        if (window.BX24 && typeof window.BX24.init === 'function') {
          window.BX24.init(finish);
        }
      });
    }
  })();
</script>`;
}

/** Complete HTML installer page with installFinish() wired in. */
function b24InstallPage({ title, body, ok = true }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8f9fa;">
  <div style="max-width:520px;margin:auto;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
    <h2 style="color:${ok ? '#27ae60' : '#e74c3c'}">${ok ? '✓ ' + title : '❌ Installation Issue'}</h2>
    <p style="color:#555;font-size:14px">${body}</p>
  </div>
  ${b24InstallFinishScript()}
</body>
</html>`;
}

module.exports = { b24InstallFinishScript, b24InstallPage, BX24_SCRIPT_SRC };

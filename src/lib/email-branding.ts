export const NOX_EMAIL_LOGO_URL = "https://noxfianca.com/favicon-512.png";

export function escapeEmailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderNoxEmail(content: string, preheader = "") {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NOX Fiança</title>
  </head>
  <body style="margin:0;background:#f5f5f5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#171717">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeEmailHtml(preheader)}</div>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border:1px solid #e8e8e8;border-radius:18px;overflow:hidden">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid #eeeeee">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="vertical-align:middle">
                      <img src="${NOX_EMAIL_LOGO_URL}" width="52" height="52" alt="Logo da NOX Fiança" style="display:block;width:52px;height:52px;border:0;border-radius:13px" />
                    </td>
                    <td style="padding-left:14px;vertical-align:middle">
                      <div style="font-size:19px;font-weight:800;letter-spacing:.4px;color:#171717">NOX FIANÇA</div>
                      <div style="font-size:12px;color:#666666;margin-top:3px">A proteção que não dorme.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px;font-size:15px;line-height:1.6">
                ${content}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#171717;color:#ffffff;font-size:12px;line-height:1.5">
                Equipe NOX Fiança<br />
                <a href="https://noxfianca.com" style="color:#ffd60a;text-decoration:none">noxfianca.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

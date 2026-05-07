// Integration Logic

function generateEmbedCode() {
    const title = document.getElementById('int-title').value;
    const appId = document.getElementById('int-app-id').value;
    const themeId = document.getElementById('int-theme-id').value;
    const themeColor = document.getElementById('int-theme-color').value;

    let attrs = `title="${title}" app-id="${appId}"`;
    if (themeId) attrs += ` theme-id="${themeId}"`;
    else if (themeColor !== '#000000') attrs += ` theme-color="${themeColor}"`;

    const code = `&lt;!-- Project IQ Widget --&gt;
&lt;glpi-chat-widget ${attrs}&gt;&lt;/glpi-chat-widget&gt;
&lt;script src="http://localhost/glpi-chat-widget.js"&gt;&lt;\/script&gt;`;

    document.getElementById('embed-code').textContent = code;
}

function copyEmbedCode() {
    const code = document.getElementById('embed-code').textContent;
    navigator.clipboard.writeText(code);
    showToast('Code copied to clipboard!');
}

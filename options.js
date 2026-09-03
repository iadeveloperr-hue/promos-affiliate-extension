const keys = ['imgbbKey', 'sheetsScriptUrl', 'queueScriptUrl', 'canvaDesignUrl', 'metaStoryUrl',
              'profileGroup', 'otherProfileDir', 'chromePath', 'anthropicApiKey'];

chrome.storage.local.get(keys, (data) => {
  document.getElementById('imgbbKey').value        = data.imgbbKey        || '';
  document.getElementById('sheetsScriptUrl').value = data.sheetsScriptUrl || '';
  document.getElementById('queueScriptUrl').value  = data.queueScriptUrl  || '';
  document.getElementById('canvaDesignUrl').value  = data.canvaDesignUrl  || '';
  document.getElementById('metaStoryUrl').value    = data.metaStoryUrl    || '';
  document.getElementById('profileGroup').value    = data.profileGroup    || '';
  document.getElementById('otherProfileDir').value = data.otherProfileDir || '';
  document.getElementById('chromePath').value      = data.chromePath      || '';
  document.getElementById('anthropicApiKey').value = data.anthropicApiKey || '';
});

document.getElementById('save').addEventListener('click', () => {
  const imgbbKey        = document.getElementById('imgbbKey').value.trim();
  const sheetsScriptUrl = document.getElementById('sheetsScriptUrl').value.trim();
  const queueScriptUrl  = document.getElementById('queueScriptUrl').value.trim();
  const canvaDesignUrl  = document.getElementById('canvaDesignUrl').value.trim();
  const metaStoryUrl    = document.getElementById('metaStoryUrl').value.trim();
  const profileGroup    = document.getElementById('profileGroup').value;
  const otherProfileDir = document.getElementById('otherProfileDir').value.trim();
  const chromePath      = document.getElementById('chromePath').value.trim();
  const anthropicApiKey = document.getElementById('anthropicApiKey').value.trim();
  chrome.storage.local.set({ imgbbKey, sheetsScriptUrl, queueScriptUrl, canvaDesignUrl, metaStoryUrl, profileGroup, otherProfileDir, chromePath, anthropicApiKey }, () => {
    const st = document.getElementById('status');
    st.textContent = '✅ Salvo!';
    setTimeout(() => { st.textContent = ''; }, 2000);
  });
});

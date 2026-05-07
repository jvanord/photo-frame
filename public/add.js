const error = document.querySelector('#error');
const form = document.querySelector('.add-form');
const urlInput = document.querySelector('#url');
const clipboardAdd = document.querySelector('#clipboard-add');
const messages = new Map([
  ['invalid-url', 'Enter an http or https URL.'],
  ['clipboard-denied', 'Clipboard access was denied. Paste the URL into the field.'],
  ['clipboard-empty', 'Clipboard does not contain a URL.'],
  ['clipboard-unavailable', 'Clipboard access is unavailable. Paste the URL into the field.'],
  ['unsupported-image', 'That URL did not return a supported image.'],
  ['import-failed', 'Import failed.'],
]);

const code = new URLSearchParams(window.location.search).get('error');
if (code) {
  error.textContent = messages.get(code) ?? messages.get('import-failed');
  error.hidden = false;
  window.history.replaceState(null, '', '/add');
}

initClipboardAdd();
initPasteSubmit();

function initClipboardAdd() {
  if (!clipboardAdd || !form || !urlInput) {
    return;
  }

  clipboardAdd.hidden = false;
  clipboardAdd.addEventListener('click', async () => {
    if (!navigator.clipboard?.readText) {
      showError('clipboard-unavailable');
      urlInput.focus();
      return;
    }

    let clipboardText;
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (error) {
      showError(error?.name === 'NotAllowedError' ? 'clipboard-denied' : 'clipboard-unavailable');
      urlInput.focus();
      return;
    }

    if (!clipboardText.trim()) {
      showError('clipboard-empty');
      urlInput.focus();
      return;
    }

    const clipboardUrl = normalizeImportUrl(clipboardText);
    if (!clipboardUrl) {
      showError('invalid-url');
      urlInput.focus();
      return;
    }

    submitImportUrl(clipboardUrl);
  });
}

function initPasteSubmit() {
  if (!urlInput || !form) {
    return;
  }

  urlInput.addEventListener('paste', (event) => {
    const pastedUrl = normalizeImportUrl(event.clipboardData?.getData('text') ?? '');
    if (!pastedUrl) {
      return;
    }

    event.preventDefault();
    submitImportUrl(pastedUrl);
  });
}

function submitImportUrl(url) {
  urlInput.value = url;
  form.requestSubmit();
}

function showError(code) {
  error.textContent = messages.get(code) ?? messages.get('import-failed');
  error.hidden = false;
}

function normalizeImportUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

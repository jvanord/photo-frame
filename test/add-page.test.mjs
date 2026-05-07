import assert from 'node:assert/strict';
import test from 'node:test';

const ADD_SCRIPT_URL = new URL('../public/add.js', import.meta.url);

function createElement({ hidden = false, value = '' } = {}) {
  const listeners = new Map();

  return {
    focused: false,
    hidden,
    textContent: '',
    value,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    async click() {
      for (const listener of listeners.get('click') ?? []) {
        await listener({ preventDefault() {} });
      }
    },
    focus() {
      this.focused = true;
    },
    async paste(text) {
      let defaultPrevented = false;
      const event = {
        clipboardData: {
          getData: (type) => type === 'text' ? text : '',
        },
        preventDefault() {
          defaultPrevented = true;
        },
      };

      for (const listener of listeners.get('paste') ?? []) {
        await listener(event);
      }

      if (!defaultPrevented) {
        this.value = text;
      }
    },
  };
}

async function loadAddPageScript(t, { clipboardError, clipboardText, hasClipboard = true } = {}) {
  const error = createElement({ hidden: true });
  const input = createElement();
  const clipboardButton = createElement({ hidden: true });
  let readCount = 0;
  let submitCount = 0;
  const form = {
    requestSubmit() {
      submitCount += 1;
    },
  };

  const elements = new Map([
    ['#error', error],
    ['#url', input],
    ['#clipboard-add', clipboardButton],
    ['.add-form', form],
  ]);

  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  globalThis.document = {
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
  };
  globalThis.window = {
    history: { replaceState() {} },
    location: new URL('http://localhost/add'),
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: hasClipboard
      ? {
          clipboard: {
            readText: async () => {
              readCount += 1;
              if (clipboardError) {
                throw clipboardError;
              }
              return clipboardText;
            },
          },
        }
      : {},
  });

  t.after(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  await import(`${ADD_SCRIPT_URL.href}?cache=${crypto.randomUUID()}`);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    clipboardButton,
    clickClipboardButton: async () => clipboardButton.click(),
    error,
    input,
    readCount: () => readCount,
    submitCount: () => submitCount,
  };
}

test('shows Add from Clipboard without reading the clipboard until clicked', async (t) => {
  const url = 'https://example.test/photo.jpg';
  const page = await loadAddPageScript(t, { clipboardText: url });

  assert.equal(page.clipboardButton.hidden, false);
  assert.equal(page.readCount(), 0);

  await page.clickClipboardButton();

  assert.equal(page.readCount(), 1);
  assert.equal(page.input.value, url);
  assert.equal(page.submitCount(), 1);
});

test('shows an error when clipboard reads are unavailable', async (t) => {
  const page = await loadAddPageScript(t, { hasClipboard: false });

  assert.equal(page.clipboardButton.hidden, false);

  await page.clickClipboardButton();

  assert.equal(page.error.textContent, 'Clipboard access is unavailable. Paste the URL into the field.');
  assert.equal(page.error.hidden, false);
  assert.equal(page.input.focused, true);
  assert.equal(page.submitCount(), 0);
});

test('shows an error when clipboard access is denied', async (t) => {
  const page = await loadAddPageScript(t, {
    clipboardError: new DOMException('Not allowed', 'NotAllowedError'),
  });

  await page.clickClipboardButton();

  assert.equal(page.error.textContent, 'Clipboard access was denied. Paste the URL into the field.');
  assert.equal(page.error.hidden, false);
  assert.equal(page.input.focused, true);
  assert.equal(page.submitCount(), 0);
});

test('shows an error when the clipboard is empty', async (t) => {
  const page = await loadAddPageScript(t, { clipboardText: '' });

  await page.clickClipboardButton();

  assert.equal(page.error.textContent, 'Clipboard does not contain a URL.');
  assert.equal(page.error.hidden, false);
  assert.equal(page.input.focused, true);
  assert.equal(page.submitCount(), 0);
});

test('shows an error when Add from Clipboard reads a non-http URL', async (t) => {
  const page = await loadAddPageScript(t, { clipboardText: 'file:///tmp/photo.jpg' });

  await page.clickClipboardButton();

  assert.equal(page.error.textContent, 'Enter an http or https URL.');
  assert.equal(page.error.hidden, false);
  assert.equal(page.submitCount(), 0);
});

test('submits the import form when a valid URL is pasted into the URL field', async (t) => {
  const page = await loadAddPageScript(t, { hasClipboard: false });
  const url = 'https://example.test/pasted.jpg';

  await page.input.paste(url);

  assert.equal(page.input.value, url);
  assert.equal(page.submitCount(), 1);
});

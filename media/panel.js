// Tenant Switcher side panel: banners, preset cards with inline prompts, and the add/edit form.
// Studio titles every message box "Extension", so confirmations and results live here instead.
// User data is only ever assigned through textContent/value, never innerHTML.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  const ICONS = {
    edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.1 2.3a1.5 1.5 0 0 1 2.1 0l.5.5a1.5 1.5 0 0 1 0 2.1L6.2 12.4 3 13l.6-3.2 7.5-7.5Z"/></svg>',
    trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/></svg>',
  };

  /** Extension state: presets, running switch, last result and settings. */
  let state = { presets: [], busy: false, confirmBeforeSwitch: true };
  /** Add/edit form, or null. */
  let form = null;
  /** Inline prompt on one card: {id, kind: 'confirm'|'delete'|'working'|'unverified', message?}. */
  let prompt = null;
  /** Transient message from the extension: {severity, message, openSettings?}. */
  let notice = null;

  const bannerArea = el('div', 'banner-area');
  const formArea = el('div', 'form-area');
  const listArea = el('div', 'list-area');
  app.append(bannerArea, formArea, listArea);

  // ---- theme: follow Studio's body class so the brand tokens switch with it
  function syncTheme() {
    const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ---- messages from the extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'state':
        state = msg;
        if (prompt && !state.presets.some((p) => p.id === prompt.id)) prompt = null;
        renderBanners();
        renderList();
        if (!form) renderForm();
        break;
      case 'form':
        form = { mode: msg.mode, values: msg.values, hasSecret: msg.hasSecret, errors: {}, busy: false };
        prompt = null;
        renderForm(true);
        renderList();
        break;
      case 'closeForm':
        form = null;
        renderForm();
        renderList();
        break;
      case 'formErrors':
        if (form) {
          form.errors = msg.errors;
          form.busy = false;
          form.test = undefined;
          renderForm();
        }
        break;
      case 'formBusy':
        if (form) {
          form.busy = msg.busy;
          renderForm();
        }
        break;
      case 'testResult':
        if (form) {
          form.busy = false;
          form.test = { ok: msg.ok, message: msg.message };
          renderForm();
        }
        break;
      case 'prompt':
        prompt = { id: msg.id, kind: msg.kind, message: msg.message };
        renderList();
        break;
      case 'clearPrompt':
        prompt = null;
        renderList();
        break;
      case 'notice':
        notice = { severity: msg.severity, message: msg.message, openSettings: msg.openSettings };
        renderBanners();
        break;
    }
  });

  // ---- banners: running switch, last result, transient notice
  function renderBanners() {
    bannerArea.replaceChildren();
    if (state.busy && state.progress) {
      const b = banner('progress', `Switching to ${state.progress.targetName}`);
      b.append(text('div', 'banner-detail', state.progress.step ? `${state.progress.step}…` : 'Starting…'));
      bannerArea.append(b);
    } else if (state.result) {
      const b = banner(state.result.severity, state.result.message);
      b.append(
        actionRow([
          button('Show log', 'btn btn-secondary', () => vscode.postMessage({ type: 'showLog' })),
          button('OK', 'btn btn-primary', () => vscode.postMessage({ type: 'dismissResult' })),
        ]),
      );
      bannerArea.append(b);
    }
    if (notice) {
      const b = banner(notice.severity, notice.message);
      const buttons = [];
      if (notice.openSettings) {
        buttons.push(button('Open settings', 'btn btn-secondary', () => vscode.postMessage({ type: 'openSettings' })));
      }
      buttons.push(button('OK', 'btn btn-primary', () => {
        notice = null;
        renderBanners();
      }));
      b.append(actionRow(buttons));
      bannerArea.append(b);
    }
  }

  function banner(severity, message) {
    const b = el('div', `banner banner-${severity}`);
    b.setAttribute('role', severity === 'error' ? 'alert' : 'status');
    b.append(text('div', 'banner-message', message));
    return b;
  }

  // ---- list
  function renderList() {
    listArea.replaceChildren();
    if (state.error) {
      listArea.append(text('p', 'notice notice-error', state.error));
    }
    if (!state.presets.length && !form && !state.error) {
      listArea.append(
        text('p', 'empty', 'No presets yet. A preset stores an Orchestrator tenant URL and the client ID and secret of an Orchestrator machine.'),
      );
    }
    for (const p of state.presets) {
      listArea.append(card(p));
    }
  }

  function card(p) {
    const root = el('div', p.active ? 'card card-active' : 'card');
    root.title = `${p.url}\nClient ID: ${p.clientId}${p.syncUipCli ? '\nAlso signs in the uip CLI' : ''}`;

    const head = el('div', 'card-head');
    head.append(el('span', p.active ? 'dot dot-active' : 'dot'), text('span', 'card-name', p.name || '(unnamed)'));
    if (p.active) head.append(text('span', 'badge', 'Connected'));
    root.append(head, text('div', 'card-url', p.shortUrl));

    if (prompt && prompt.id === p.id) {
      root.append(cardPrompt(p));
      return root;
    }

    const actions = el('div', 'card-actions');
    if (!p.active) {
      const connect = button('Connect', 'btn btn-secondary', () => onConnect(p));
      connect.disabled = state.busy;
      actions.append(connect);
    }
    actions.append(
      el('span', 'spacer'),
      iconButton('edit', `Edit ${p.name}`, () => vscode.postMessage({ type: 'edit', id: p.id })),
      iconButton('trash', `Delete ${p.name}`, () => setPrompt({ id: p.id, kind: 'delete' })),
    );
    root.append(actions);
    return root;
  }

  function onConnect(p) {
    notice = null;
    renderBanners();
    if (state.confirmBeforeSwitch) {
      setPrompt({ id: p.id, kind: 'confirm' });
    } else {
      vscode.postMessage({ type: 'connect', id: p.id });
    }
  }

  function cardPrompt(p) {
    const box = el('div', 'prompt');
    const cancel = () => button('Cancel', 'btn btn-secondary', () => setPrompt(null));
    switch (prompt.kind) {
      case 'confirm':
        box.append(
          text('div', 'prompt-question', `Do you want to switch tenant to ${p.name}?`),
          text('div', 'prompt-detail', 'The Robot disconnects from the current tenant and connects to this one.'),
          actionRow([
            button('Switch', 'btn btn-primary', () => vscode.postMessage({ type: 'connect', id: p.id })),
            cancel(),
          ]),
        );
        break;
      case 'delete':
        box.append(
          text('div', 'prompt-question', `Do you want to delete ${p.name}?`),
          text('div', 'prompt-detail', 'The stored client secret is removed too. The Orchestrator Connector desktop app shares this preset.'),
          actionRow([
            button('Delete', 'btn btn-primary', () => {
              setPrompt(null);
              vscode.postMessage({ type: 'delete', id: p.id });
            }),
            cancel(),
          ]),
        );
        break;
      case 'working':
        box.append(text('div', 'prompt-detail', prompt.message || 'Working…'));
        break;
      case 'unverified':
        box.append(
          text('div', 'prompt-question', `Do you want to switch to ${p.name} anyway?`),
          text('div', 'prompt-detail', prompt.message),
          actionRow([
            button('Switch anyway', 'btn btn-primary', () => {
              setPrompt(null);
              vscode.postMessage({ type: 'connectAnyway', id: p.id });
            }),
            cancel(),
          ]),
        );
        break;
    }
    return box;
  }

  function setPrompt(value) {
    prompt = value;
    renderList();
  }

  // ---- form
  function renderForm(focusFirst) {
    formArea.replaceChildren();
    if (!form) {
      const add = button('Add preset', 'btn btn-primary btn-block', () => vscode.postMessage({ type: 'add' }));
      add.disabled = state.busy;
      formArea.append(add);
      return;
    }
    const f = el('form', 'card form');
    f.noValidate = true;
    f.append(text('h2', 'form-title', form.mode === 'add' ? 'Add preset' : 'Edit preset'));

    f.append(
      field('presetName', 'Name', 'text', 'Acme production', ''),
      field('orchestratorUrl', 'Orchestrator URL', 'url', 'https://cloud.uipath.com/acme/Production/orchestrator_',
        'Tenant URL including organization and tenant.'),
      field('clientId', 'Client ID', 'text', '', 'From the machine in Orchestrator (Tenant > Machines).'),
      field('clientSecret', 'Client secret', 'password', form.hasSecret ? 'Stored. Leave blank to keep it.' : '', ''),
    );

    const check = el('label', 'check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!form.values.syncUipCli;
    box.addEventListener('change', () => (form.values.syncUipCli = box.checked));
    check.append(box, text('span', '', 'Also sign in the uip CLI to this tenant'));
    f.append(check);

    if (form.test) {
      f.append(text('p', form.test.ok ? 'result result-ok' : 'result result-error', form.test.message));
    }

    const save = button('Save', 'btn btn-primary', null);
    save.type = 'submit';
    const test = button('Test', 'btn btn-secondary', () => {
      form.busy = true;
      form.test = undefined;
      renderForm();
      vscode.postMessage({ type: 'test', values: form.values });
    });
    const cancel = button('Cancel', 'btn btn-secondary', () => vscode.postMessage({ type: 'cancel' }));
    for (const b of [save, test, cancel]) b.disabled = form.busy;
    f.append(actionRow([save, test, cancel], 'form-buttons'));

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.busy) return;
      form.busy = true;
      renderForm();
      vscode.postMessage({ type: 'save', values: form.values });
    });

    formArea.append(f);
    if (focusFirst) {
      const first = f.querySelector('input');
      if (first) first.focus();
    }
  }

  function field(key, label, type, placeholder, hint) {
    const wrap = el('div', 'field');
    const id = `f-${key}`;
    const lab = text('label', 'field-label', label);
    lab.htmlFor = id;
    const input = document.createElement('input');
    input.id = id;
    input.type = type;
    input.value = form.values[key] || '';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.disabled = form.busy;
    input.addEventListener('input', () => {
      form.values[key] = input.value;
      if (form.errors[key]) {
        delete form.errors[key];
        input.classList.remove('invalid');
        const msg = wrap.querySelector('.field-error');
        if (msg) msg.remove();
      }
    });
    wrap.append(lab, input);
    if (form.errors[key]) {
      input.classList.add('invalid');
      input.setAttribute('aria-invalid', 'true');
      wrap.append(text('div', 'field-error', form.errors[key]));
    } else if (hint) {
      wrap.append(text('div', 'field-hint', hint));
    }
    return wrap;
  }

  // ---- helpers
  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }
  function text(tag, className, value) {
    const node = el(tag, className);
    node.textContent = value;
    return node;
  }
  function button(label, className, onClick) {
    const b = text('button', className, label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function actionRow(buttons, className) {
    const row = el('div', className || 'action-row');
    row.append(...buttons);
    return row;
  }
  function iconButton(icon, label, onClick) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = ICONS[icon]; // constant markup only
    b.addEventListener('click', onClick);
    return b;
  }

  renderBanners();
  renderForm();
  renderList();
  vscode.postMessage({ type: 'ready' });
})();

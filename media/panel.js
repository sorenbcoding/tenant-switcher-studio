// Tenant Switcher side panel. Renders the preset list and the add/edit form.
// User data is only ever assigned through textContent/value, never innerHTML.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  const ICONS = {
    edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.1 2.3a1.5 1.5 0 0 1 2.1 0l.5.5a1.5 1.5 0 0 1 0 2.1L6.2 12.4 3 13l.6-3.2 7.5-7.5Z"/></svg>',
    trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/></svg>',
  };

  /** @type {{presets: any[], busy: boolean, error?: string}} */
  let state = { presets: [], busy: false };
  /** @type {null | {mode: 'add'|'edit', values: any, hasSecret: boolean, errors: Record<string,string>, busy: boolean, test?: {ok: boolean, message: string}}} */
  let form = null;

  const formArea = el('div', 'form-area');
  const listArea = el('div', 'list-area');
  app.append(formArea, listArea);

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
        renderList();
        if (!form) renderForm();
        break;
      case 'form':
        form = { mode: msg.mode, values: msg.values, hasSecret: msg.hasSecret, errors: {}, busy: false };
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
    }
  });

  // ---- list
  function renderList() {
    listArea.replaceChildren();
    if (state.error) {
      listArea.append(text('p', 'notice notice-error', state.error));
    }
    if (state.busy) {
      listArea.append(text('p', 'notice', 'Switching tenant. Progress is shown in the notification.'));
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
    const dot = el('span', p.active ? 'dot dot-active' : 'dot');
    const name = text('span', 'card-name', p.name || '(unnamed)');
    head.append(dot, name);
    if (p.active) head.append(text('span', 'badge', 'Connected'));

    const url = text('div', 'card-url', p.shortUrl);

    const actions = el('div', 'card-actions');
    if (!p.active) {
      const connect = button('Connect', 'btn btn-secondary', () => vscode.postMessage({ type: 'connect', id: p.id }));
      connect.disabled = state.busy;
      actions.append(connect);
    }
    const spacer = el('span', 'spacer');
    const edit = iconButton('edit', `Edit ${p.name}`, () => vscode.postMessage({ type: 'edit', id: p.id }));
    const del = iconButton('trash', `Delete ${p.name}`, () => vscode.postMessage({ type: 'delete', id: p.id }));
    actions.append(spacer, edit, del);

    root.append(head, url, actions);
    return root;
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
      field('clientSecret', 'Client secret', 'password',
        form.hasSecret ? 'Stored. Leave blank to keep it.' : '', ''),
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

    const buttons = el('div', 'form-buttons');
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
    buttons.append(save, test, cancel);
    f.append(buttons);

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
  function iconButton(icon, label, onClick) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = ICONS[icon]; // constant markup only
    b.addEventListener('click', onClick);
    return b;
  }

  renderForm();
  renderList();
  vscode.postMessage({ type: 'ready' });
})();

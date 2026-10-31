const LH_AUTO_ADDED_PROPERTY = '_auto_added';
const LH_DECLINED_ATTRIBUTE = '_lh_auto_add_declined';
const LH_DRAWER_SECTION = 'lh-cart-drawer';

const lhCartRoute = (path) => `${window.Shopify?.routes?.root || '/'}${path}`;

async function lhCartRequest(path, body) {
  const response = await fetch(lhCartRoute(path), {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.description || data.message || 'Something went wrong.');
  return data;
}

const lhIsAutoLine = (item) => Boolean(item.properties?.[LH_AUTO_ADDED_PROPERTY]);

class LhCartDrawer extends HTMLElement {
  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    this.queue = Promise.resolve();
    this.addEventListener('click', this.onClick.bind(this));
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-lh-cart-open]')) return;
      event.preventDefault();
      this.open();
    });
  }

  get triggerValues() {
    return (this.dataset.triggerValues || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }

  open() {
    if (!this.dialog.open) this.dialog.showModal();
  }

  close() {
    this.dialog.close();
  }

  onClick(event) {
    if (event.target.closest('[data-lh-cart-close]')) {
      this.close();
      return;
    }
    const control = event.target.closest('[data-line-key]');
    if (!control || control.disabled) return;
    const { lineKey, quantity, autoLine } = control.dataset;
    this.enqueue(async () => {
      await lhCartRequest('cart/change.js', { id: lineKey, quantity: Number(quantity) });
      if (autoLine && Number(quantity) === 0) {
        await lhCartRequest('cart/update.js', { attributes: { [LH_DECLINED_ATTRIBUTE]: 'true' } });
      }
    });
  }

  async add(items) {
    await this.enqueue(() => lhCartRequest('cart/add.js', { items }), true);
    this.open();
  }

  enqueue(task, rethrow = false) {
    const run = this.queue.then(async () => {
      this.setBusy(true);
      let failure;
      try {
        await task();
      } catch (error) {
        failure = error;
      }
      try {
        await this.refresh();
      } finally {
        this.setBusy(false);
      }
      if (failure) {
        this.showError(failure.message);
        if (rethrow) throw failure;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async refresh() {
    const cart = await lhCartRequest('cart.js');
    await this.applyAutoAddRule(cart);
    const response = await fetch(`${lhCartRoute('')}?sections=${LH_DRAWER_SECTION}`);
    const sections = await response.json();
    const html = new DOMParser().parseFromString(sections[LH_DRAWER_SECTION], 'text/html');
    const fresh = html.querySelector('[data-lh-drawer-panel]');
    const current = this.querySelector('[data-lh-drawer-panel]');
    if (fresh && current) current.replaceWith(fresh);
    const count = fresh?.dataset.itemCount ?? '0';
    document.querySelectorAll('[data-lh-cart-count]').forEach((badge) => {
      badge.textContent = count;
      badge.hidden = count === '0';
    });
    document.querySelectorAll('[data-lh-cart-open]').forEach((button) => {
      button.setAttribute('aria-label', button.dataset.labelTemplate.replace('[count]', count));
    });
  }

  async applyAutoAddRule(cart) {
    const variantId = Number(this.dataset.autoVariantId);
    const triggers = this.triggerValues;
    if (!variantId || triggers.length === 0) return;

    const autoLine = cart.items.find(lhIsAutoLine);
    const hasTrigger = cart.items.some(
      (item) =>
        !lhIsAutoLine(item) &&
        triggers.every((value) => item.options_with_values.some((option) => option.value.toLowerCase() === value))
    );
    const declined = Boolean(cart.attributes?.[LH_DECLINED_ATTRIBUTE]);

    if (hasTrigger && !autoLine && !declined) {
      await lhCartRequest('cart/add.js', {
        items: [{ id: variantId, quantity: 1, properties: { [LH_AUTO_ADDED_PROPERTY]: 'true' } }],
      });
    } else if (!hasTrigger && autoLine) {
      await lhCartRequest('cart/change.js', { id: autoLine.key, quantity: 0 });
    } else if (autoLine && autoLine.quantity !== 1) {
      await lhCartRequest('cart/change.js', { id: autoLine.key, quantity: 1 });
    }
    if (!hasTrigger && declined) {
      await lhCartRequest('cart/update.js', { attributes: { [LH_DECLINED_ATTRIBUTE]: '' } });
    }
  }

  setBusy(busy) {
    this.querySelector('[data-lh-drawer-body]')?.setAttribute('aria-busy', String(busy));
  }

  showError(message) {
    const error = this.querySelector('[data-lh-drawer-error]');
    if (error) error.textContent = message;
  }
}

customElements.define('lh-cart-drawer', LhCartDrawer);

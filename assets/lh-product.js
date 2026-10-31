const lhRoute = (path) => `${window.Shopify?.routes?.root || '/'}${path}`;

class LhProductForm extends HTMLElement {
  connectedCallback() {
    this.variants = JSON.parse(this.querySelector('[data-lh-variants]').textContent);
    this.selected = JSON.parse(this.dataset.selected);
    this.quantity = 1;
    this.addEventListener('click', this.onClick.bind(this));
    this.addEventListener('change', this.onChange.bind(this));
    this.render();
  }

  get variant() {
    if (this.selected.includes(null)) return null;
    return this.variants.find((variant) => this.matchesSelection(variant)) || null;
  }

  get previewVariant() {
    return this.variant || this.variants.find((variant) => this.matchesSelection(variant, true)) || this.variants[0];
  }

  matchesSelection(variant, ignoreEmpty = false, overrides = {}) {
    return variant.options.every((value, index) => {
      const selected = index in overrides ? overrides[index] : this.selected[index];
      return (ignoreEmpty && selected === null) || value === selected;
    });
  }

  findFor(index, value) {
    return this.variants.find((variant) => this.matchesSelection(variant, true, { [index]: value }));
  }

  isAvailable(index, value) {
    return this.variants.some((variant) => variant.available && this.matchesSelection(variant, true, { [index]: value }));
  }

  onClick(event) {
    const option = event.target.closest('button[data-option-index]');
    if (option) {
      this.selected[Number(option.dataset.optionIndex)] = option.dataset.optionValue;
      this.render();
      return;
    }
    const step = event.target.closest('[data-lh-quantity-step]');
    if (step) {
      this.quantity = Math.max(1, this.quantity + Number(step.dataset.lhQuantityStep));
      this.renderQuantity();
      return;
    }
    if (event.target.closest('[data-lh-add]')) this.addToCart(event.target.closest('[data-lh-add]'));
    if (event.target.closest('[data-lh-buy-now]')) this.buyNow();
    const copy = event.target.closest('[data-lh-copy]');
    if (copy) this.copyCode(copy);
  }

  onChange(event) {
    const select = event.target.closest('select[data-option-index]');
    if (!select) return;
    this.selected[Number(select.dataset.optionIndex)] = select.value || null;
    this.render();
  }

  render() {
    const variant = this.variant;
    const preview = this.previewVariant;

    this.querySelectorAll('button[data-option-index]').forEach((button) => {
      const index = Number(button.dataset.optionIndex);
      const pressed = this.selected[index] === button.dataset.optionValue;
      button.setAttribute('aria-pressed', String(pressed));
      button.disabled = !pressed && !this.isAvailable(index, button.dataset.optionValue);
      const ribbon = button.querySelector('[data-lh-ribbon]');
      if (ribbon) ribbon.textContent = this.findFor(index, button.dataset.optionValue)?.ribbon || '';
    });

    this.querySelectorAll('select[data-option-index]').forEach((select) => {
      const index = Number(select.dataset.optionIndex);
      select.querySelectorAll('option:not([value=""])').forEach((option) => {
        option.disabled = !this.isAvailable(index, option.value);
      });
      select.classList.toggle('is-placeholder', !select.value);
    });

    this.querySelectorAll('[data-lh-selected-value]').forEach((label) => {
      label.textContent = this.selected[Number(label.dataset.lhSelectedValue)] || '';
    });

    this.setText('[data-lh-price]', preview.price);
    this.setText('[data-lh-compare]', preview.compare);
    const save = this.querySelector('[data-lh-save]');
    if (save) {
      save.textContent = save.dataset.template.replace('[percent]', preview.save);
      save.hidden = !preview.save;
    }
    this.querySelectorAll('[data-lh-offer-price]').forEach((price) => {
      price.textContent = preview.offers?.[Number(price.dataset.lhOfferPrice)] || '';
    });

    const image = this.querySelector('[data-lh-image] img');
    if (image && preview.image && image.getAttribute('src') !== preview.image) {
      image.removeAttribute('srcset');
      image.src = preview.image;
    }
    const gallery = this.querySelector('lh-gallery');
    if (variant?.media && gallery?.goToMedia) gallery.goToMedia(variant.media);

    const purchasable = Boolean(variant?.available);
    this.querySelectorAll('[data-lh-add], [data-lh-buy-now]').forEach((button) => {
      button.disabled = !purchasable;
    });
    const addLabel = this.querySelector('[data-lh-add-label]');
    if (addLabel) {
      addLabel.textContent = variant && !variant.available ? addLabel.dataset.soldOut : addLabel.dataset.default;
    }
    this.renderQuantity();
  }

  renderQuantity() {
    this.setText('[data-lh-quantity-value]', String(this.quantity).padStart(2, '0'));
    const minus = this.querySelector('[data-lh-quantity-step="-1"]');
    if (minus) minus.disabled = this.quantity <= 1;
  }

  setText(selector, text) {
    const element = this.querySelector(selector);
    if (!element) return;
    element.textContent = text || '';
    element.hidden = !text;
  }

  setError(message) {
    const error = this.querySelector('[data-lh-error]');
    if (error) error.textContent = message;
  }

  async addToCart(button) {
    const variant = this.variant;
    if (!variant?.available) return;
    button.setAttribute('aria-busy', 'true');
    this.setError('');
    try {
      await document.querySelector('lh-cart-drawer').add([{ id: variant.id, quantity: this.quantity }]);
      this.dispatchEvent(new CustomEvent('lh:added', { bubbles: true }));
    } catch (error) {
      this.setError(error.message);
    } finally {
      button.removeAttribute('aria-busy');
    }
  }

  buyNow() {
    const variant = this.variant;
    if (variant?.available) window.location.href = lhRoute(`cart/${variant.id}:${this.quantity}`);
  }

  async copyCode(button) {
    try {
      await navigator.clipboard.writeText(button.dataset.lhCopy);
    } catch {
      return;
    }
    button.classList.add('is-copied');
    clearTimeout(button.copiedTimer);
    button.copiedTimer = setTimeout(() => button.classList.remove('is-copied'), 2000);
  }
}

class LhGallery extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-lh-gallery-track]');
    this.slides = [...this.querySelectorAll('[data-lh-slide]')];
    this.index = 0;
    this.addEventListener('click', (event) => {
      const target = event.target.closest('[data-lh-gallery-go]');
      if (target) this.goTo(Number(target.dataset.lhGalleryGo));
      const step = event.target.closest('[data-lh-gallery-step]');
      if (step) this.goTo(this.index + Number(step.dataset.lhGalleryStep));
    });
    this.track.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => {
          this.setIndex(Math.round(this.track.scrollLeft / this.track.clientWidth));
        });
      },
      { passive: true }
    );
    this.setIndex(0);
  }

  goTo(index) {
    const target = Math.min(Math.max(index, 0), this.slides.length - 1);
    this.track.scrollTo({ left: target * this.track.clientWidth });
    this.setIndex(target);
  }

  goToMedia(mediaId) {
    const index = this.slides.findIndex((slide) => slide.dataset.mediaId === String(mediaId));
    if (index >= 0 && index !== this.index) this.goTo(index);
  }

  setIndex(index) {
    this.index = index;
    this.querySelectorAll('[data-lh-gallery-go]').forEach((control) => {
      control.setAttribute('aria-current', String(Number(control.dataset.lhGalleryGo) === index));
    });
    const prev = this.querySelector('[data-lh-gallery-step="-1"]');
    const next = this.querySelector('[data-lh-gallery-step="1"]');
    if (prev) prev.disabled = index === 0;
    if (next) next.disabled = index === this.slides.length - 1;
  }
}

class LhQuickView extends HTMLElement {
  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    this.content = this.querySelector('[data-lh-quick-view-content]');
    this.cache = new Map();
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-lh-quick-view]');
      if (!trigger) return;
      event.preventDefault();
      this.open(trigger);
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog || event.target.closest('[data-lh-quick-view-close]')) this.dialog.close();
    });
    this.dialog.addEventListener('close', () => this.trigger?.focus({ preventScroll: true }));
    this.addEventListener('lh:added', () => this.dialog.close());
  }

  async open(trigger) {
    if (trigger.getAttribute('aria-busy') === 'true') return;
    this.trigger = trigger;
    trigger.setAttribute('aria-busy', 'true');
    const url = `${trigger.dataset.lhQuickView}${trigger.dataset.lhQuickView.includes('?') ? '&' : '?'}section_id=lh-quick-view`;
    try {
      if (!this.cache.has(url)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.statusText);
        this.cache.set(url, await response.text());
      }
      const html = new DOMParser().parseFromString(this.cache.get(url), 'text/html');
      this.content.replaceChildren(html.querySelector('[data-lh-qv]'));
      this.dialog.showModal();
    } catch {
      window.location.href = trigger.dataset.lhQuickView;
    } finally {
      trigger.removeAttribute('aria-busy');
    }
  }
}

customElements.define('lh-product-form', LhProductForm);
customElements.define('lh-gallery', LhGallery);
customElements.define('lh-quick-view', LhQuickView);

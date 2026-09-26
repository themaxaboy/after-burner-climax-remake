// Lightweight DOM menu system with keyboard / gamepad / mouse / touch
// navigation. Items: {type: 'button'|'select'|'toggle'|'slider', id, label,
// options?: [{value, label}], get?(), set?(v), onSelect?(), hint?}
export class Menu {
  constructor({ items, className = '', title = '', subtitle = '', onBack = null, game }) {
    this.game = game;
    this.items = items;
    this.onBack = onBack;
    this.index = 0;
    this.el = document.createElement('div');
    this.el.className = `menu ${className}`;
    if (title) {
      const h = document.createElement('div');
      h.className = 'menu-title';
      h.textContent = title;
      this.el.appendChild(h);
    }
    if (subtitle) {
      const h = document.createElement('div');
      h.className = 'menu-subtitle';
      h.textContent = subtitle;
      this.el.appendChild(h);
    }
    this.list = document.createElement('div');
    this.list.className = 'menu-list';
    this.el.appendChild(this.list);
    this.rows = items.map((it, i) => this._row(it, i));
    this.focus(0);
  }

  _row(it, i) {
    const row = document.createElement('div');
    row.className = `menu-item menu-${it.type || 'button'}`;
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = it.label;
    row.appendChild(label);
    if (it.type && it.type !== 'button') {
      const val = document.createElement('span');
      val.className = 'menu-value';
      row.appendChild(val);
      row.valueEl = val;
      const l = document.createElement('button');
      l.className = 'menu-arrow';
      l.textContent = '‹';
      l.addEventListener('click', (e) => {
        e.stopPropagation();
        this.focus(i);
        this.change(-1);
      });
      const r = document.createElement('button');
      r.className = 'menu-arrow';
      r.textContent = '›';
      r.addEventListener('click', (e) => {
        e.stopPropagation();
        this.focus(i);
        this.change(1);
      });
      row.insertBefore(l, val);
      row.appendChild(r);
    }
    row.addEventListener('pointerenter', () => this.focus(i));
    row.addEventListener('click', () => {
      this.focus(i);
      if (!it.type || it.type === 'button') this.activate();
      else if (it.type === 'toggle') this.change(1);
    });
    this.list.appendChild(row);
    this._refresh(row, it);
    return row;
  }

  _refresh(row, it) {
    if (!row.valueEl) return;
    const v = it.get();
    if (it.type === 'toggle') row.valueEl.textContent = v ? 'ON' : 'OFF';
    else if (it.type === 'slider') row.valueEl.textContent = `${Math.round(v * 100)}%`;
    else if (it.type === 'select') {
      const o = it.options.find((op) => op.value === v);
      row.valueEl.textContent = o ? o.label : String(v);
    }
  }

  refreshAll() {
    this.rows.forEach((r, i) => this._refresh(r, this.items[i]));
  }

  /** @param {boolean} reveal scroll the row into view (key / pad navigation; not for pointer hover) */
  focus(i, reveal = false) {
    const n = this.items.length;
    this.index = ((i % n) + n) % n;
    this.rows.forEach((r, k) => r.classList.toggle('focused', k === this.index));
    // keep the focused row visible in long (scrolling) menus when navigating by key / pad
    const row = this.rows[this.index];
    if (reveal && row?.isConnected) row.scrollIntoView?.({ block: 'nearest' });
    const hint = this.items[this.index].hint;
    this.el.dataset.hint = hint || '';
  }

  change(dir) {
    const it = this.items[this.index];
    if (!it.type || it.type === 'button') return;
    const a = this.game?.audio;
    if (it.type === 'toggle') it.set(!it.get());
    else if (it.type === 'slider') it.set(Math.max(0, Math.min(1, Math.round((it.get() + dir * 0.1) * 10) / 10)));
    else if (it.type === 'select') {
      const opts = it.options;
      let k = opts.findIndex((o) => o.value === it.get());
      k = (k + dir + opts.length) % opts.length;
      it.set(opts[k].value);
    }
    a?.play('uiMove');
    this._refresh(this.rows[this.index], it);
  }

  activate() {
    const it = this.items[this.index];
    this.game?.audio?.play('uiSelect');
    if (it.type === 'toggle' || it.type === 'select') return this.change(1);
    it.onSelect?.();
  }

  /**
   * Poll unified input edges (call once per sim step while visible). Only
   * direction *presses* navigate: the gamepad source turns its stick into
   * presses with key repeat, and reading the move axes here as well made a
   * D-pad press step twice (its hold shows up in moveX one step later).
   */
  update(input) {
    let dy = 0, dx = 0;
    if (input.pressed.up) dy = -1;
    if (input.pressed.down) dy = 1;
    if (input.pressed.left) dx = -1;
    if (input.pressed.right) dx = 1;
    if (dy) {
      this.focus(this.index + dy, true);
      this.game?.audio?.play('uiMove');
    }
    if (dx) this.change(dx);
    if (input.pressed.confirm || input.pressed.missile) this.activate();
    else if ((input.pressed.back || input.pressed.pause) && this.onBack) {
      this.game?.audio?.play('uiBack');
      this.onBack();
    }
  }

  mount(parent) {
    parent.appendChild(this.el);
    return this;
  }

  destroy() {
    this.el.remove();
  }
}

/** Full-screen overlay container helper. */
export function overlay(className = '') {
  const el = document.createElement('div');
  el.className = `overlay ${className}`;
  return el;
}

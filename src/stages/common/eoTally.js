/**
 * "Destroy N of M" Emergency Orders (e.g. 8 of 10 helicopters, 6 AA sites).
 * The timeline starts the order with `tags: []` so the Director does not
 * count or fail it on the first escape; this component counts kills and
 * escapes of enemies tagged `tag`, keeps `eo.remaining` up to date for the
 * HUD and passes / fails the order.
 *
 * opts: { eo: order id, tag, need, total }
 */
export class EoTally {
  constructor(stage, opts) {
    this.stage = stage;
    this.opts = opts;
    this.kills = 0;
    this.escapes = 0;
    this._off = [];
  }

  init() {
    const ev = this.stage.events;
    const { tag } = this.opts;
    this._off.push(ev.on('kill', (k) => k.e.tag === tag && this._count(1, 0)));
    this._off.push(ev.on('escape', (k) => k.e.tag === tag && !k.e.dead && this._count(0, 1)));
  }

  _count(kill, escape) {
    const d = this.stage.director;
    const eo = d.eo;
    if (!eo || eo.id !== this.opts.eo || eo.status !== 'active') return;
    this.kills += kill;
    this.escapes += escape;
    const { need, total } = this.opts;
    eo.remaining = Math.max(0, need - this.kills);
    if (this.kills >= need) d._eoCheck('pass');
    else if (total - this.escapes < need) d._eoCheck('fail');
  }

  update() {
    // the order's clock running out fails it (the Director only has a late safety net)
    const eo = this.stage.director.eo;
    if (eo && eo.id === this.opts.eo && eo.status === 'active' && eo.timeLimit && eo.t > eo.timeLimit) this.stage.director._eoCheck('fail');
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
  }
}

export const eoTally = (opts) => (stage) => new EoTally(stage, opts);

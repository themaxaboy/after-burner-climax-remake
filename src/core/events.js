// Tiny synchronous event bus. Listeners receive a reused payload object, so
// they must copy anything they want to keep.
export class Events {
  constructor() {
    this.map = new Map();
  }
  on(type, fn) {
    let list = this.map.get(type);
    if (!list) this.map.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.map.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload) {
    const list = this.map.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
  clear() {
    this.map.clear();
  }
}

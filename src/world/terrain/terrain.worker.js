// Builds canyon terrain chunk vertex data off the main thread.
import { buildChunk } from './chunkBuilder.js';
import { makeCanyonShape } from './canyonShape.js';

let shape = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    shape = makeCanyonShape(m.def);
    return;
  }
  if (m.type === 'build') {
    const res = buildChunk(shape, m);
    self.postMessage({ type: 'built', id: m.id, gen: m.gen, ...res }, [res.pos.buffer, res.nor.buffer, res.cav.buffer]);
  }
};

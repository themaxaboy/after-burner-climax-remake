// Builds terrain chunk vertex data off the main thread (all profiles).
import { buildChunk } from './chunkBuilder.js';
import { makeTerrainShape } from './profiles.js';

let shape = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    shape = makeTerrainShape(m.def);
    return;
  }
  if (m.type === 'build') {
    const res = buildChunk(shape, m);
    const transfer = [res.pos.buffer, res.nor.buffer, res.cav.buffer, res.rel.buffer];
    if (res.trees) transfer.push(res.trees.buffer);
    self.postMessage({ type: 'built', id: m.id, gen: m.gen, ...res }, transfer);
  }
};

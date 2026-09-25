import { NoToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer, VSMShadowMap } from 'three';

export function createRenderer(canvas) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false, // AA is done in post (MSAA render target / SMAA / FXAA)
    stencil: false,
    depth: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping; // AgX happens in the post chain
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.debug.checkShaderErrors = import.meta.env ? import.meta.env.DEV : true;
  return renderer;
}

export { VSMShadowMap };

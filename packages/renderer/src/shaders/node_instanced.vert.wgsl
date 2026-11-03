// =============================================================================
// PixiJS v8 / WebGPU Instanced Node Vertex & Fragment Shader
// Unpacks the 64-byte NodeInstanceData layout per instance:
//   offset  0: position       vec2<f32> (8 bytes)
//   offset  8: dimensions     vec2<f32> (8 bytes)
//   offset 16: colorRgba      vec4<f32> (16 bytes)
//   offset 32: selectionRgba  vec4<f32> (16 bytes)
//   offset 48: iconAtlasId    f32       (4 bytes)
//   offset 52: collectionFlag f32       (4 bytes)
//   offset 56: padding        vec2<f32> (8 bytes)
// =============================================================================

struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
    viewportSize: vec2<f32>,
    zoom: f32,
    atlasGridSize: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var iconAtlasSampler: sampler;
@group(0) @binding(2) var iconAtlasTexture: texture_2d<f32>;

struct VertexInput {
    @location(0) quadVertex: vec2<f32>,
    @location(1) instPosition: vec2<f32>,
    @location(2) instDimensions: vec2<f32>,
    @location(3) instColorRgba: vec4<f32>,
    @location(4) instSelectionRgba: vec4<f32>,
    @location(5) instIconAtlasId: f32,
    @location(6) instCollectionFlag: f32,
    @location(7) instPadding: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) localUv: vec2<f32>,
    @location(1) atlasUv: vec2<f32>,
    @location(2) colorRgba: vec4<f32>,
    @location(3) selectionRgba: vec4<f32>,
    @location(4) collectionFlag: f32,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let worldPos = in.instPosition + (in.quadVertex - vec2<f32>(0.5, 0.5)) * in.instDimensions;
    out.clipPosition = camera.viewProjectionMatrix * vec4<f32>(worldPos, 0.0, 1.0);
    out.localUv = in.quadVertex;

    let grid = max(camera.atlasGridSize, 1.0);
    let slotIdx = floor(in.instIconAtlasId);
    let col = slotIdx % grid;
    let row = floor(slotIdx / grid);
    out.atlasUv = (vec2<f32>(col, row) + in.quadVertex) / grid;

    out.colorRgba = in.instColorRgba;
    out.selectionRgba = in.instSelectionRgba;
    out.collectionFlag = in.instCollectionFlag;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let centered = (in.localUv - vec2<f32>(0.5, 0.5)) * 2.0;
    let dist = length(centered);
    if (dist > 1.0) {
        discard;
    }

    // Outer selection / bookmark halo ring
    if (dist > 0.84 && in.selectionRgba.a > 0.01) {
        return in.selectionRgba;
    }

    let texSample = textureSample(iconAtlasTexture, iconAtlasSampler, in.atlasUv);
    return mix(in.colorRgba, texSample * in.colorRgba, texSample.a);
}

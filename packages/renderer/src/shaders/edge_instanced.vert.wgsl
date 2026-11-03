// =============================================================================
// PixiJS v8 / WebGPU Instanced Edge & Directed Arrowhead Shader
// Unpacks the 48-byte EdgeInstanceData layout per instance:
//   offset  0: sourcePos     vec2<f32> (8 bytes)
//   offset  8: targetPos     vec2<f32> (8 bytes)
//   offset 16: colorRgba     vec4<f32> (16 bytes)
//   offset 32: thickness     f32       (4 bytes)
//   offset 36: styleFlag     f32       (4 bytes) - 0=solid, 1=dashed, 2=proxy-collection
//   offset 40: reversedFlag  f32       (4 bytes) - 0=normal, 1=reversed arrow
//   offset 44: selectionFlag f32       (4 bytes) - 0=unselected, 1=selected
// =============================================================================

struct CameraUniforms {
    viewProjectionMatrix: mat4x4<f32>,
    viewportSize: vec2<f32>,
    zoom: f32,
    padding: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;

struct EdgeVertexInput {
    @location(0) unitQuad: vec2<f32>,
    @location(1) sourcePos: vec2<f32>,
    @location(2) targetPos: vec2<f32>,
    @location(3) colorRgba: vec4<f32>,
    @location(4) metaPacked: vec4<f32>, // (thickness, styleFlag, reversedFlag, selectionFlag)
};

struct EdgeVertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) colorRgba: vec4<f32>,
    @location(2) styleFlag: f32,
    @location(3) edgeLength: f32,
};

@vertex
fn vs_main(in: EdgeVertexInput) -> EdgeVertexOutput {
    var out: EdgeVertexOutput;
    let thickness = max(in.metaPacked.x, 1.0);
    let reversed = in.metaPacked.z > 0.5;
    let p0 = select(in.sourcePos, in.targetPos, reversed);
    let p1 = select(in.targetPos, in.sourcePos, reversed);

    let delta = p1 - p0;
    let len = max(length(delta), 0.001);
    let dir = delta / len;
    let normal = vec2<f32>(-dir.y, dir.x);

    let worldPos = mix(p0, p1, in.unitQuad.x) + normal * ((in.unitQuad.y - 0.5) * thickness);
    out.clipPosition = camera.viewProjectionMatrix * vec4<f32>(worldPos, 0.0, 1.0);
    out.uv = in.unitQuad;
    out.colorRgba = in.colorRgba;
    out.styleFlag = in.metaPacked.y;
    out.edgeLength = len;
    return out;
}

@fragment
fn fs_main(in: EdgeVertexOutput) -> @location(0) vec4<f32> {
    // Dashed / proxy collection edge pattern
    if (in.styleFlag > 0.5) {
        let phase = fract((in.uv.x * in.edgeLength) / 16.0);
        if (phase > 0.6) {
            discard;
        }
    }
    return in.colorRgba;
}

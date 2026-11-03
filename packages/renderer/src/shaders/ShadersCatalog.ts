export const NODE_INSTANCED_WGSL = `// =============================================================================
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
`;

export const EDGE_INSTANCED_WGSL = `// =============================================================================
// PixiJS v8 / WebGPU Instanced Edge & Directed Arrowhead Shader
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
    @location(4) metaPacked: vec4<f32>,
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
    if (in.styleFlag > 0.5) {
        let phase = fract((in.uv.x * in.edgeLength) / 16.0);
        if (phase > 0.6) {
            discard;
        }
    }
    return in.colorRgba;
}
`;

export const MSDF_TEXT_FRAG_WGSL = `// =============================================================================
// GPU Multi-Channel Signed Distance Field (MSDF) Fragment Shader
// =============================================================================

@group(0) @binding(1) var msdfSampler: sampler;
@group(0) @binding(2) var msdfAtlasTexture: texture_2d<f32>;

struct MsdfFragmentInput {
    @location(0) atlasUv: vec2<f32>,
    @location(1) textColorRgba: vec4<f32>,
};

fn median3(r: f32, g: f32, b: f32) -> f32 {
    return max(min(r, g), min(max(r, g), b));
}

@fragment
fn fs_msdf_main(in: MsdfFragmentInput) -> @location(0) vec4<f32> {
    let sampleRgb = textureSample(msdfAtlasTexture, msdfSampler, in.atlasUv).rgb;
    let sigDist = median3(sampleRgb.r, sampleRgb.g, sampleRgb.b) - 0.5;
    let screenPxDist = sigDist / max(fwidth(sigDist), 0.0001);
    let opacity = clamp(screenPxDist + 0.5, 0.0, 1.0);
    if (opacity < 0.02) {
        discard;
    }
    return vec4<f32>(in.textColorRgba.rgb, in.textColorRgba.a * opacity);
}
`;

export const LAYOUT_NBODY_COMPUTE_WGSL = `// =============================================================================
// Tier 1 WebGPU Tiled N-Body Force Simulation Compute Shader
// =============================================================================

const WORKGROUP_SIZE: u32 = 256u;

struct Node {
    pos: vec2<f32>,
    vel: vec2<f32>,
    mass: f32,
    pinned: u32,
};

@group(0) @binding(0) var<storage, read> inNodes: array<Node>;
@group(0) @binding(1) var<storage, read_write> outNodes: array<Node>;

struct Params {
    nodeCount: u32,
    repulsionConstant: f32,
    damping: f32,
    timeStep: f32,
};

@group(0) @binding(2) var<uniform> params: Params;
var<workgroup> tile: array<vec4<f32>, WORKGROUP_SIZE>;

@compute @workgroup_size(256)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>
) {
    let index = global_id.x;
    let localIndex = local_id.x;

    var myNode: Node;
    var myPos = vec2<f32>(0.0, 0.0);
    var myMass: f32 = 1.0;
    var isPinned: u32 = 1u;

    if (index < params.nodeCount) {
        myNode = inNodes[index];
        myPos = myNode.pos;
        myMass = myNode.mass;
        isPinned = myNode.pinned;
    }

    var totalForce = vec2<f32>(0.0, 0.0);
    let numTiles = (params.nodeCount + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;

    for (var t = 0u; t < numTiles; t++) {
        let tileNodeIdx = t * WORKGROUP_SIZE + localIndex;
        if (tileNodeIdx < params.nodeCount) {
            let other = inNodes[tileNodeIdx];
            tile[localIndex] = vec4<f32>(other.pos.x, other.pos.y, other.mass, 1.0);
        } else {
            tile[localIndex] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }
        workgroupBarrier();

        if (index < params.nodeCount && isPinned == 0u) {
            let tileLimit = min(WORKGROUP_SIZE, params.nodeCount - t * WORKGROUP_SIZE);
            for (var i = 0u; i < tileLimit; i++) {
                let otherData = tile[i];
                let otherIdx = t * WORKGROUP_SIZE + i;

                if (otherIdx != index && otherData.w > 0.0) {
                    let otherPos = otherData.xy;
                    let otherMass = otherData.z;
                    let delta = myPos - otherPos;
                    let distSq = max(dot(delta, delta), 100.0);
                    let force = (params.repulsionConstant * myMass * otherMass) / distSq;
                    totalForce += normalize(delta) * force;
                }
            }
        }
        workgroupBarrier();
    }

    if (index < params.nodeCount) {
        if (isPinned != 0u) {
            outNodes[index] = myNode;
            return;
        }
        myNode.vel = (myNode.vel + totalForce * params.timeStep) * params.damping;
        myNode.pos += myNode.vel * params.timeStep;
        outNodes[index] = myNode;
    }
}
`;

/**
 * Evaluates the median of 3 channels `median(r, g, b)` used by GPU MSDF typography.
 */
export function median3(r: number, g: number, b: number): number {
  return Math.max(Math.min(r, g), Math.min(Math.max(r, g), b));
}

/**
 * Evaluates the MSDF signed distance and screen-space anti-aliased opacity
 * matching `fs_msdf_main` in `msdf_text.frag.wgsl`.
 */
export function evaluateMsdfOpacity(
  r: number,
  g: number,
  b: number,
  fwidthDist = 0.05
): { signedDistance: number; opacity: number } {
  const signedDistance = median3(r, g, b) - 0.5;
  const screenPxDist = signedDistance / Math.max(fwidthDist, 0.0001);
  const opacity = Math.min(1.0, Math.max(0.0, screenPxDist + 0.5));
  return { signedDistance, opacity };
}

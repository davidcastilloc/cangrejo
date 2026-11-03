// =============================================================================
// GPU Multi-Channel Signed Distance Field (MSDF) Fragment Shader
// Evaluates median(r, g, b) - 0.5 with screen-space derivative antialiasing
// for razor-sharp typography across 0.01x to 20.0x continuous zoom.
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

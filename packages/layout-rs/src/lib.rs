//! CANGREJO — Native Rust Force-Directed & Spatial Layout Kernel (`cangrejo-layout-rs`)
//!
//! Provides high-throughput, memory-safe N-body repulsion and Hooke spring attraction
//! for OSINT and forensic link-analysis graphs while strictly preserving pinned nodes.

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutNode {
    pub x: f32,
    pub y: f32,
    pub weight: f32,
    pub pinned: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutEdge {
    pub source_idx: u32,
    pub target_idx: u32,
    pub weight: f32,
}

/// Runs `iterations` steps of ForceAtlas2-inspired repulsion + spring attraction in-place.
/// Strictly guarantees that any node with `pinned != 0` never changes coordinates.
pub fn run_force_directed_iterations(
    nodes: &mut [LayoutNode],
    edges: &[LayoutEdge],
    iterations: usize,
    repulsion_strength: f32,
    spring_constant: f32,
) {
    let n = nodes.len();
    if n <= 1 || iterations == 0 {
        return;
    }

    let mut disp_x = vec![0.0_f32; n];
    let mut disp_y = vec![0.0_f32; n];

    for iter in 0..iterations {
        disp_x.fill(0.0);
        disp_y.fill(0.0);

        // Deterministic cooling schedule
        let temperature = 1.0 - (iter as f32 / (iterations as f32 + 1.0)) * 0.65;

        // 1. All-pairs Coulomb repulsion (with deterministic symmetry breaking at zero distance)
        for i in 0..n {
            for j in (i + 1)..n {
                let mut dx = nodes[i].x - nodes[j].x;
                let mut dy = nodes[i].y - nodes[j].y;
                if dx.abs() < 1e-4 && dy.abs() < 1e-4 {
                    let angle = ((i * 73 + j * 31) % 360) as f32 * std::f32::consts::PI / 180.0;
                    dx = angle.cos() * 2.5;
                    dy = angle.sin() * 2.5;
                }
                let dist_sq = (dx * dx + dy * dy).max(16.0);
                let dist = dist_sq.sqrt();
                let force = repulsion_strength / dist_sq;
                let fx = (dx / dist) * force;
                let fy = (dy / dist) * force;

                disp_x[i] += fx;
                disp_y[i] += fy;
                disp_x[j] -= fx;
                disp_y[j] -= fy;
            }
        }

        // 2. Hooke spring attraction along directed links
        for edge in edges {
            let src = edge.source_idx as usize;
            let dst = edge.target_idx as usize;
            if src >= n || dst >= n || src == dst {
                continue;
            }
            let dx = nodes[dst].x - nodes[src].x;
            let dy = nodes[dst].y - nodes[src].y;
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            let ideal_len = 160.0_f32;
            let spring_force = (dist - ideal_len) * spring_constant * edge.weight.max(0.5);
            let fx = (dx / dist) * spring_force;
            let fy = (dy / dist) * spring_force;

            disp_x[src] += fx;
            disp_y[src] += fy;
            disp_x[dst] -= fx;
            disp_y[dst] -= fy;
        }

        // 3. Apply bounded displacements to unpinned nodes only
        let max_step = 48.0 * temperature;
        for i in 0..n {
            if nodes[i].pinned != 0 {
                continue;
            }
            let dx = disp_x[i];
            let dy = disp_y[i];
            let mag = (dx * dx + dy * dy).sqrt();
            if mag > 1e-6 {
                let limited = mag.min(max_step);
                nodes[i].x += (dx / mag) * limited;
                nodes[i].y += (dy / mag) * limited;
            }
        }
    }
}

/// C-ABI entry point callable from Bun (`bun:ffi`), Tauri native desktop, or WebAssembly.
#[no_mangle]
pub unsafe extern "C" fn cangrejo_layout_step(
    nodes_ptr: *mut LayoutNode,
    nodes_len: usize,
    edges_ptr: *const LayoutEdge,
    edges_len: usize,
    iterations: usize,
) -> u32 {
    if nodes_ptr.is_null() || nodes_len == 0 {
        return 0;
    }
    let nodes = std::slice::from_raw_parts_mut(nodes_ptr, nodes_len);
    let edges = if edges_ptr.is_null() || edges_len == 0 {
        &[][..]
    } else {
        std::slice::from_raw_parts(edges_ptr, edges_len)
    };
    run_force_directed_iterations(nodes, edges, iterations, 18_000.0, 0.04);
    nodes_len as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_pinned_root_and_separates_overlapping_children() {
        let mut nodes = vec![
            LayoutNode {
                x: 42.0,
                y: 84.0,
                weight: 100.0,
                pinned: 1, // Pinned root must never move
            },
            LayoutNode {
                x: 0.0,
                y: 0.0,
                weight: 50.0,
                pinned: 0,
            },
            LayoutNode {
                x: 0.0,
                y: 0.0,
                weight: 50.0,
                pinned: 0,
            },
        ];

        let edges = vec![
            LayoutEdge {
                source_idx: 0,
                target_idx: 1,
                weight: 1.0,
            },
            LayoutEdge {
                source_idx: 0,
                target_idx: 2,
                weight: 1.0,
            },
        ];

        run_force_directed_iterations(&mut nodes, &edges, 25, 18_000.0, 0.04);

        // Pinned node invariant
        assert_eq!(nodes[0].x, 42.0);
        assert_eq!(nodes[0].y, 84.0);

        // Unpinned nodes moved to finite, non-overlapping coordinates
        assert!(nodes[1].x.is_finite() && nodes[1].y.is_finite());
        assert!(nodes[2].x.is_finite() && nodes[2].y.is_finite());
        let child_dist = ((nodes[1].x - nodes[2].x).powi(2) + (nodes[1].y - nodes[2].y).powi(2)).sqrt();
        assert!(child_dist > 10.0, "Expected children to separate, got dist={}", child_dist);
    }

    #[test]
    fn c_abi_entrypoint_executes_safely() {
        let mut nodes = vec![
            LayoutNode { x: 10.0, y: 20.0, weight: 100.0, pinned: 1 },
            LayoutNode { x: 10.0, y: 20.0, weight: 80.0, pinned: 0 },
        ];
        let edges = vec![LayoutEdge { source_idx: 0, target_idx: 1, weight: 1.0 }];

        let processed = unsafe {
            cangrejo_layout_step(
                nodes.as_mut_ptr(),
                nodes.len(),
                edges.as_ptr(),
                edges.len(),
                10,
            )
        };
        assert_eq!(processed, 2);
        assert_eq!(nodes[0].x, 10.0);
        assert_eq!(nodes[0].y, 20.0);
        assert_ne!(nodes[1].x, 10.0);
    }
}

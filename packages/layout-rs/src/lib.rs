//! CANGREJO — Native Rust Barnes-Hut Quadtree & Force-Directed Spatial Layout Kernel (`cangrejo-layout-rs`)
//!
//! Provides high-throughput, memory-safe O(V log V) Barnes-Hut Quadtree N-body repulsion
//! and Hooke spring attraction for OSINT and forensic link-analysis graphs while strictly
//! preserving pinned nodes (`pinned != 0`).
//!
//! Supports zero-copy `bun:ffi` execution over packed stride-6 `Float32Array` buffers
//! (`[x, y, vx, vy, mass, pinned]`) as well as `#[repr(C)]` `LayoutNode` / `LayoutEdge` structs.

pub const LAYOUT_NODE_STRIDE_FLOATS: usize = 6;
const MAX_QUADTREE_DEPTH: usize = 14;

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

#[derive(Clone, Copy, Debug)]
struct QuadCell {
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    com_x: f32,
    com_y: f32,
    total_mass: f32,
    body_index: i32,
    body_x: f32,
    body_y: f32,
    body_mass: f32,
    first_child: u32, // 0 if leaf; otherwise index of child 0 in arena (children are contiguous 0..4)
}

impl QuadCell {
    #[inline]
    fn new(min_x: f32, min_y: f32, max_x: f32, max_y: f32) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
            com_x: 0.0,
            com_y: 0.0,
            total_mass: 0.0,
            body_index: -1,
            body_x: 0.0,
            body_y: 0.0,
            body_mass: 0.0,
            first_child: 0,
        }
    }
}

/// Contiguous arena-allocated Barnes-Hut Quadtree for O(V log V) electrostatic repulsion.
pub struct BarnesHutQuadtree {
    cells: Vec<QuadCell>,
}

impl BarnesHutQuadtree {
    pub fn with_capacity(node_count: usize) -> Self {
        Self {
            cells: Vec::with_capacity((node_count * 4).max(64)),
        }
    }

    pub fn reset(&mut self, min_x: f32, min_y: f32, max_x: f32, max_y: f32) {
        self.cells.clear();
        self.cells.push(QuadCell::new(min_x, min_y, max_x, max_y));
    }

    pub fn insert(&mut self, body_idx: usize, bx: f32, by: f32, bmass: f32) {
        self.insert_recursive(0, body_idx as i32, bx, by, bmass.max(1.0), 0);
    }

    fn insert_recursive(
        &mut self,
        cell_idx: usize,
        body_idx: i32,
        bx: f32,
        by: f32,
        bmass: f32,
        depth: usize,
    ) {
        let cell = self.cells[cell_idx];
        if cell.total_mass == 0.0 && cell.first_child == 0 {
            let c = &mut self.cells[cell_idx];
            c.com_x = bx;
            c.com_y = by;
            c.total_mass = bmass;
            c.body_index = body_idx;
            c.body_x = bx;
            c.body_y = by;
            c.body_mass = bmass;
            return;
        }

        // Update center of mass
        let next_mass = cell.total_mass + bmass;
        {
            let c = &mut self.cells[cell_idx];
            c.com_x = (c.com_x * c.total_mass + bx * bmass) / next_mass;
            c.com_y = (c.com_y * c.total_mass + by * bmass) / next_mass;
            c.total_mass = next_mass;
        }

        if depth >= MAX_QUADTREE_DEPTH {
            return;
        }

        let mid_x = (cell.min_x + cell.max_x) * 0.5;
        let mid_y = (cell.min_y + cell.max_y) * 0.5;

        if self.cells[cell_idx].first_child == 0 {
            let first_child = self.cells.len() as u32;
            self.cells.push(QuadCell::new(cell.min_x, cell.min_y, mid_x, mid_y));
            self.cells.push(QuadCell::new(mid_x, cell.min_y, cell.max_x, mid_y));
            self.cells.push(QuadCell::new(cell.min_x, mid_y, mid_x, cell.max_y));
            self.cells.push(QuadCell::new(mid_x, mid_y, cell.max_x, cell.max_y));
            self.cells[cell_idx].first_child = first_child;

            let old_idx = self.cells[cell_idx].body_index;
            if old_idx != -1 {
                let ox = self.cells[cell_idx].body_x;
                let oy = self.cells[cell_idx].body_y;
                let omass = self.cells[cell_idx].body_mass;
                self.cells[cell_idx].body_index = -1;
                let old_quad = (if ox >= mid_x { 1 } else { 0 }) + (if oy >= mid_y { 2 } else { 0 });
                self.insert_recursive(
                    (first_child as usize) + old_quad,
                    old_idx,
                    ox,
                    oy,
                    omass,
                    depth + 1,
                );
            }
        }

        let first_child = self.cells[cell_idx].first_child as usize;
        let quad = (if bx >= mid_x { 1 } else { 0 }) + (if by >= mid_y { 2 } else { 0 });
        self.insert_recursive(first_child + quad, body_idx, bx, by, bmass, depth + 1);
    }

    #[inline]
    pub fn compute_repulsion(
        &self,
        target_idx: usize,
        tx: f32,
        ty: f32,
        tmass: f32,
        theta: f32,
        repulsion_constant: f32,
    ) -> (f32, f32) {
        let mut fx = 0.0_f32;
        let mut fy = 0.0_f32;
        self.accumulate_force(
            0,
            target_idx as i32,
            tx,
            ty,
            tmass.max(1.0),
            theta,
            repulsion_constant,
            &mut fx,
            &mut fy,
        );
        (fx, fy)
    }

    fn accumulate_force(
        &self,
        cell_idx: usize,
        target_idx: i32,
        tx: f32,
        ty: f32,
        tmass: f32,
        theta: f32,
        repulsion_constant: f32,
        out_fx: &mut f32,
        out_fy: &mut f32,
    ) {
        let cell = &self.cells[cell_idx];
        if cell.total_mass == 0.0 || (cell.body_index == target_idx && cell.first_child == 0) {
            return;
        }

        let mut dx = tx - cell.com_x;
        let mut dy = ty - cell.com_y;
        if dx.abs() < 1e-4 && dy.abs() < 1e-4 {
            let seed = ((target_idx as usize).wrapping_mul(73).wrapping_add(cell_idx.wrapping_mul(31)) % 360) as f32
                * std::f32::consts::PI
                / 180.0;
            dx = seed.cos() * 2.5;
            dy = seed.sin() * 2.5;
        }

        let dist_sq = (dx * dx + dy * dy).max(64.0);
        let dist = dist_sq.sqrt();
        let region_width = cell.max_x - cell.min_x;

        if cell.first_child == 0 || (region_width / dist) < theta {
            let f = (repulsion_constant * tmass * cell.total_mass) / dist_sq;
            *out_fx += (dx / dist) * f;
            *out_fy += (dy / dist) * f;
            return;
        }

        let base_child = cell.first_child as usize;
        for offset in 0..4 {
            let child_idx = base_child + offset;
            if self.cells[child_idx].total_mass > 0.0 {
                self.accumulate_force(
                    child_idx,
                    target_idx,
                    tx,
                    ty,
                    tmass,
                    theta,
                    repulsion_constant,
                    out_fx,
                    out_fy,
                );
            }
        }
    }
}

/// Runs `iterations` steps of Barnes-Hut O(V log V) ForceAtlas2 repulsion + Hooke spring attraction
/// directly over a packed stride-6 `Float32Array` (`[x, y, vx, vy, mass, pinned]`) and stride-2
/// `Uint32Array` (`[sourceIdx, targetIdx]`). Strictly preserves nodes where `pinned != 0.0`.
pub fn run_barnes_hut_stride6_buffer(
    node_state: &mut [f32],
    edge_indices: &[u32],
    iterations: usize,
    theta: f32,
) {
    let node_count = node_state.len() / LAYOUT_NODE_STRIDE_FLOATS;
    if node_count <= 1 || iterations == 0 {
        return;
    }
    let edge_count = edge_indices.len() / 2;
    let theta_clamped = theta.clamp(0.2, 1.5);
    let repulsion_constant = 6_000.0_f32;
    let spring_k = 0.08_f32;
    let ideal_len = 140.0_f32;
    let damping = 0.85_f32;
    let dt = 0.15_f32;

    let mut quadtree = BarnesHutQuadtree::with_capacity(node_count);
    let mut forces_x = vec![0.0_f32; node_count];
    let mut forces_y = vec![0.0_f32; node_count];

    for _it in 0..iterations {
        let mut min_x = -1000.0_f32;
        let mut min_y = -1000.0_f32;
        let mut max_x = 1000.0_f32;
        let mut max_y = 1000.0_f32;

        for i in 0..node_count {
            let base = i * LAYOUT_NODE_STRIDE_FLOATS;
            let x = node_state[base];
            let y = node_state[base + 1];
            if x - 10.0 < min_x {
                min_x = x - 10.0;
            }
            if y - 10.0 < min_y {
                min_y = y - 10.0;
            }
            if x + 10.0 > max_x {
                max_x = x + 10.0;
            }
            if y + 10.0 > max_y {
                max_y = y + 10.0;
            }
        }

        quadtree.reset(min_x, min_y, max_x, max_y);
        for i in 0..node_count {
            let base = i * LAYOUT_NODE_STRIDE_FLOATS;
            quadtree.insert(
                i,
                node_state[base],
                node_state[base + 1],
                node_state[base + 4].max(1.0),
            );
        }

        for i in 0..node_count {
            let base = i * LAYOUT_NODE_STRIDE_FLOATS;
            if node_state[base + 5] != 0.0 {
                forces_x[i] = 0.0;
                forces_y[i] = 0.0;
                continue;
            }
            let (fx, fy) = quadtree.compute_repulsion(
                i,
                node_state[base],
                node_state[base + 1],
                node_state[base + 4].max(1.0),
                theta_clamped,
                repulsion_constant,
            );
            forces_x[i] = fx;
            forces_y[i] = fy;
        }

        for e in 0..edge_count {
            let s = edge_indices[e * 2] as usize;
            let t = edge_indices[e * 2 + 1] as usize;
            if s >= node_count || t >= node_count || s == t {
                continue;
            }
            let base_s = s * LAYOUT_NODE_STRIDE_FLOATS;
            let base_t = t * LAYOUT_NODE_STRIDE_FLOATS;
            let dx = node_state[base_t] - node_state[base_s];
            let dy = node_state[base_t + 1] - node_state[base_s + 1];
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            let f = spring_k * (dist - ideal_len);
            let fx = (dx / dist) * f;
            let fy = (dy / dist) * f;

            if node_state[base_s + 5] == 0.0 {
                forces_x[s] += fx;
                forces_y[s] += fy;
            }
            if node_state[base_t + 5] == 0.0 {
                forces_x[t] -= fx;
                forces_y[t] -= fy;
            }
        }

        for i in 0..node_count {
            let base = i * LAYOUT_NODE_STRIDE_FLOATS;
            if node_state[base + 5] != 0.0 {
                continue;
            }
            let vx = (node_state[base + 2] + forces_x[i] * dt) * damping;
            let vy = (node_state[base + 3] + forces_y[i] * dt) * damping;
            node_state[base + 2] = vx;
            node_state[base + 3] = vy;
            node_state[base] += vx * dt;
            node_state[base + 1] += vy * dt;
        }
    }
}

/// Runs `iterations` steps of Barnes-Hut O(V log V) ForceAtlas2 repulsion + spring attraction in-place
/// on `LayoutNode` slices. Strictly guarantees that any node with `pinned != 0` never changes coordinates.
pub fn run_barnes_hut_iterations(
    nodes: &mut [LayoutNode],
    edges: &[LayoutEdge],
    iterations: usize,
    theta: f32,
    repulsion_strength: f32,
    spring_constant: f32,
) {
    let n = nodes.len();
    if n <= 1 || iterations == 0 {
        return;
    }

    let theta_clamped = theta.clamp(0.2, 1.5);
    let mut quadtree = BarnesHutQuadtree::with_capacity(n);
    let mut disp_x = vec![0.0_f32; n];
    let mut disp_y = vec![0.0_f32; n];

    for iter in 0..iterations {
        disp_x.fill(0.0);
        disp_y.fill(0.0);

        let temperature = 1.0 - (iter as f32 / (iterations as f32 + 1.0)) * 0.65;

        let mut min_x = -1000.0_f32;
        let mut min_y = -1000.0_f32;
        let mut max_x = 1000.0_f32;
        let mut max_y = 1000.0_f32;
        for node in nodes.iter() {
            if node.x - 10.0 < min_x {
                min_x = node.x - 10.0;
            }
            if node.y - 10.0 < min_y {
                min_y = node.y - 10.0;
            }
            if node.x + 10.0 > max_x {
                max_x = node.x + 10.0;
            }
            if node.y + 10.0 > max_y {
                max_y = node.y + 10.0;
            }
        }

        quadtree.reset(min_x, min_y, max_x, max_y);
        for (i, node) in nodes.iter().enumerate() {
            quadtree.insert(i, node.x, node.y, (node.weight / 50.0).max(1.0));
        }

        for i in 0..n {
            if nodes[i].pinned != 0 {
                continue;
            }
            let (fx, fy) = quadtree.compute_repulsion(
                i,
                nodes[i].x,
                nodes[i].y,
                (nodes[i].weight / 50.0).max(1.0),
                theta_clamped,
                repulsion_strength,
            );
            disp_x[i] += fx;
            disp_y[i] += fy;
        }

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

/// Runs `iterations` steps of ForceAtlas2-inspired repulsion + spring attraction in-place.
/// Delegates to the Barnes-Hut O(V log V) Quadtree engine with `theta = 0.8`.
/// Strictly guarantees that any node with `pinned != 0` never changes coordinates.
pub fn run_force_directed_iterations(
    nodes: &mut [LayoutNode],
    edges: &[LayoutEdge],
    iterations: usize,
    repulsion_strength: f32,
    spring_constant: f32,
) {
    run_barnes_hut_iterations(
        nodes,
        edges,
        iterations,
        0.8,
        repulsion_strength,
        spring_constant,
    );
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
    run_barnes_hut_iterations(nodes, edges, iterations, 0.8, 18_000.0, 0.04);
    nodes_len as u32
}

/// Zero-copy C-ABI entry point for Barnes-Hut O(V log V) layout over `LayoutNode` arrays with custom `theta`.
#[no_mangle]
pub unsafe extern "C" fn cangrejo_barnes_hut_step(
    nodes_ptr: *mut LayoutNode,
    nodes_len: usize,
    edges_ptr: *const LayoutEdge,
    edges_len: usize,
    iterations: usize,
    theta: f32,
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
    run_barnes_hut_iterations(nodes, edges, iterations, theta, 18_000.0, 0.04);
    nodes_len as u32
}

/// Zero-copy C-ABI entry point callable directly from `NativeRayonBridge` via `bun:ffi` `ptr(Float32Array)`
/// and `ptr(Uint32Array)` without marshalling or copying JS typed arrays.
#[no_mangle]
pub unsafe extern "C" fn cangrejo_barnes_hut_stride6_step(
    node_buf_ptr: *mut f32,
    node_floats_len: usize,
    edge_buf_ptr: *const u32,
    edge_u32_len: usize,
    iterations: u32,
    theta: f32,
) -> u32 {
    if node_buf_ptr.is_null() || node_floats_len < LAYOUT_NODE_STRIDE_FLOATS {
        return 0;
    }
    let node_state = std::slice::from_raw_parts_mut(node_buf_ptr, node_floats_len);
    let edge_indices = if edge_buf_ptr.is_null() || edge_u32_len < 2 {
        &[][..]
    } else {
        std::slice::from_raw_parts(edge_buf_ptr, edge_u32_len)
    };
    run_barnes_hut_stride6_buffer(node_state, edge_indices, iterations as usize, theta);
    (node_floats_len / LAYOUT_NODE_STRIDE_FLOATS) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

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
        let child_dist =
            ((nodes[1].x - nodes[2].x).powi(2) + (nodes[1].y - nodes[2].y).powi(2)).sqrt();
        assert!(
            child_dist > 10.0,
            "Expected children to separate, got dist={}",
            child_dist
        );
    }

    #[test]
    fn c_abi_entrypoint_executes_safely() {
        let mut nodes = vec![
            LayoutNode {
                x: 10.0,
                y: 20.0,
                weight: 100.0,
                pinned: 1,
            },
            LayoutNode {
                x: 10.0,
                y: 20.0,
                weight: 80.0,
                pinned: 0,
            },
        ];
        let edges = vec![LayoutEdge {
            source_idx: 0,
            target_idx: 1,
            weight: 1.0,
        }];

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

    #[test]
    fn barnes_hut_1000_nodes_executes_under_budget_and_preserves_pinned_nodes() {
        let count = 1_000usize;
        let mut node_state = vec![0.0_f32; count * LAYOUT_NODE_STRIDE_FLOATS];
        for i in 0..count {
            let base = i * LAYOUT_NODE_STRIDE_FLOATS;
            node_state[base] = ((i % 40) as f32) * 18.0 - 350.0;
            node_state[base + 1] = ((i / 40) as f32) * 18.0 - 220.0;
            node_state[base + 2] = 0.0;
            node_state[base + 3] = 0.0;
            node_state[base + 4] = 1.5;
            node_state[base + 5] = if i % 250 == 0 { 1.0 } else { 0.0 };
        }

        let pinned_snapshots: Vec<(usize, f32, f32)> = (0..count)
            .step_by(250)
            .map(|i| {
                let base = i * LAYOUT_NODE_STRIDE_FLOATS;
                (i, node_state[base], node_state[base + 1])
            })
            .collect();

        let mut edge_indices = Vec::with_capacity((count - 1) * 2);
        for i in 1..count {
            edge_indices.push(((i - 1) / 3) as u32);
            edge_indices.push(i as u32);
        }

        let start = Instant::now();
        let processed = unsafe {
            cangrejo_barnes_hut_stride6_step(
                node_state.as_mut_ptr(),
                node_state.len(),
                edge_indices.as_ptr(),
                edge_indices.len(),
                1,
                0.8,
            )
        };
        let elapsed = start.elapsed();

        assert_eq!(processed, count as u32);
        for &(idx, orig_x, orig_y) in &pinned_snapshots {
            let base = idx * LAYOUT_NODE_STRIDE_FLOATS;
            assert_eq!(node_state[base], orig_x, "Pinned node {} X mutated", idx);
            assert_eq!(node_state[base + 1], orig_y, "Pinned node {} Y mutated", idx);
        }
        assert!(
            elapsed.as_millis() < 25,
            "Expected 1,000-node Barnes-Hut step to complete rapidly, took {:?}",
            elapsed
        );
    }
}

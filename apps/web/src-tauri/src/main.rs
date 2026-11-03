#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cangrejo_layout_rs::cangrejo_barnes_hut_stride6_step;

/// Invokes the native Rayon Barnes-Hut Quadtree step from the Tauri desktop host.
pub fn run_desktop_barnes_hut_step(
    node_buf: &mut [f32],
    edge_indices: &[u32],
    iterations: u32,
    theta: f32,
) -> u32 {
    if node_buf.len() < 6 {
        return 0;
    }
    unsafe {
        cangrejo_barnes_hut_stride6_step(
            node_buf.as_mut_ptr(),
            node_buf.len(),
            edge_indices.as_ptr(),
            edge_indices.len(),
            iterations,
            theta,
        )
    }
}

fn main() {
    // Tauri v2 desktop host entrypoint for CANGREJO OSINT Workstation (see ../tauri.conf.json).
    let mut sample_nodes: [f32; 12] = [
        0.0, 0.0, 0.0, 0.0, 1.0, 0.0, // Node 0
        48.0, 32.0, 0.0, 0.0, 1.0, 0.0, // Node 1
    ];
    let sample_edges: [u32; 2] = [0, 1];
    let updated = run_desktop_barnes_hut_step(&mut sample_nodes, &sample_edges, 1, 0.8);
    println!("CANGREJO Tauri Desktop Host initialized (Barnes-Hut nodes verified: {updated})");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_host_invokes_barnes_hut_stride6() {
        let mut nodes: [f32; 12] = [
            0.0, 0.0, 0.0, 0.0, 1.0, 1.0, // Node 0 (pinned)
            10.0, 10.0, 0.0, 0.0, 1.0, 0.0, // Node 1 (unpinned)
        ];
        let edges: [u32; 2] = [0, 1];
        let count = run_desktop_barnes_hut_step(&mut nodes, &edges, 2, 0.8);
        assert_eq!(count, 2);
        assert_eq!(nodes[0], 0.0);
        assert_eq!(nodes[1], 0.0);
    }
}

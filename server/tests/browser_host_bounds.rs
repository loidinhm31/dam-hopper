use std::sync::atomic::Ordering;
use std::sync::Arc;

use bytes::Bytes;
use dam_hopper_server::browser_host::diagnostics::{
    global_stream_diagnostics, MemoryAdmissionController, TrackedBhjfFrame,
    MAX_BROWSER_PAYLOAD_MEMORY_BYTES, MAX_QUALIFICATION_EVENTS,
};
use dam_hopper_server::browser_host::protocol::{
    pack_bhjf_frame, TargetFrameHeader, TargetGeometry,
};
use uuid::Uuid;

fn make_dummy_jpeg() -> Vec<u8> {
    let mut data = vec![
        0xFF, 0xD8, // SOI
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02,
        0x11, 0x01, 0x03, 0x11, 0x01, // SOF0
        0xFF, 0xD9, // EOI
    ];
    data.resize(64, 0);
    data[62] = 0xFF;
    data[63] = 0xD9;
    data
}

fn make_bhjf_bytes(seq: &str) -> Bytes {
    let header = TargetFrameHeader {
        browser_session_id: Uuid::new_v4().to_string(),
        browser_incarnation: Uuid::new_v4().to_string(),
        profile_epoch: "1".to_string(),
        producer_run: Uuid::new_v4().to_string(),
        viewport_epoch: "1".to_string(),
        frame_seq: seq.to_string(),
        width: 64,
        height: 64,
        capture_time_unix_ms: 1000,
        geometry: TargetGeometry {
            css_width: 64.0,
            css_height: 64.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
        input_trusted: true,
    };
    pack_bhjf_frame(&header, &make_dummy_jpeg()).expect("pack frame")
}

#[test]
fn test_memory_admission_controller_hard_caps() {
    let cap = 1024 * 1024; // 1 MiB test cap
    let controller = MemoryAdmissionController::new(cap);

    // 1. Valid reservation within cap
    let res1 = controller.try_reserve(512 * 1024).expect("reserve 512 KiB");
    assert_eq!(controller.current_reserved_bytes(), 512 * 1024);
    assert_eq!(controller.peak_reserved_bytes(), 512 * 1024);

    // 2. Second reservation that reaches cap
    let res2 = controller.try_reserve(512 * 1024).expect("reserve 512 KiB");
    assert_eq!(controller.current_reserved_bytes(), 1024 * 1024);

    // 3. Third reservation exceeds cap -> must reject!
    let err = controller.try_reserve(1).unwrap_err();
    assert_eq!(err.current_reserved_bytes, 1024 * 1024);
    assert_eq!(controller.rejection_count(), 1);

    // 4. Drop res1 -> frees 512 KiB
    drop(res1);
    assert_eq!(controller.current_reserved_bytes(), 512 * 1024);

    // 5. Now reservation of 256 KiB succeeds
    let res3 = controller.try_reserve(256 * 1024).expect("reserve 256 KiB");
    assert_eq!(controller.current_reserved_bytes(), 768 * 1024);

    drop(res2);
    drop(res3);
    assert_eq!(controller.current_reserved_bytes(), 0);
}
#[test]
fn test_memory_reservation_adjust_growth_and_shrink() {
    let cap = 1000;
    let controller = MemoryAdmissionController::new(cap);

    let mut res = controller.try_reserve(200).expect("reserve 200");
    assert_eq!(controller.current_reserved_bytes(), 200);

    // Grow by 300 to 500
    res.adjust(500).expect("grow to 500");
    assert_eq!(controller.current_reserved_bytes(), 500);

    // Shrink to 100
    res.adjust(100).expect("shrink to 100");
    assert_eq!(controller.current_reserved_bytes(), 100);

    // Attempt to grow past cap (1500 > 1000)
    let err = res.adjust(1500).unwrap_err();
    assert_eq!(err.max_allowed_bytes, cap);
    assert_eq!(controller.current_reserved_bytes(), 100);

    // Drop releases remaining 100
    drop(res);
    assert_eq!(controller.current_reserved_bytes(), 0);
}


#[test]
fn test_tracked_bhjf_frame_last_clone_drops_reservation() {
    let controller = MemoryAdmissionController::new(MAX_BROWSER_PAYLOAD_MEMORY_BYTES);
    let frame_bytes = make_bhjf_bytes("1");
    let byte_len = frame_bytes.len();

    let res = controller.try_reserve(byte_len).expect("reserve frame bytes");
    let tracked_frame_1 = TrackedBhjfFrame::new(frame_bytes, res);

    assert_eq!(controller.current_reserved_bytes(), byte_len);
    assert_eq!(controller.unique_buffer_count(), 1);
    assert_eq!(controller.active_clone_count(), 1);

    // Fanout: clone tracked frame to 3 viewers
    let tracked_frame_2 = tracked_frame_1.clone();
    let tracked_frame_3 = tracked_frame_1.clone();
    let tracked_frame_4 = tracked_frame_1.clone();

    // 4 active clones, but unique buffers is still 1, and reserved bytes is still 1x byte_len!
    assert_eq!(controller.current_reserved_bytes(), byte_len);
    assert_eq!(controller.unique_buffer_count(), 1);
    assert_eq!(controller.active_clone_count(), 4);

    // Viewers 1 and 2 finish transmission and drop their references
    drop(tracked_frame_2);
    drop(tracked_frame_3);
    assert_eq!(controller.current_reserved_bytes(), byte_len); // Still held!
    assert_eq!(controller.active_clone_count(), 2);
    assert_eq!(controller.unique_buffer_count(), 1);

    // Viewer 3 drops
    drop(tracked_frame_4);
    assert_eq!(controller.current_reserved_bytes(), byte_len); // Still held by tracked_frame_1 (e.g. cached/outstanding)
    assert_eq!(controller.active_clone_count(), 1);

    // Slow writer / last reference drops
    drop(tracked_frame_1);
    // Now and only now does the memory reservation get released!
    assert_eq!(controller.current_reserved_bytes(), 0);
    assert_eq!(controller.unique_buffer_count(), 0);
    assert_eq!(controller.active_clone_count(), 0);
}

#[test]
fn test_stream_diagnostics_counters_and_ring_buffer() {
    let diag = global_stream_diagnostics();

    diag.events_received.store(100, Ordering::Relaxed);
    diag.events_admitted.store(95, Ordering::Relaxed);
    diag.events_dropped.store(5, Ordering::Relaxed);
    diag.delivered_frames.store(10, Ordering::Relaxed);
    diag.periodic_screenshot_violations.store(0, Ordering::Relaxed);

    // Operational counters distinguish producer capture work (100) from viewer delivery rate (10)
    assert_eq!(diag.events_received.load(Ordering::Relaxed), 100);
    assert_eq!(diag.delivered_frames.load(Ordering::Relaxed), 10);
    assert_eq!(diag.periodic_screenshot_violations.load(Ordering::Relaxed), 0);

    // Test qualification event ring buffer
    for i in 0..(MAX_QUALIFICATION_EVENTS + 50) {
        diag.record_qualification_event("frame_publish", "sess-1", Some(&i.to_string()));
    }

    let exported = diag.export_qualification_events();
    // Bounded capacity respected
    assert_eq!(exported.len(), MAX_QUALIFICATION_EVENTS);

    // Most recent event is the last in the ring
    let last = exported.last().unwrap();
    assert_eq!(last.frame_seq.as_deref(), Some("305"));
}

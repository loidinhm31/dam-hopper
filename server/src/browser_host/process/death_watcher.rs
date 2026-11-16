//! Supervisor death watcher: the forked helper that tears the browser tree down when the
//! supervisor dies by any means (including SIGKILL).
//!
//! The watcher is forked from the browser leader inside `pre_exec`, in a multithreaded
//! process, so everything here is async-signal-safe: raw syscalls and stack buffers only
//! (no allocation, no locks, no libc stdio/dirent). It never `exec`s.
//!
//! **No signal ever names a bare PID or PGID that could have been recycled.** The watcher
//! holds a pidfd on the browser leader, taken by the leader itself before the fork, and uses
//! `pidfd_send_signal(PIDFD_SIGNAL_PROCESS_GROUP)` (Linux 6.9+). That addresses the kernel's
//! process-group object (not a number): it reaches exactly the members of the launch's group
//! even after the leader was reaped and the number was freed, and is `ESRCH` once the group is
//! empty. A recycled number is a different object it never touches.
//!
//! Kernels without `PIDFD_SIGNAL_PROCESS_GROUP` (< 6.9) are **not supported**: arming fails
//! with `EINVAL` and the launch is rejected. Before 6.9 there is no way to tell, after the
//! leader is reaped, whether a process in a group with the leader's number belongs to this
//! launch or to an unrelated group that recycled the number, so any per-member fallback could
//! signal foreign processes.

use std::ffi::c_long;

/// `PIDFD_SIGNAL_PROCESS_GROUP` (Linux 6.9): signal the process group the pidfd belongs to.
const PIDFD_SIGNAL_PROCESS_GROUP: c_long = 1 << 2;

/// Descriptors the watcher keeps: the death pipe, the readiness pipe and the leader pidfd.
const FD_DEATH: i32 = 0;
const FD_READY: i32 = 3;
const FD_LEADER: i32 = 4;
/// Scratch descriptors used while rearranging the kept set; closed by `close_range`.
const FD_SCRATCH_MIN: i32 = 5;

/// Gap between the graceful TERM and the final KILL.
const TERM_TO_KILL_GAP_NS: i64 = 500_000_000;

/// Parameters the forked watcher needs; plain data so the child touches no heap.
#[derive(Clone, Copy)]
pub(super) struct Params {
    /// pidfd of the leader taken by the leader itself.
    pub leader_pidfd: i32,
    /// Read end of the supervisor death pipe.
    pub death_read: i32,
    /// Write end of the death pipe: an inherited copy must be closed or EOF never arrives.
    pub death_write: i32,
    /// Readiness pipe write end (CLOEXEC; closed explicitly here because nothing execs).
    pub ready_write: i32,
    pub mock_pre_exec_fail: bool,
    pub mock_arming_fail: bool,
    /// Makes arming behave as on a kernel without `PIDFD_SIGNAL_PROCESS_GROUP`.
    pub force_group_signal_unsupported: bool,
}

pub(super) fn open_pidfd(pid: i32) -> i32 {
    unsafe { libc::syscall(libc::SYS_pidfd_open, pid as c_long, 0 as c_long) as i32 }
}

fn errno() -> i32 {
    unsafe { *libc::__errno_location() }
}

/// `pidfd_send_signal` with `flags`; `Ok(())` on delivery, `Err(errno)` otherwise.
fn pidfd_signal(pidfd: i32, sig: i32, flags: c_long) -> Result<(), i32> {
    let ret = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            pidfd as c_long,
            sig as c_long,
            0 as c_long,
            flags,
        )
    };
    if ret < 0 {
        Err(errno())
    } else {
        Ok(())
    }
}

fn sleep_ns(ns: i64) {
    let mut req = libc::timespec {
        tv_sec: ns / 1_000_000_000,
        tv_nsec: ns % 1_000_000_000,
    };
    loop {
        let mut rem = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        if unsafe { libc::nanosleep(&req, &mut rem) } == 0 || errno() != libc::EINTR {
            return;
        }
        req = rem;
    }
}

/// Signals the launch's process-group object through the pinned leader pidfd.
fn signal_group(sig: i32) {
    let _ = pidfd_signal(FD_LEADER, sig, PIDFD_SIGNAL_PROCESS_GROUP);
}

/// TERM, grace gap, KILL. Never returns. The kernel delivers SIGKILL to the whole group
/// atomically and a member that forks concurrently is aborted by its own pending fatal
/// signal: one delivery suffices.
fn teardown() -> ! {
    signal_group(libc::SIGTERM);
    sleep_ns(TERM_TO_KILL_GAP_NS);
    signal_group(libc::SIGKILL);
    unsafe { libc::_exit(0) }
}

/// Blocks until the supervisor's death-pipe write end is closed (EOF) or the pipe breaks.
fn wait_for_supervisor_death() {
    let mut sink = [0u8; 64];
    loop {
        let n = unsafe { libc::read(FD_DEATH, sink.as_mut_ptr().cast(), sink.len()) };
        if n > 0 || (n < 0 && errno() == libc::EINTR) {
            continue;
        }
        // EOF (the supervisor is gone) or an unusable pipe: both tear the browser down.
        return;
    }
}

/// Reports an arming failure through the readiness pipe and exits.
fn fail_arming(code: i32) -> ! {
    let byte = [if code <= 0 || code > 255 {
        127
    } else {
        code as u8
    }];
    unsafe {
        libc::write(FD_READY, byte.as_ptr().cast(), 1);
        libc::_exit(127)
    }
}

/// Body of the forked watcher. Async-signal-safe; never returns.
///
/// # Safety
/// Must run only in the freshly forked child of a process whose descriptors in `params` are
/// valid; it rearranges and closes every descriptor of the process.
pub(super) unsafe fn run(params: Params) -> ! {
    // The inherited write end of the death pipe would keep the pipe open forever.
    libc::close(params.death_write);
    if params.mock_pre_exec_fail {
        libc::_exit(127);
    }
    // Independent process group: the browser group's TERM/KILL never reaches the watcher.
    if libc::setpgid(0, 0) != 0 {
        libc::_exit(127);
    }

    // Normalise the descriptor table. Copies go to fresh numbers first so that no original
    // (which may sit on 0..=4) is overwritten before it is copied.
    let death = libc::fcntl(params.death_read, libc::F_DUPFD, FD_SCRATCH_MIN);
    let ready = libc::fcntl(params.ready_write, libc::F_DUPFD, FD_SCRATCH_MIN);
    let leader = libc::fcntl(params.leader_pidfd, libc::F_DUPFD, FD_SCRATCH_MIN);
    let devnull = libc::open(c"/dev/null".as_ptr(), libc::O_RDWR);
    if death < 0 || ready < 0 || leader < 0 || devnull < 0 {
        libc::_exit(127);
    }
    if libc::dup2(devnull, 1) < 0 || libc::dup2(devnull, 2) < 0 {
        libc::_exit(127);
    }
    if libc::dup2(death, FD_DEATH) < 0
        || libc::dup2(ready, FD_READY) < 0
        || libc::dup2(leader, FD_LEADER) < 0
    {
        libc::_exit(127);
    }
    // Everything else (the server's descriptors, notably the profile flock) must not stay
    // alive inside a watcher that lives as long as the browser: nothing execs here, so
    // CLOEXEC does not close them. `close_range` is mandatory; failing arming is fail-closed.
    let closed = libc::syscall(
        libc::SYS_close_range,
        FD_SCRATCH_MIN as c_long,
        c_long::from(u32::MAX),
        0 as c_long,
    );
    let close_errno = if closed < 0 { errno() } else { 0 };

    // Readiness handshake: the pid proves the setup so far; EOF after it proves arming.
    let my_pid = (libc::getpid() as u32).to_ne_bytes();
    if libc::write(FD_READY, my_pid.as_ptr().cast(), 4) != 4 {
        libc::_exit(127);
    }
    if close_errno != 0 {
        fail_arming(close_errno);
    }
    if params.mock_arming_fail {
        fail_arming(libc::ENOENT);
    }

    // Group-object signalling is the only supported mechanism: a kernel (or sandbox) that
    // rejects the flag with EINVAL fails the launch instead of degrading to number-based
    // identification.
    if params.force_group_signal_unsupported {
        fail_arming(libc::EINVAL);
    }
    if let Err(code) = pidfd_signal(FD_LEADER, 0, PIDFD_SIGNAL_PROCESS_GROUP) {
        fail_arming(code);
    }
    // Arming proven: closing the readiness pipe is the success signal.
    libc::close(FD_READY);

    wait_for_supervisor_death();
    teardown()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    /// A launch-like group: leader `sh` (own process group) plus two `sleep` members.
    struct Group {
        leader: Child,
        members: Vec<i32>,
    }

    impl Group {
        fn spawn() -> Self {
            let mut leader = Command::new("sh")
                .args(["-c", "sleep 60 & echo $!; sleep 60 & echo $!; wait"])
                .process_group(0)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .spawn()
                .expect("spawn group leader");
            let mut lines = BufReader::new(leader.stdout.take().unwrap()).lines();
            let members = (0..2)
                .map(|_| lines.next().unwrap().unwrap().trim().parse().unwrap())
                .collect();
            Self { leader, members }
        }

        fn leader_pid(&self) -> i32 {
            self.leader.id() as i32
        }

        fn members_alive(&self) -> bool {
            self.members.iter().all(|pid| !gone(*pid))
        }

        /// Kills and reaps the leader: the group number is now kept reserved only by members.
        fn reap_leader(&mut self) {
            self.leader.kill().unwrap();
            self.leader.wait().unwrap();
        }

        fn wait_members_gone(&self) -> bool {
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if self.members.iter().all(|pid| gone(*pid)) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            false
        }
    }

    impl Drop for Group {
        fn drop(&mut self) {
            for pid in &self.members {
                unsafe { libc::kill(*pid, libc::SIGKILL) };
            }
            let _ = self.leader.kill();
            let _ = self.leader.wait();
        }
    }

    /// Process absent or a zombie (state `Z`/`X` after the last `)` of `/proc/<pid>/stat`).
    fn gone(pid: i32) -> bool {
        let Ok(stat) = std::fs::read(format!("/proc/{pid}/stat")) else {
            return true;
        };
        let close = stat.iter().rposition(|b| *b == b')').unwrap();
        matches!(stat.get(close + 2), Some(b'Z' | b'X'))
    }

    /// `None` on kernels without `PIDFD_SIGNAL_PROCESS_GROUP` (< 6.9).
    fn pidfd_group_supported(pidfd: i32) -> bool {
        pidfd_signal(pidfd, 0, PIDFD_SIGNAL_PROCESS_GROUP) != Err(libc::EINVAL)
    }

    #[test]
    fn group_signal_reaches_members_after_the_leader_was_reaped_and_reports_empty_group() {
        let mut group = Group::spawn();
        let pidfd = open_pidfd(group.leader_pid());
        assert!(pidfd >= 0, "pidfd_open: errno {}", errno());
        if !pidfd_group_supported(pidfd) {
            eprintln!("skipping: kernel lacks PIDFD_SIGNAL_PROCESS_GROUP");
            unsafe { libc::close(pidfd) };
            return;
        }
        group.reap_leader();
        assert!(group.members_alive());

        pidfd_signal(pidfd, libc::SIGKILL, PIDFD_SIGNAL_PROCESS_GROUP)
            .expect("group signal through the pinned leader");
        assert!(group.wait_members_gone(), "members survived the group KILL");
        assert_eq!(
            pidfd_signal(pidfd, libc::SIGKILL, PIDFD_SIGNAL_PROCESS_GROUP),
            Err(libc::ESRCH),
            "an emptied group is reported, never re-resolved by number"
        );
        unsafe { libc::close(pidfd) };
    }

    #[test]
    fn group_signal_never_reaches_another_group() {
        let mut group = Group::spawn();
        let bystander = Group::spawn();
        let pidfd = open_pidfd(group.leader_pid());
        if pidfd < 0 || !pidfd_group_supported(pidfd) {
            eprintln!("skipping: kernel lacks PIDFD_SIGNAL_PROCESS_GROUP");
            return;
        }
        group.reap_leader();
        pidfd_signal(pidfd, libc::SIGKILL, PIDFD_SIGNAL_PROCESS_GROUP).unwrap();
        assert!(group.wait_members_gone());
        std::thread::sleep(Duration::from_millis(100));
        assert!(bystander.members_alive(), "a foreign group was signalled");
        unsafe { libc::close(pidfd) };
    }
}

## Findings

1. **High — reconnect queues clients**  
   `apps/native/src-tauri/src/ssh_forward/manager.rs:1255-1308` stops polling `listener.accept()` while awaiting `reconnect_session()`. The listener remains bound, but the OS backlog accepts fresh loopback clients.  
   **Patch:** pass `&TcpListener` into `reconnect_session`. During backoff, accept-and-drop fresh sockets. During a connect attempt, spawn the connect future into a `JoinHandle`; select between `listener.accept()` (drop socket), stop signal, and `&mut connect_handle`. Dropping the `&mut JoinHandle` poll future does not cancel the spawned connection, so a flood cannot cancel/starve an in-flight reconnect. On stop/final failure, abort **and join** that handle before return.

2. **High — normal worker disposal does not prove full reaping within one deadline**  
   `close_workers()` at `manager.rs:1582-1594` signals and waits workers serially; after timeout it adds a further 100ms per worker. `abort_channel_tasks()` at `1883-1892` can return with `JoinSet` entries still unjoined. `run_profile()` independently uses several 5-second waits (`1284-1287`, `1311-1313`), exceeding a caller’s aggregate shutdown budget.  
   **Patch:** introduce internal `WorkerStop { deadline: Instant }`, replacing `oneshot::Sender<()>`. `close_workers()`:
   - creates one `deadline = now + 5s`;
   - sends it to **all** workers before awaiting any;
   - waits all worker handles against the shared deadline;
   - reserves a small final reaping slice (e.g. 250ms), aborts all pending workers, then joins every aborted handle by the original deadline;
   - removes `abort_handles` only after joins resolve.
   
   `run_profile()` receives the deadline and passes it to one `cleanup_profile_resources()` helper. That helper aborts **and drains** `channel_tasks` until the deadline, then closes the session with remaining time. All early-return paths after listener binding use this helper. No nested fresh 5-second budgets.

3. **Medium — `force_close()` is emergency-only, not proof of disposal**  
   `manager.rs:1153-1172` aborts handles but neither joins workers nor can synchronously close a listener/session owned by those workers. `shutdown.rs` invokes it after a timed-out `dispose()`.  
   **Patch position:** retain it only as `RunEvent::Exit`/post-deadline emergency fallback. Do not claim it meets the graceful 5-second disposal criterion. Rename/document it as best-effort abort if feasible. The coordinator’s normal path must rely on `dispose()` completing its joined cleanup before exit.

## Minimal test additions

In `apps/native/src-tauri/src/ssh_forward/manager.rs` tests:

- `reconnecting_listener_rejects_new_clients_and_keeps_port_bound`
  - Trigger reconnect with an injectable connector/barrier.
  - Connect a new local TCP client during `Reconnecting`.
  - Assert the client is accepted then promptly EOF/reset; listener remains bind-conflicting to a second bind attempt.

- `reconnect_connect_continues_under_rejected_connection_flood`
  - Hold a reconnect attempt at a barrier.
  - Continuously create loopback connections.
  - Release barrier; assert one reconnect completes and no accepted client obtains an SSH channel.
  - This specifically guards against accidental inline `select!` cancellation of the connect future.

- `stop_reaps_worker_channels_and_reconnect_task_by_one_deadline`
  - Use injectable worker/channel/reconnect barriers plus drop/join counters.
  - Start one channel and one reconnect attempt, call Stop, assert all joins/drop counters complete before 5 seconds, runtime map holds no worker, active channel count is zero, and port rejects reconnect.

- `dispose_signals_all_workers_before_waiting`
  - Start multiple blocked workers; assert every worker observes stop before any forced-abort barrier is released.

- `force_close_is_not_graceful_disposal`
  - Static/unit contract test: force-close aborts handles only; graceful reaping evidence belongs exclusively to `dispose`/`close_workers`.

## Residual risks

- Tokio task abort is cooperative. A future that blocks a runtime thread cannot be guaranteed to join by deadline; SSH operations must remain async/cancellation-safe.
- The current Windows `0xc0000139` environment failure still blocks runtime execution of these tests, per Phase 04 plan status.
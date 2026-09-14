use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use dam_hopper_server::linux_release::{
    diagnostics::{
        collector::{Clock, EuidProvider},
        host_commands::{CommandOutput, HostCommand, HostCommandError, HostCommandRunner},
        host_probes::CurrentHostProbeReader,
        local_api::{LocalApiError, LocalIdleStatusClient},
        model::{ActiveInhibitorProbeV1, ProjectedCurrentHostProbes, RtcWakealarmProbeV1},
    },
    layout::Layout,
};

pub struct TestClock(pub u64);
impl Clock for TestClock {
    fn now_ms(&self) -> u64 {
        self.0
    }
}

pub struct TestEuid(pub u32);
impl EuidProvider for TestEuid {
    fn get_euid(&self) -> u32 {
        self.0
    }
}

#[derive(Default, Clone)]
pub struct TestHostCommandRunner {
    pub fail_all: bool,
    pub call_count: Arc<AtomicUsize>,
}

impl HostCommandRunner for TestHostCommandRunner {
    async fn run(&self, command: &HostCommand) -> Result<CommandOutput, HostCommandError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        if self.fail_all {
            return Err(HostCommandError::Execution("mock command failure".to_string()));
        }

        let stdout = match command {
            HostCommand::ShowApiUnit => {
                b"ActiveState=active\nSubState=running\nMainPID=1001\nExecMainStatus=0\nLoadState=loaded\nActiveEnterTimestampUSec=1726243200000000\n".to_vec()
            }
            HostCommand::ShowHelperUnit => {
                b"ActiveState=active\nSubState=running\nMainPID=1002\nExecMainStatus=0\nLoadState=loaded\nActiveEnterTimestampUSec=1726243200000000\n".to_vec()
            }
            HostCommand::JournalApi { .. } => {
                b"{\"__REALTIME_TIMESTAMP\":\"1726243210000000\",\"PRIORITY\":\"6\",\"_BOOT_ID\":\"00000000-0000-4000-8000-000000000001\",\"_SYSTEMD_INVOCATION_ID\":\"inv-1\",\"JOB_RESULT\":\"done\",\"MESSAGE\":\"api service running\"}\n".to_vec()
            }
            HostCommand::JournalHelper { .. } => {
                b"{\"__REALTIME_TIMESTAMP\":\"1726243215000000\",\"PRIORITY\":\"6\",\"_BOOT_ID\":\"00000000-0000-4000-8000-000000000001\",\"_SYSTEMD_INVOCATION_ID\":\"inv-2\",\"JOB_RESULT\":\"done\"}\n".to_vec()
            }
            HostCommand::ListInhibitors => {
                b"WHO UID USER PID COMM WHAT WHY MODE\nfoo 1000 user 10 sleep test delay\n1 inhibitors listed.\n".to_vec()
            }
        };

        Ok(CommandOutput {
            stdout,
            exit_code: Some(0),
            truncated: false,
        })
    }
}

#[derive(Default, Clone)]
pub struct TestIdleStatusClient {
    pub status_code: Option<u16>,
    pub response: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl LocalIdleStatusClient for TestIdleStatusClient {
    async fn fetch_status(
        &self,
        _token_path: &Path,
    ) -> Result<(serde_json::Value, usize), LocalApiError> {
        if let Some(err) = &self.error {
            return Err(LocalApiError::Unavailable(err.clone()));
        }
        if let Some(code) = self.status_code {
            if code == 401 || code == 403 {
                return Err(LocalApiError::AuthRequired(code));
            }
        }
        let val = self.response.clone().unwrap_or_else(|| {
            serde_json::json!({
                "state": "watching",
                "enabled": true,
                "fleetSnapshot": {
                    "generation": 1,
                    "liveCount": 0,
                    "quiescent": true
                }
            })
        });
        let bytes_len = serde_json::to_vec(&val).map(|v| v.len()).unwrap_or(64);
        Ok((val, bytes_len))
    }
}

#[derive(Default, Clone)]
pub struct TestProbeReader;

impl CurrentHostProbeReader for TestProbeReader {
    async fn read_probes(
        &self,
        _layout: &Layout,
        inhibitor_probe: Option<ActiveInhibitorProbeV1>,
    ) -> ProjectedCurrentHostProbes {
        ProjectedCurrentHostProbes {
            rtc_wakealarm: Some(RtcWakealarmProbeV1 {
                supported: true,
                wakealarm_time: Some(1726244000),
                now_time: Some(1726243200),
            }),
            suspend_capabilities: Some(vec!["freeze".to_string(), "mem".to_string()]),
            active_inhibitors: inhibitor_probe,
            qualified_executables: Some(vec!["dam-hopper-api".to_string()]),
        }
    }
}

pub fn setup_test_layout(tmp: &Path, role: &str) -> Layout {
    let layout = Layout::with_root(tmp);
    std::fs::create_dir_all(&layout.etc_dir).unwrap();
    let host_toml = layout.host_config_path();
    std::fs::write(&host_toml, format!("role = \"{role}\"\nallowed_web_origins = []\n")).unwrap();

    std::fs::create_dir_all(layout.server_events_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.server_events_path(), "").unwrap();

    std::fs::create_dir_all(layout.api_audit_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.api_audit_path(), "").unwrap();

    std::fs::create_dir_all(layout.helper_audit_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.helper_audit_path(), "").unwrap();

    std::fs::create_dir_all(layout.backend_diagnostics_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.backend_diagnostics_path(), "").unwrap();

    layout
}

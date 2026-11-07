use crate::config::schema::DamHopperConfig;
use crate::error::AppError;

pub fn validate_protected_config_replacement(
    current: &DamHopperConfig,
    candidate: &DamHopperConfig,
) -> Result<(), AppError> {
    if candidate.server.idle_suspend != current.server.idle_suspend {
        return Err(AppError::InvalidInput(
            "Terminal idle-suspend timing must be configured via PATCH /api/system/idle-suspend/v1/timing and enablement is startup-owned".to_string(),
        ));
    }


    Ok(())
}

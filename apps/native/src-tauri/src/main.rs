// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    #[cfg(windows)]
    {
        if arguments
            .first()
            .is_some_and(|argument| argument == "--ssh-forward-trust-repair")
        {
            if let Err(error) = dam_hopper_native_lib::run_trust_repair(&arguments) {
                eprintln!("{error}");
                std::process::exit(1);
            }
            return;
        }
    }
    dam_hopper_native_lib::run();
}

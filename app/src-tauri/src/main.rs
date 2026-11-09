// Komputer (do testów okna): ta sama aplikacja co na telefonie
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pitayas_app_lib::run()
}

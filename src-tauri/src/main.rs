// Entry point only. All app logic (commands, run(), setup) lives in lib.rs,
// compiled as the `modapp_lib` library crate -- this split is what lets
// mobile targets call modapp_lib::run() from their own platform entry point
// instead of a traditional main().
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    modapp_lib::run();
}
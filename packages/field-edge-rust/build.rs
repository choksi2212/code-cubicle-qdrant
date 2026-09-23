fn main() {
    uniffi::generate_scaffolding("uniffi/field_edge.udl")
        .expect("Failed to generate UniFFI scaffolding for field_edge.udl");
}

pub fn poly_rust(n: i32) -> i32 {
    n + 2
}

pub struct PolyRust {
    pub id: i32,
}

pub fn use_poly_rust(value: PolyRust) -> i32 {
    value.id + poly_rust(1)
}

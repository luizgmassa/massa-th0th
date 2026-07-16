-module(poly_erlang).
-export([poly_erlang/1, use_poly_erlang/0]).
poly_erlang(Value) -> Value.
use_poly_erlang() -> poly_erlang(1).

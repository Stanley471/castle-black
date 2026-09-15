default: build

all: test build

test:
	cargo test

build:
	cargo build --target wasm32-unknown-unknown --release
	@ls -lh target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null || true

build-optimized:
	soroban contract build

fmt:
	cargo fmt --all

clean:
	cargo clean

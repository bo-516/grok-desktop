package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestResolveBridgeImpl_Default ensures empty env + empty config → go.
func TestResolveBridgeImpl_Default(t *testing.T) {
	impl, err := ResolveBridgeImpl("", Config{})
	if err != nil {
		t.Fatal(err)
	}
	if impl != BridgeImplGo {
		t.Fatalf("want go, got %q", impl)
	}
}

// TestResolveBridgeImpl_ConfigFile selects go from config when env unset.
func TestResolveBridgeImpl_ConfigFile(t *testing.T) {
	impl, err := ResolveBridgeImpl("", Config{BridgeImpl: BridgeImplGo})
	if err != nil {
		t.Fatal(err)
	}
	if impl != BridgeImplGo {
		t.Fatalf("want go, got %q", impl)
	}
}

// TestResolveBridgeImpl_EnvWins over config file value.
func TestResolveBridgeImpl_EnvWins(t *testing.T) {
	impl, err := ResolveBridgeImpl("node", Config{BridgeImpl: BridgeImplGo})
	if err != nil {
		t.Fatal(err)
	}
	if impl != BridgeImplNode {
		t.Fatalf("env should win: want node, got %q", impl)
	}
	impl, err = ResolveBridgeImpl("go", Config{BridgeImpl: BridgeImplNode})
	if err != nil {
		t.Fatal(err)
	}
	if impl != BridgeImplGo {
		t.Fatalf("env should win: want go, got %q", impl)
	}
}

// TestResolveBridgeImpl_Invalid rejects illegal values.
func TestResolveBridgeImpl_Invalid(t *testing.T) {
	if _, err := ResolveBridgeImpl("python", Config{}); err == nil {
		t.Fatal("expected error for invalid env")
	}
	if _, err := ResolveBridgeImpl("", Config{BridgeImpl: "rust"}); err == nil {
		t.Fatal("expected error for invalid config")
	}
}

// TestParseBridgeImpl_EmptyIsGo keeps the product default on blank input.
func TestParseBridgeImpl_EmptyIsGo(t *testing.T) {
	impl, err := ParseBridgeImpl("")
	if err != nil {
		t.Fatal(err)
	}
	if impl != BridgeImplGo {
		t.Fatalf("want go, got %q", impl)
	}
}

// TestParseBridgeImpl_Normalize trims and lowercases.
func TestParseBridgeImpl_Normalize(t *testing.T) {
	impl, err := ParseBridgeImpl("  Go ")
	if err != nil {
		t.Fatal(err)
	}
	if impl != BridgeImplGo {
		t.Fatalf("want go, got %q", impl)
	}
}

// TestLoadConfigFile_NestedAndFlat accepts both JSON shapes.
func TestLoadConfigFile_NestedAndFlat(t *testing.T) {
	dir := t.TempDir()

	flat := filepath.Join(dir, "flat.json")
	if err := os.WriteFile(flat, []byte(`{"bridge.impl":"go"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfigFile(flat)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BridgeImpl != BridgeImplGo {
		t.Fatalf("flat: want go, got %q", cfg.BridgeImpl)
	}

	nested := filepath.Join(dir, "nested.json")
	if err := os.WriteFile(nested, []byte(`{"bridge":{"impl":"node"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err = LoadConfigFile(nested)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BridgeImpl != BridgeImplNode {
		t.Fatalf("nested: want node, got %q", cfg.BridgeImpl)
	}
}

// TestLoadConfigFile_Missing returns defaults.
func TestLoadConfigFile_Missing(t *testing.T) {
	cfg, err := LoadConfigFile(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BridgeImpl != BridgeImplGo {
		t.Fatalf("want default go, got %q", cfg.BridgeImpl)
	}
}

// TestConfigFilePath_Home uses provided home for deterministic path.
func TestConfigFilePath_Home(t *testing.T) {
	path, err := ConfigFilePath("/tmp/fakehome")
	if err != nil {
		t.Fatal(err)
	}
	if path == "" {
		t.Fatal("empty path")
	}
	if filepath.Base(path) != "config.json" {
		t.Fatalf("want config.json base, got %s", path)
	}
}

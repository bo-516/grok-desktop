package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// BridgeImpl selects which bridge binary/script the shell spawns.
// Cold-switch only: change config (or GROK_DESKTOP_BRIDGE) and restart.
type BridgeImpl string

const (
	// BridgeImplNode runs apps/bridge via node/tsx (oracle / fallback).
	BridgeImplNode BridgeImpl = "node"
	// BridgeImplGo runs apps/bridge-go. Product default when env/config omit impl.
	BridgeImplGo BridgeImpl = "go"
)

// Config is the thin shell user configuration.
// Only bridge selection is required for cold-switch; more fields may land later.
type Config struct {
	// BridgeImpl is "node" or "go". Env GROK_DESKTOP_BRIDGE overrides file.
	BridgeImpl BridgeImpl `json:"bridge.impl"`
}

// DefaultConfig returns the product default (Go bridge).
func DefaultConfig() Config {
	return Config{BridgeImpl: BridgeImplGo}
}

// ParseBridgeImpl normalizes a raw string to BridgeImpl.
// Empty string is the product default (Go). Non-empty values that are not
// "node" or "go" return an error so a typo cannot silently pick Node.
func ParseBridgeImpl(raw string) (BridgeImpl, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case "", string(BridgeImplGo):
		return BridgeImplGo, nil
	case string(BridgeImplNode):
		return BridgeImplNode, nil
	default:
		return "", fmt.Errorf("invalid bridge.impl %q (want node|go)", raw)
	}
}

// ResolveBridgeImpl applies env override then config file then default (Go).
// Env GROK_DESKTOP_BRIDGE always wins when set and non-empty.
// cfg is the value loaded from the user config file (may be zero).
// Empty cfg.BridgeImpl selects Go — Node is never implied.
// Returns the selected impl or an error if env/config value is illegal.
func ResolveBridgeImpl(envValue string, cfg Config) (BridgeImpl, error) {
	if strings.TrimSpace(envValue) != "" {
		return ParseBridgeImpl(envValue)
	}
	if cfg.BridgeImpl == "" {
		return BridgeImplGo, nil
	}
	return ParseBridgeImpl(string(cfg.BridgeImpl))
}

// ConfigFilePath returns the platform user config path for grok-desktop.
// macOS: ~/Library/Application Support/grok-desktop/config.json
// Linux: $XDG_CONFIG_HOME/grok-desktop/config.json or ~/.config/...
// Windows: %AppData%/grok-desktop/config.json
// homeDir empty uses os.UserHomeDir; used for tests.
func ConfigFilePath(homeDir string) (string, error) {
	if homeDir == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		homeDir = h
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(homeDir, "Library", "Application Support", "grok-desktop", "config.json"), nil
	case "windows":
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(homeDir, "AppData", "Roaming")
		}
		return filepath.Join(base, "grok-desktop", "config.json"), nil
	default:
		base := os.Getenv("XDG_CONFIG_HOME")
		if base == "" {
			base = filepath.Join(homeDir, ".config")
		}
		return filepath.Join(base, "grok-desktop", "config.json"), nil
	}
}

// LoadConfigFile reads config from path. Missing file → DefaultConfig, nil error.
// Malformed JSON or invalid bridge.impl returns an error.
func LoadConfigFile(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultConfig(), nil
		}
		return Config{}, err
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return Config{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	cfg := DefaultConfig()
	// Accept both nested {"bridge":{"impl":"go"}} and flat {"bridge.impl":"go"}.
	if v, ok := raw["bridge.impl"]; ok {
		s, _ := v.(string)
		impl, err := ParseBridgeImpl(s)
		if err != nil {
			return Config{}, err
		}
		cfg.BridgeImpl = impl
	}
	if bridge, ok := raw["bridge"].(map[string]any); ok {
		if v, ok := bridge["impl"]; ok {
			s, _ := v.(string)
			impl, err := ParseBridgeImpl(s)
			if err != nil {
				return Config{}, err
			}
			cfg.BridgeImpl = impl
		}
	}
	return cfg, nil
}

// LoadConfig loads user config then applies GROK_DESKTOP_BRIDGE env override.
// Returns selected bridge impl and the merged Config snapshot.
func LoadConfig() (BridgeImpl, Config, error) {
	path, err := ConfigFilePath("")
	if err != nil {
		return "", Config{}, err
	}
	cfg, err := LoadConfigFile(path)
	if err != nil {
		return "", Config{}, err
	}
	impl, err := ResolveBridgeImpl(os.Getenv("GROK_DESKTOP_BRIDGE"), cfg)
	if err != nil {
		return "", Config{}, err
	}
	cfg.BridgeImpl = impl
	return impl, cfg, nil
}

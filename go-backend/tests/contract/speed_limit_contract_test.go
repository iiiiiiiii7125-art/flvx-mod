package contract_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"go-backend/internal/auth"
	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
)

func TestSpeedLimitWithoutTunnelContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, _ := setupContractRouter(t, secret)

	adminToken, err := auth.GenerateToken(1, "admin_user", 0, secret)
	if err != nil {
		t.Fatalf("generate admin token: %v", err)
	}

	t.Run("create speed limit", func(t *testing.T) {
		body := `{"name":"test-limit-no-tunnel","speed":100,"status":1}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/speed-limit/create", bytes.NewBufferString(body))
		req.Header.Set("Authorization", adminToken)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)

		assertCode(t, res, 0)
	})

	t.Run("list does not expose tunnel binding fields", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/speed-limit/list", nil)
		req.Header.Set("Authorization", adminToken)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)

		var out response.R
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if out.Code != 0 {
			t.Fatalf("expected code 0, got %d", out.Code)
		}

		data, ok := out.Data.([]interface{})
		if !ok {
			t.Fatalf("expected data to be array, got %T", out.Data)
		}

		for _, item := range data {
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if m["name"] != "test-limit-no-tunnel" {
				continue
			}
			if tunnelID, exists := m["tunnelId"]; exists && tunnelID != nil {
				t.Fatalf("expected tunnelId to be absent or nil, got %v", tunnelID)
			}
			if tunnelName, exists := m["tunnelName"]; exists && tunnelName != nil && tunnelName != "" {
				t.Fatalf("expected tunnelName to be absent or empty, got %v", tunnelName)
			}
			return
		}

		t.Fatal("speed limit 'test-limit-no-tunnel' not found in list")
	})
}

func TestSpeedLimitCreateIgnoresTunnelBindingContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, r := setupContractRouter(t, secret)

	adminToken, err := auth.GenerateToken(1, "admin_user", 0, secret)
	if err != nil {
		t.Fatalf("generate admin token: %v", err)
	}

	tunnelID := mustCreateSpeedLimitTunnel(t, r, "test-speed-limit-create-ignore-tunnel")

	body := `{"name":"test-limit-ignore-tunnel","speed":200,"tunnelId":` + jsonInt(tunnelID) + `,"status":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/speed-limit/create", bytes.NewBufferString(body))
	req.Header.Set("Authorization", adminToken)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	assertCode(t, res, 0)

	req = httptest.NewRequest(http.MethodPost, "/api/v1/speed-limit/list", nil)
	req.Header.Set("Authorization", adminToken)
	res = httptest.NewRecorder()
	router.ServeHTTP(res, req)

	var out response.R
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected code 0, got %d", out.Code)
	}

	data, ok := out.Data.([]interface{})
	if !ok {
		t.Fatalf("expected data to be array, got %T", out.Data)
	}

	for _, item := range data {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if m["name"] != "test-limit-ignore-tunnel" {
			continue
		}
		if tunnelIDVal, exists := m["tunnelId"]; exists && tunnelIDVal != nil {
			t.Fatalf("expected tunnelId ignored and nil, got %v", tunnelIDVal)
		}
		if tunnelNameVal, exists := m["tunnelName"]; exists && tunnelNameVal != nil && tunnelNameVal != "" {
			t.Fatalf("expected tunnelName ignored and empty, got %v", tunnelNameVal)
		}
		return
	}

	t.Fatal("speed limit 'test-limit-ignore-tunnel' not found in list")
}

func TestSpeedLimitUpdateIgnoresTunnelBindingContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, r := setupContractRouter(t, secret)

	adminToken, err := auth.GenerateToken(1, "admin_user", 0, secret)
	if err != nil {
		t.Fatalf("generate admin token: %v", err)
	}

	tunnelID := mustCreateSpeedLimitTunnel(t, r, "test-speed-limit-update-ignore-tunnel")
	speedLimitID := mustCreateSpeedLimitRepo(t, r, "test-limit-update-ignore-tunnel")

	body := `{"id":` + jsonInt(speedLimitID) + `,"name":"test-limit-update-ignore-tunnel","speed":256,"tunnelId":` + jsonInt(tunnelID) + `,"status":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/speed-limit/update", bytes.NewBufferString(body))
	req.Header.Set("Authorization", adminToken)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	assertCode(t, res, 0)

	req = httptest.NewRequest(http.MethodPost, "/api/v1/speed-limit/list", nil)
	req.Header.Set("Authorization", adminToken)
	res = httptest.NewRecorder()
	router.ServeHTTP(res, req)

	var out response.R
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected code 0, got %d", out.Code)
	}

	data, ok := out.Data.([]interface{})
	if !ok {
		t.Fatalf("expected data to be array, got %T", out.Data)
	}

	for _, item := range data {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if m["name"] != "test-limit-update-ignore-tunnel" {
			continue
		}
		if tunnelIDVal, exists := m["tunnelId"]; exists && tunnelIDVal != nil {
			t.Fatalf("expected tunnelId ignored and nil after update, got %v", tunnelIDVal)
		}
		if speedVal, ok := m["speed"].(float64); !ok || int(speedVal) != 256 {
			t.Fatalf("expected speed 256 after update, got %v", m["speed"])
		}
		return
	}

	t.Fatal("speed limit 'test-limit-update-ignore-tunnel' not found in list")
}

func TestSpeedLimitDatabaseNullableFields(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "speed-limit-null.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	id, err := r.CreateSpeedLimit("db-test-limit", 100, 1, 1)
	if err != nil {
		t.Fatalf("CreateSpeedLimit failed: %v", err)
	}
	if id <= 0 {
		t.Fatalf("expected valid id, got %d", id)
	}

	var tunnelID sql.NullInt64
	var tunnelName sql.NullString
	err = r.DB().Raw("SELECT tunnel_id, tunnel_name FROM speed_limit WHERE id = ?", id).Row().Scan(&tunnelID, &tunnelName)
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if tunnelID.Valid {
		t.Fatalf("expected TunnelID to be NULL, got %d", tunnelID.Int64)
	}
	if tunnelName.Valid && tunnelName.String != "" {
		t.Fatalf("expected TunnelName to be NULL or empty, got %s", tunnelName.String)
	}
}

func TestSpeedLimitUpdateClearsHistoricalBinding(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "speed-limit-update-clear.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	tunnelID := mustCreateSpeedLimitTunnel(t, r, "speed-limit-update-clear-tunnel")
	now := time.Now().UnixMilli()
	if err := r.DB().Exec(`
		INSERT INTO speed_limit(name, speed, tunnel_id, tunnel_name, created_time, updated_time, status)
		VALUES(?, ?, ?, ?, ?, ?, ?)
	`, "speed-limit-update-clear", 300, tunnelID, "speed-limit-update-clear-tunnel", now, now, 1).Error; err != nil {
		t.Fatalf("insert speed limit with tunnel binding: %v", err)
	}
	speedLimitID := mustLastInsertID(t, r, "speed-limit-update-clear")

	err = r.UpdateSpeedLimit(speedLimitID, "speed-limit-update-clear", 512, 1, time.Now().UnixMilli())
	if err != nil {
		t.Fatalf("UpdateSpeedLimit failed: %v", err)
	}

	var dbTunnelID sql.NullInt64
	var dbTunnelName sql.NullString
	err = r.DB().Raw("SELECT tunnel_id, tunnel_name FROM speed_limit WHERE id = ?", speedLimitID).Row().Scan(&dbTunnelID, &dbTunnelName)
	if err != nil {
		t.Fatalf("query updated speed limit failed: %v", err)
	}
	if dbTunnelID.Valid {
		t.Fatalf("expected tunnel_id cleared after update, got %d", dbTunnelID.Int64)
	}
	if dbTunnelName.Valid && dbTunnelName.String != "" {
		t.Fatalf("expected tunnel_name cleared after update, got %q", dbTunnelName.String)
	}
}

func TestSpeedLimitGetSpeed(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "speed-limit-getspeed.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	speedLimitID, err := r.CreateSpeedLimit("get-speed-test", 500, 1, 1)
	if err != nil {
		t.Fatalf("create speed limit: %v", err)
	}

	t.Run("GetSpeedLimitSpeed returns correct speed", func(t *testing.T) {
		speed, err := r.GetSpeedLimitSpeed(speedLimitID)
		if err != nil {
			t.Fatalf("GetSpeedLimitSpeed failed: %v", err)
		}
		if speed != 500 {
			t.Fatalf("expected speed 500, got %d", speed)
		}
	})

	t.Run("GetSpeedLimitSpeed returns error for non-existent id", func(t *testing.T) {
		_, err := r.GetSpeedLimitSpeed(99999)
		if err == nil {
			t.Fatal("expected error for non-existent speed limit ID")
		}
	})
}

func mustCreateSpeedLimitTunnel(t *testing.T, r *repo.Repository, name string) int64 {
	t.Helper()
	now := time.Now().UnixMilli()
	if err := r.DB().Exec(`
		INSERT INTO tunnel(name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(?, 1.0, 1, 'tls', 99999, ?, ?, 1, NULL, 0)
	`, name, now, now).Error; err != nil {
		t.Fatalf("create tunnel failed: %v", err)
	}
	return mustLastInsertID(t, r, name)
}

func mustCreateSpeedLimitRepo(t *testing.T, r *repo.Repository, name string) int64 {
	t.Helper()
	now := time.Now().UnixMilli()
	id, err := r.CreateSpeedLimit(name, 100, now, 1)
	if err != nil {
		t.Fatalf("create speed limit failed: %v", err)
	}
	return id
}

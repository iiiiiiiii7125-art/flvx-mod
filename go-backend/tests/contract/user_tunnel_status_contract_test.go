package contract_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go-backend/internal/auth"
	"go-backend/internal/http/response"
)

func TestUserTunnelListReturnsStoredStatusContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, repo := setupContractRouter(t, secret)
	now := time.Now().UnixMilli()

	adminToken, err := auth.GenerateToken(1, "admin_user", 0, secret)
	if err != nil {
		t.Fatalf("generate admin token: %v", err)
	}

	if err := repo.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status)
		VALUES(201, 'user_tunnel_status_user', 'pwd', 1, 2727251700000, 99999, 0, 0, 1, 99999, ?, ?, 1)
	`, now, now).Error; err != nil {
		t.Fatalf("insert user: %v", err)
	}

	if err := repo.DB().Exec(`
		INSERT INTO tunnel(id, name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(301, 'user-tunnel-status-enabled', 1.0, 1, 'tls', 1, ?, ?, 1, NULL, 0)
	`, now, now).Error; err != nil {
		t.Fatalf("insert tunnel enabled: %v", err)
	}
	if err := repo.DB().Exec(`
		INSERT INTO tunnel(id, name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(302, 'user-tunnel-status-disabled', 1.0, 1, 'tls', 1, ?, ?, 1, NULL, 1)
	`, now, now).Error; err != nil {
		t.Fatalf("insert tunnel disabled: %v", err)
	}

	if err := repo.DB().Exec(`
		INSERT INTO user_tunnel(id, user_id, tunnel_id, speed_id, num, flow, in_flow, out_flow, flow_reset_time, exp_time, status)
		VALUES(401, 201, 301, NULL, 10, 500, 0, 0, 1, 2727251700000, 1)
	`).Error; err != nil {
		t.Fatalf("insert enabled user_tunnel: %v", err)
	}
	if err := repo.DB().Exec(`
		INSERT INTO user_tunnel(id, user_id, tunnel_id, speed_id, num, flow, in_flow, out_flow, flow_reset_time, exp_time, status)
		VALUES(402, 201, 302, NULL, 10, 500, 0, 0, 1, 2727251700000, 0)
	`).Error; err != nil {
		t.Fatalf("insert disabled user_tunnel: %v", err)
	}

	body := bytes.NewBufferString(`{"userId":201}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tunnel/user/list", body)
	req.Header.Set("Authorization", adminToken)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	router.ServeHTTP(res, req)

	var out response.R
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected code 0, got %d (%s)", out.Code, out.Msg)
	}

	items, ok := out.Data.([]interface{})
	if !ok {
		t.Fatalf("expected array data, got %T", out.Data)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}

	statusByTunnelID := make(map[int64]int, len(items))
	for _, item := range items {
		obj, ok := item.(map[string]interface{})
		if !ok {
			t.Fatalf("expected object item, got %T", item)
		}
		tunnelID, ok := obj["tunnelId"].(float64)
		if !ok {
			t.Fatalf("expected tunnelId to be float64, got %T", obj["tunnelId"])
		}
		status, ok := obj["status"].(float64)
		if !ok {
			t.Fatalf("expected status to be float64, got %T", obj["status"])
		}
		statusByTunnelID[int64(tunnelID)] = int(status)
	}

	if statusByTunnelID[301] != 1 {
		t.Fatalf("expected enabled tunnel status 1, got %d", statusByTunnelID[301])
	}
	if statusByTunnelID[302] != 0 {
		t.Fatalf("expected disabled tunnel status 0, got %d", statusByTunnelID[302])
	}
}

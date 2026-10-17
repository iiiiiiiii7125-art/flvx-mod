package contract_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"

	"go-backend/internal/auth"
	"go-backend/internal/http/response"
)

func TestPerIPSpeedLimitRuntimePayload(t *testing.T) {
	secret := "contract-jwt-secret"
	router, r := setupContractRouter(t, secret)
	server := httptest.NewServer(router)
	defer server.Close()

	adminToken, err := auth.GenerateToken(1, "admin_user", 0, secret)
	if err != nil {
		t.Fatalf("generate admin token: %v", err)
	}

	now := time.Now().UnixMilli()
	if err := r.DB().Exec(`
		INSERT INTO tunnel(name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, "per-ip-speed-tunnel", 1.0, 1, "tls", 99999, now, now, 1, nil, 0).Error; err != nil {
		t.Fatalf("insert tunnel: %v", err)
	}
	var tunnelID int64
	if err := r.DB().Raw("SELECT id FROM tunnel WHERE name = ?", "per-ip-speed-tunnel").Scan(&tunnelID).Error; err != nil {
		t.Fatalf("get tunnel ID: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO node(name, secret, server_ip, server_ip_v4, server_ip_v6, port, interface_name, version, http, tls, socks, created_time, updated_time, status, tcp_listen_addr, udp_listen_addr, inx)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, "per-ip-speed-node", "per-ip-speed-secret", "10.22.0.1", "10.22.0.1", "", "32200-32210", "", "v1", 1, 1, 1, now, now, 1, "[::]", "[::]", 0).Error; err != nil {
		t.Fatalf("insert node: %v", err)
	}
	var nodeID int64
	if err := r.DB().Raw("SELECT id FROM node WHERE name = ?", "per-ip-speed-node").Scan(&nodeID).Error; err != nil {
		t.Fatalf("get node ID: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO chain_tunnel(tunnel_id, chain_type, node_id, port, strategy, inx, protocol)
		VALUES(?, 1, ?, 32201, 'round', 1, 'tls')
	`, tunnelID, nodeID).Error; err != nil {
		t.Fatalf("insert chain_tunnel: %v", err)
	}
	if err := r.DB().Exec(`
		INSERT INTO user_tunnel(user_id, tunnel_id, num, flow, in_flow, out_flow, flow_reset_time, exp_time, status)
		VALUES(1, ?, 10, 99999, 0, 0, 1, ?, 1)
	`, tunnelID, now+365*24*3600*1000).Error; err != nil {
		t.Fatalf("insert user_tunnel: %v", err)
	}

	totalSpeedID, err := r.CreateSpeedLimit("per-ip-total-speed", 80, now, 1)
	if err != nil {
		t.Fatalf("create total speed limit: %v", err)
	}
	ipSpeedID, err := r.CreateSpeedLimit("per-ip-client-speed", 40, now, 1)
	if err != nil {
		t.Fatalf("create per-ip speed limit: %v", err)
	}

	var commandMu sync.Mutex
	receivedCommands := make([]string, 0)
	addLimitersData := make([]json.RawMessage, 0)
	var updateServiceData json.RawMessage

	stopNode := startMockSessionForMaxConn(t, server.URL, "per-ip-speed-secret", func(cmdType string, data json.RawMessage) (bool, string) {
		commandMu.Lock()
		defer commandMu.Unlock()
		receivedCommands = append(receivedCommands, cmdType)
		if cmdType == "AddLimiters" {
			addLimitersData = append(addLimitersData, append([]byte(nil), data...))
		}
		if cmdType == "UpdateService" {
			updateServiceData = append([]byte(nil), data...)
		}
		return false, ""
	})
	defer stopNode()

	waitNodeStatus(t, r, nodeID, 1)

	payload := map[string]interface{}{
		"name":       "per-ip-speed-forward",
		"tunnelId":   tunnelID,
		"remoteAddr": "1.1.1.1:443",
		"strategy":   "fifo",
		"speedId":    totalSpeedID,
		"ipSpeedId":  ipSpeedID,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forward/create", bytes.NewReader(body))
	req.Header.Set("Authorization", adminToken)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	var out response.R
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected create success, got code=%d msg=%s", out.Code, out.Msg)
	}

	var forwardID int64
	if err := r.DB().Raw("SELECT id FROM forward WHERE name = ?", "per-ip-speed-forward").Scan(&forwardID).Error; err != nil {
		t.Fatalf("get forward ID: %v", err)
	}
	expectedName := fmt.Sprintf("rule_traffic_limit_%d", forwardID)
	expectedTotalName := fmt.Sprint(totalSpeedID)
	expectedRuleLimits := []string{"0.0.0.0/0 5.0MB 5.0MB", "::/0 5.0MB 5.0MB"}
	expectedTotalLimits := []string{"$ 10.0MB 10.0MB"}

	commandMu.Lock()
	defer commandMu.Unlock()
	if len(addLimitersData) != 2 {
		t.Fatalf("expected AddLimiters to be sent. Received: %v", receivedCommands)
	}
	if updateServiceData == nil {
		t.Fatalf("expected UpdateService to be sent. Received: %v", receivedCommands)
	}

	gotLimiterLimits := make(map[string][]string)
	for _, raw := range addLimitersData {
		var addData map[string]interface{}
		if err := json.Unmarshal(raw, &addData); err != nil {
			t.Fatalf("unmarshal AddLimiters data: %v", err)
		}
		name := fmt.Sprint(addData["name"])
		limits, ok := addData["limits"].([]interface{})
		if !ok {
			t.Fatalf("expected limits array, got %T", addData["limits"])
		}
		gotLimits := make([]string, 0, len(limits))
		for _, limit := range limits {
			gotLimits = append(gotLimits, fmt.Sprint(limit))
		}
		gotLimiterLimits[name] = gotLimits
	}
	if !reflect.DeepEqual(gotLimiterLimits[expectedTotalName], expectedTotalLimits) {
		t.Fatalf("expected total limits %v, got %v", expectedTotalLimits, gotLimiterLimits[expectedTotalName])
	}
	if !reflect.DeepEqual(gotLimiterLimits[expectedName], expectedRuleLimits) {
		t.Fatalf("expected rule limits %v, got %v", expectedRuleLimits, gotLimiterLimits[expectedName])
	}

	var services []map[string]interface{}
	if err := json.Unmarshal(updateServiceData, &services); err != nil {
		t.Fatalf("unmarshal UpdateService data: %v", err)
	}
	if len(services) == 0 {
		t.Fatalf("expected services in UpdateService")
	}
	for _, service := range services {
		expectedLimiter := expectedTotalName + "," + expectedName
		if service["limiter"] != expectedLimiter {
			t.Fatalf("expected service limiter %s, got %v", expectedLimiter, service["limiter"])
		}
	}
}

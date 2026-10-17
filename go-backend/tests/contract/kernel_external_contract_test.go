package contract_test

import (
	"encoding/base64"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-backend/internal/auth"
)

func TestExternalInboundImportContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, r := setupContractRouter(t, secret)
	admin, _ := auth.GenerateToken(1, "admin_user", 0, secret)
	relayNode := seedKernelNode(t, r, "relay")

	good := "ss://" + base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secret")) + "@198.51.100.20:8388#%E8%90%BD%E5%9C%B0"
	links := good + `\nvmess://abc\n\n`
	out := kernelContractPost(t, router, admin, "/api/v1/inbound/import", `{"links":"`+links+`"}`)
	if out.Code != 0 {
		t.Fatalf("import: %+v", out)
	}
	data := out.Data.(map[string]interface{})
	if len(data["created"].([]interface{})) != 1 || len(data["errors"].([]interface{})) != 1 ||
		!strings.Contains(data["errors"].([]interface{})[0].(string), "第 2 行") {
		t.Fatalf("one link imported, one rejected with its line: %v", data)
	}
	id := int64(data["created"].([]interface{})[0].(float64))

	dup := kernelContractPost(t, router, admin, "/api/v1/inbound/import", `{"links":"`+good+`"}`)
	if dup.Code == 0 || !strings.Contains(dup.Msg, "已经导入过") {
		t.Fatalf("re-importing the same address must be skipped: %+v", dup)
	}

	list := kernelContractPost(t, router, admin, "/api/v1/inbound/list", `{}`)
	item := list.Data.([]interface{})[0].(map[string]interface{})
	if item["external"] != true || item["name"] != "落地" || item["listen"] != "198.51.100.20" || valueAsInt(item["port"]) != 8388 {
		t.Fatalf("list item: %v", item)
	}

	share := kernelContractPost(t, router, admin, "/api/v1/inbound/share", `{"id":`+jsonInt64(id)+`}`)
	entry := share.Data.([]interface{})[0].(map[string]interface{})
	if !strings.HasPrefix(entry["uri"].(string), "ss://") || entry["host"] != "198.51.100.20" {
		t.Fatalf("direct share: %v", entry)
	}

	// A port-forward relay points the forward at the imported address.
	_, forwardID := seedRelayForward(t, r, 1, relayNode, 0, 30005, id)
	sub := kernelContractPost(t, router, admin, "/api/v1/inbound/sub/info", `{}`)
	token := sub.Data.(map[string]interface{})["token"].(string)
	res := getSub(t, router, "/api/v1/open_api/sub/"+token+"?format=clash", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "198.51.100.20") || !strings.Contains(res.Body.String(), "30005") {
		t.Fatalf("subscription must carry the direct and relay lines:\n%s", res.Body.String())
	}

	update := func(body string) string {
		return kernelContractPost(t, router, admin, "/api/v1/inbound/external/update", body).Msg
	}
	if msg := update(`{"id":` + jsonInt64(id) + `,"name":"x","host":"127.0.0.1","port":1,"method":"aes-256-gcm","password":"p"}`); !strings.Contains(msg, "本机") {
		t.Fatalf("loopback address must be rejected: %s", msg)
	}
	if msg := update(`{"id":` + jsonInt64(id) + `,"name":"x","host":"198.51.100.20","port":8388,"link":"vmess://bad"}`); !strings.Contains(msg, "vmess") {
		t.Fatalf("a bad replacement link must be rejected: %s", msg)
	}
	// Replacing the parameters with a new link moves the address too.
	newLink := "trojan://p2@198.51.100.21:9000?sni=t.example.com#x"
	if msg := update(`{"id":` + jsonInt64(id) + `,"name":"新落地","host":"198.51.100.20","port":8388,"link":"` + newLink + `","relayOnly":true}`); msg != "操作成功" {
		t.Fatalf("replace: %s", msg)
	}
	item = kernelContractPost(t, router, admin, "/api/v1/inbound/list", `{}`).Data.([]interface{})[0].(map[string]interface{})
	if item["protocol"] != "trojan" || item["importedSummary"] != "Trojan" || item["name"] != "新落地" {
		t.Fatalf("replaced node: %v", item)
	}
	if got := mustQueryString(t, r, `SELECT remote_addr FROM forward WHERE id = ?`, forwardID); got != "198.51.100.21:9000" {
		t.Fatalf("relay forward must follow the new address, got %q", got)
	}
	res = getSub(t, router, "/api/v1/open_api/sub/"+token+"?format=clash", "")
	if strings.Contains(res.Body.String(), "server: 198.51.100.21") {
		t.Fatalf("relay-only node must not have a direct line:\n%s", res.Body.String())
	}

	if out := kernelContractPost(t, router, admin, "/api/v1/inbound/update", `{"id":`+jsonInt64(id)+`,"name":"x","protocol":"shadowsocks","port":1}`); out.Code == 0 {
		t.Fatal("kernel update path must refuse imported nodes")
	}
	if out := kernelContractPost(t, router, admin, "/api/v1/inbound/regenerate", `{"id":`+jsonInt64(id)+`}`); out.Code == 0 {
		t.Fatal("imported nodes have no keys to regenerate")
	}
	if out := kernelContractPost(t, router, admin, "/api/v1/inbound/toggle", `{"id":`+jsonInt64(id)+`,"enabled":false}`); out.Code != 0 || out.Msg != "操作成功" {
		t.Fatalf("toggle: %+v", out)
	}
	if out := kernelContractPost(t, router, admin, "/api/v1/inbound/delete", `{"id":`+jsonInt64(id)+`}`); out.Code != 0 || out.Msg != "操作成功" {
		t.Fatalf("delete: %+v", out)
	}
	if mustQueryInt(t, r, `SELECT COUNT(*) FROM node_inbound_relay`) != 0 {
		t.Fatal("deleting the node must drop its relays")
	}
}

func TestExternalImportFromSubscriptionURLContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, r := setupContractRouter(t, secret)
	admin, _ := auth.GenerateToken(1, "admin_user", 0, secret)
	relayNode := seedKernelNode(t, r, "relay")

	var gotUA string
	sub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotUA = req.UserAgent()
		_, _ = w.Write([]byte("proxies:\n  - {name: A, type: trojan, server: a.example.com, port: 443, password: pw}\n  - {name: B, type: hysteria2, server: 198.51.100.30, port: 443, password: pw, sni: b.example.com}\n"))
	}))
	defer sub.Close()

	out := kernelContractPost(t, router, admin, "/api/v1/inbound/import", `{"links":"`+sub.URL+`/sub","relayOnly":true}`)
	if out.Code != 0 || len(out.Data.(map[string]interface{})["created"].([]interface{})) != 2 {
		t.Fatalf("import from URL: %+v", out)
	}
	if !strings.Contains(gotUA, "clash") {
		t.Fatalf("subscriptions are fetched as Mihomo to get full parameters: %q", gotUA)
	}

	list := kernelContractPost(t, router, admin, "/api/v1/inbound/list", `{}`).Data.([]interface{})
	var trojanID int64
	for _, it := range list {
		m := it.(map[string]interface{})
		if m["relayOnly"] != true {
			t.Fatalf("relay-only must be stored: %v", m)
		}
		if m["name"] == "A" {
			trojanID = int64(m["id"].(float64))
		}
	}
	seedRelayForward(t, r, 1, relayNode, 0, 30009, trojanID)

	token := kernelContractPost(t, router, admin, "/api/v1/inbound/sub/info", `{}`).Data.(map[string]interface{})["token"].(string)
	body := getSub(t, router, "/api/v1/open_api/sub/"+token+"?format=clash", "").Body.String()
	if strings.Contains(body, "server: \"a.example.com\"") || strings.Contains(body, "198.51.100.30") {
		t.Fatalf("relay-only nodes must not have direct lines:\n%s", body)
	}
	if !strings.Contains(body, "30009") || !strings.Contains(body, `sni: "a.example.com"`) {
		t.Fatalf("the relay line must keep the original domain as SNI:\n%s", body)
	}

	ids := make([]string, 0, len(list))
	for _, it := range list {
		ids = append(ids, jsonInt64(int64(it.(map[string]interface{})["id"].(float64))))
	}
	out = kernelContractPost(t, router, admin, "/api/v1/inbound/batch-toggle", `{"ids":[`+strings.Join(ids, ",")+`],"enabled":false}`)
	if out.Code != 0 || valueAsInt(out.Data.(map[string]interface{})["successCount"]) != 2 ||
		mustQueryInt(t, r, `SELECT COUNT(*) FROM node_inbound WHERE enabled = 1`) != 0 {
		t.Fatalf("batch disable: %+v", out)
	}
	out = kernelContractPost(t, router, admin, "/api/v1/inbound/batch-delete", `{"ids":[`+strings.Join(ids, ",")+`,999999]}`)
	res := out.Data.(map[string]interface{})
	if out.Code != 0 || valueAsInt(res["successCount"]) != 2 || valueAsInt(res["failCount"]) != 1 {
		t.Fatalf("batch delete: %+v", out)
	}
	if mustQueryInt(t, r, `SELECT COUNT(*) FROM node_inbound`) != 0 || mustQueryInt(t, r, `SELECT COUNT(*) FROM node_inbound_relay`) != 0 {
		t.Fatal("batch delete must drop the nodes and their relays")
	}
}

func TestExternalProbeContract(t *testing.T) {
	secret := "contract-jwt-secret"
	router, r := setupContractRouter(t, secret)
	admin, _ := auth.GenerateToken(1, "admin_user", 0, secret)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	closed, _ := net.Listen("tcp", "127.0.0.1:0")
	deadPort := closed.Addr().(*net.TCPAddr).Port
	_ = closed.Close()

	userinfo := base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secret"))
	links := "ss://" + userinfo + "@198.51.100.40:1001#up\\n" + "ss://" + userinfo + "@198.51.100.41:1002#down"
	if out := kernelContractPost(t, router, admin, "/api/v1/inbound/import", `{"links":"`+links+`"}`); out.Code != 0 {
		t.Fatalf("import: %+v", out)
	}
	// Import refuses loopback addresses, so point the rows at local ports.
	upPort := ln.Addr().(*net.TCPAddr).Port
	for name, port := range map[string]int{"up": upPort, "down": deadPort} {
		if err := r.DB().Exec(`UPDATE node_inbound SET listen = '127.0.0.1', port = ? WHERE name = ?`, port, name).Error; err != nil {
			t.Fatal(err)
		}
	}

	out := kernelContractPost(t, router, admin, "/api/v1/inbound/probe", `{}`)
	if out.Code != 0 || len(out.Data.(map[string]interface{})) != 2 {
		t.Fatalf("probe: %+v", out)
	}
	byName := map[string]map[string]interface{}{}
	for _, it := range kernelContractPost(t, router, admin, "/api/v1/inbound/list", `{}`).Data.([]interface{}) {
		m := it.(map[string]interface{})
		probe, _ := m["probe"].(map[string]interface{})
		if probe == nil {
			t.Fatalf("imported nodes must carry the probe result: %v", m)
		}
		byName[m["name"].(string)] = probe
	}
	if byName["up"]["ok"] != true || valueAsInt(byName["up"]["latencyMs"]) < 1 {
		t.Fatalf("reachable node: %v", byName["up"])
	}
	if byName["down"]["ok"] == true || byName["down"]["error"] == "" {
		t.Fatalf("closed port: %v", byName["down"])
	}
}

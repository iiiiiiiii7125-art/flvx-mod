package kernel

import (
	"encoding/json"
	"strings"
	"testing"
)

func chainEndpoints() []Endpoint {
	eps := namedEndpoints("美国 落地 01", "美国 落地 02", "香港 中转", "日本 直连")
	// A ShadowTLS landing node: only its shadowtls outbound dials.
	eps[1].Inbound.Security = Security{Type: SecurityShadowTLS, SNI: "www.example.com", ShadowTLSPassword: "stlspassword",
		Fingerprint: "chrome"}
	return eps
}

var chainOpts = SubOptions{ChainLanding: "落地", ChainRelay: "中转|落地"}

func TestSubscriptionChainClash(t *testing.T) {
	clash, _, err := Subscription(FormatClash, chainEndpoints(), chainOpts)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(clash, `dialer-proxy: "中转节点"`) != 2 {
		t.Fatalf("both landing nodes dial through the relay group:\n%s", clash)
	}
	for _, want := range []string{
		"- name: \"落地节点\"\n    type: \"select\"\n    proxies:\n      - \"美国 落地 01\"\n      - \"美国 落地 02\"\n",
		// A landing node never relays for itself, though it matches both.
		"- name: \"中转节点\"\n    type: \"select\"\n    proxies:\n      - \"香港 中转\"\n",
		"- name: \"节点选择\"\n    type: \"select\"\n    proxies:\n      - \"落地节点\"\n      - \"自动选择\"\n",
	} {
		if !strings.Contains(clash, want) {
			t.Fatalf("missing %q:\n%s", want, clash)
		}
	}
}

func TestSubscriptionChainSingboxAndSurge(t *testing.T) {
	sb, _, err := Subscription(FormatSingbox, chainEndpoints(), chainOpts)
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Outbounds []map[string]interface{} `json:"outbounds"`
	}
	if err := json.Unmarshal([]byte(sb), &cfg); err != nil {
		t.Fatal(err)
	}
	tags := map[string]map[string]interface{}{}
	for _, o := range cfg.Outbounds {
		tags[o["tag"].(string)] = o
	}
	if tags["美国 落地 01"]["detour"] != ChainRelayGroup || tags["香港 中转"]["detour"] != nil {
		t.Fatalf("detour: %v / %v", tags["美国 落地 01"], tags["香港 中转"])
	}
	if tags["美国 落地 02"]["detour"] != "美国 落地 02 (shadowtls)" || tags["美国 落地 02 (shadowtls)"]["detour"] != ChainRelayGroup {
		t.Fatalf("shadowtls pair must dial through the relay group from its outer outbound: %v", tags)
	}
	if g := tags[ChainRelayGroup]; g["type"] != "selector" || len(g["outbounds"].([]interface{})) != 1 {
		t.Fatalf("relay group: %v", g)
	}

	surge, _, _ := Subscription(FormatSurge, chainEndpoints(), chainOpts)
	if !strings.Contains(surge, "美国 落地 01 = ss, 203.0.113.1, 8388, encrypt-method=aes-256-gcm, password=pw, udp-relay=true, underlying-proxy=中转节点") ||
		!strings.Contains(surge, "中转节点 = select, 香港 中转") || !strings.Contains(surge, "节点选择 = select, 落地节点, ") {
		t.Fatalf("surge chain:\n%s", surge)
	}
}

func TestSubscriptionChainNeedsBothSides(t *testing.T) {
	for _, opts := range []SubOptions{{ChainLanding: "落地"}, {ChainLanding: "落地", ChainRelay: "不存在"}} {
		clash, _, _ := Subscription(FormatClash, chainEndpoints(), opts)
		if strings.Contains(clash, "dialer-proxy") || strings.Contains(clash, ChainLandingGroup) {
			t.Fatalf("no chain without relay nodes (%+v):\n%s", opts, clash)
		}
	}
	if err := (SubOptions{ChainRelay: "/[/"}).Validate(); err == nil || !strings.Contains(err.Error(), "中转节点") {
		t.Fatalf("bad relay expression: %v", err)
	}
	// Group names are reserved.
	clash, _, _ := Subscription(FormatClash, namedEndpoints(ChainRelayGroup), SubOptions{})
	if !strings.Contains(clash, ChainRelayGroup+" #2") {
		t.Fatalf("name clash with the relay group:\n%s", clash)
	}
}

func TestMarkChainClearsOneSidedMatch(t *testing.T) {
	for _, e := range ApplySubOptions(chainEndpoints(), SubOptions{ChainLanding: "落地", ChainRelay: "不存在"}) {
		if e.ChainRole != "" {
			t.Fatalf("one-sided chain must not tag %q", e.Name)
		}
	}
}

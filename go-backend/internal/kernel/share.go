package kernel

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Endpoint is one address a client can reach an inbound at: the landing node
// itself, or the entry of a relay forward in front of it.
type Endpoint struct {
	Name    string
	Host    string
	Port    int
	Inbound Inbound
	// Direct marks the landing node's own address; only direct endpoints
	// carry the Hysteria2 port-hopping range (relays forward one port).
	Direct bool
	// Proxy is set for imported nodes; it replaces Inbound when rendering.
	Proxy Proxy
	// Original is the name before ApplySubOptions renamed it.
	Original string
	// ChainRole is ChainRoleLanding / ChainRoleRelay when the subscription
	// chains proxies (set by ApplySubOptions).
	ChainRole string
	// RelayID identifies which relay this endpoint belongs to (0 = direct).
	RelayID int64
}

// hopRange is the port-hopping range clients may use for this endpoint.
func (e Endpoint) hopRange() (int, int) {
	if !e.Direct || e.Inbound.Protocol != ProtocolHysteria2 {
		return 0, 0
	}
	return e.Inbound.HopRange()
}

const (
	FormatBase64  = "base64"
	FormatClash   = "clash"
	FormatSingbox = "singbox"
	FormatSurge   = "surge"
)

func (e Endpoint) selfSigned() bool {
	return e.Inbound.Security.Type == SecurityTLS && e.Inbound.Security.CertMode == CertModeSelf
}

func hostPort(host string, port int) string {
	return net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(port))
}

// ShareURI renders the de-facto standard share link (v2rayN / Shadowrocket /
// NekoBox style) for an endpoint.
func ShareURI(e Endpoint) (string, bool) {
	if e.Proxy != nil {
		return proxyURI(e)
	}
	in := e.Inbound
	switch in.Protocol {
	case ProtocolVLESS, ProtocolTrojan:
		q := url.Values{}
		q.Set("type", in.Transport.Type)
		q.Set("security", in.Security.Type)
		if in.Protocol == ProtocolVLESS {
			q.Set("encryption", "none")
			if in.Settings.Flow != "" {
				q.Set("flow", in.Settings.Flow)
			}
		}
		addTransportQuery(q, in.Transport)
		addSecurityQuery(q, e)
		user := in.Settings.UUID
		if in.Protocol == ProtocolTrojan {
			user = url.PathEscape(in.Settings.Password)
		}
		return fmt.Sprintf("%s://%s@%s?%s#%s", in.Protocol, user, hostPort(e.Host, e.Port),
			q.Encode(), url.PathEscape(e.Name)), true
	case ProtocolVMess:
		v := map[string]interface{}{
			"v": "2", "ps": e.Name, "add": strings.Trim(e.Host, "[]"), "port": strconv.Itoa(e.Port),
			"id": in.Settings.UUID, "aid": "0", "scy": "auto", "net": in.Transport.Type,
			"type": "none", "host": in.Transport.Host, "path": in.Transport.Path, "tls": "",
		}
		if in.Transport.Type == TransportGRPC {
			v["path"] = in.Transport.ServiceName
			v["type"] = "gun"
		}
		if in.Security.Type == SecurityTLS {
			v["tls"] = "tls"
			v["sni"] = in.Security.SNI
			v["fp"] = in.Security.Fingerprint
			if len(in.Security.ALPN) > 0 {
				v["alpn"] = strings.Join(in.Security.ALPN, ",")
			}
			if e.selfSigned() {
				v["allowInsecure"] = "1"
			}
		}
		b, _ := json.Marshal(v)
		return "vmess://" + base64.StdEncoding.EncodeToString(b), true
	case ProtocolShadowsocks:
		userinfo := base64.RawURLEncoding.EncodeToString([]byte(in.Settings.Method + ":" + in.Settings.Password))
		if SS2022KeyLen(in.Settings.Method) > 0 {
			// SIP022: 2022 ciphers use percent-encoded plain userinfo.
			userinfo = url.QueryEscape(in.Settings.Method) + ":" + url.QueryEscape(in.Settings.Password)
		}
		query := ""
		if in.Security.Type == SecurityShadowTLS {
			// SIP002 plugin parameter, as understood by Shadowrocket / NekoBox.
			query = "?plugin=" + url.QueryEscape(fmt.Sprintf("shadow-tls;host=%s;password=%s;version=3",
				in.Security.SNI, in.Security.ShadowTLSPassword))
		}
		return fmt.Sprintf("ss://%s@%s%s#%s", userinfo, hostPort(e.Host, e.Port), query, url.PathEscape(e.Name)), true
	case ProtocolHysteria2:
		q := url.Values{}
		q.Set("sni", in.Security.SNI)
		if e.selfSigned() {
			q.Set("insecure", "1")
		}
		if lo, hi := e.hopRange(); lo > 0 {
			q.Set("mport", fmt.Sprintf("%d-%d", lo, hi)) // v2rayN / NekoBox convention
		}
		return fmt.Sprintf("hysteria2://%s@%s/?%s#%s", url.PathEscape(in.Settings.Password), hostPort(e.Host, e.Port),
			q.Encode(), url.PathEscape(e.Name)), true
	case ProtocolTUIC:
		q := url.Values{}
		q.Set("congestion_control", "bbr")
		q.Set("alpn", "h3")
		q.Set("sni", in.Security.SNI)
		q.Set("udp_relay_mode", "native")
		if e.selfSigned() {
			q.Set("allow_insecure", "1")
		}
		return fmt.Sprintf("tuic://%s:%s@%s?%s#%s", in.Settings.UUID, url.PathEscape(in.Settings.Password),
			hostPort(e.Host, e.Port), q.Encode(), url.PathEscape(e.Name)), true
	case ProtocolNaive:
		// naive+https://user:pass@host:port (NekoBox / v2rayN); sni only when
		// connecting by address (e.g. through a relay).
		q := ""
		if strings.Trim(e.Host, "[]") != in.Security.SNI {
			q = "?sni=" + url.QueryEscape(in.Security.SNI)
		}
		return fmt.Sprintf("naive+https://%s:%s@%s%s#%s", url.PathEscape(in.Settings.Username), url.PathEscape(in.Settings.Password),
			hostPort(e.Host, e.Port), q, url.PathEscape(e.Name)), true
	case ProtocolAnyTLS:
		q := url.Values{}
		q.Set("sni", in.Security.SNI)
		if e.selfSigned() {
			q.Set("insecure", "1")
			q.Set("allowInsecure", "1")
		}
		return fmt.Sprintf("anytls://%s@%s/?%s#%s", url.PathEscape(in.Settings.Password), hostPort(e.Host, e.Port),
			q.Encode(), url.PathEscape(e.Name)), true
	}
	// Snell has no standard share link; it is only exported to Surge.
	return "", false
}

func addTransportQuery(q url.Values, t Transport) {
	switch t.Type {
	case TransportWS:
		q.Set("path", t.Path)
		if t.Host != "" {
			q.Set("host", t.Host)
		}
	case TransportXHTTP:
		q.Set("path", t.Path)
		q.Set("mode", t.Mode)
		if t.Host != "" {
			q.Set("host", t.Host)
		}
	case TransportGRPC:
		q.Set("serviceName", t.ServiceName)
		q.Set("mode", "gun")
	}
}

func addSecurityQuery(q url.Values, e Endpoint) {
	sec := e.Inbound.Security
	switch sec.Type {
	case SecurityReality:
		q.Set("sni", sec.SNI)
		q.Set("fp", sec.Fingerprint)
		q.Set("pbk", sec.RealityPublicKey)
		if len(sec.RealityShortIDs) > 0 {
			q.Set("sid", sec.RealityShortIDs[0])
		}
	case SecurityTLS:
		q.Set("sni", sec.SNI)
		q.Set("fp", sec.Fingerprint)
		if len(sec.ALPN) > 0 {
			q.Set("alpn", strings.Join(sec.ALPN, ","))
		}
		if e.selfSigned() {
			q.Set("allowInsecure", "1")
		}
	}
}

// ClashProxy renders a Mihomo (Clash Meta) proxy entry. XHTTP is skipped
// because Mihomo support for it is not stable across client versions.
func ClashProxy(e Endpoint) (yamlNode, bool) {
	if e.Proxy != nil {
		return proxyClash(e)
	}
	in := e.Inbound
	if in.Transport.Type == TransportXHTTP || in.Protocol == ProtocolSnell || in.Protocol == ProtocolNaive {
		// Mihomo only speaks Snell v1-v3 and has no NaïveProxy client.
		return nil, false
	}
	switch in.Protocol {
	case ProtocolHysteria2, ProtocolTUIC, ProtocolAnyTLS:
		return clashQUICFamily(e), true
	}
	p := yamlNode{
		{"name", e.Name},
		{"type", map[string]string{ProtocolShadowsocks: "ss"}[in.Protocol]},
		{"server", strings.Trim(e.Host, "[]")},
		{"port", e.Port},
		{"udp", true},
	}
	if p[1].Value == "" {
		p[1].Value = in.Protocol
	}
	switch in.Protocol {
	case ProtocolVLESS:
		p = append(p, yamlField{"uuid", in.Settings.UUID})
		if in.Settings.Flow != "" {
			p = append(p, yamlField{"flow", in.Settings.Flow})
		}
	case ProtocolVMess:
		p = append(p, yamlField{"uuid", in.Settings.UUID}, yamlField{"alterId", 0}, yamlField{"cipher", "auto"})
	case ProtocolTrojan:
		p = append(p, yamlField{"password", in.Settings.Password})
	case ProtocolShadowsocks:
		p = append(p, yamlField{"cipher", in.Settings.Method}, yamlField{"password", in.Settings.Password})
		if in.Security.Type == SecurityShadowTLS {
			p[4].Value = false // UDP is not carried through ShadowTLS
			p = append(p,
				yamlField{"client-fingerprint", in.Security.Fingerprint},
				yamlField{"plugin", "shadow-tls"},
				yamlField{"plugin-opts", yamlNode{
					{"host", in.Security.SNI},
					{"password", in.Security.ShadowTLSPassword},
					{"version", 3},
				}})
		}
		return p, true
	default:
		return nil, false
	}

	p = append(p, yamlField{"network", in.Transport.Type})
	switch in.Transport.Type {
	case TransportWS:
		ws := yamlNode{{"path", in.Transport.Path}}
		if in.Transport.Host != "" {
			ws = append(ws, yamlField{"headers", yamlNode{{"Host", in.Transport.Host}}})
		}
		p = append(p, yamlField{"ws-opts", ws})
	case TransportGRPC:
		p = append(p, yamlField{"grpc-opts", yamlNode{{"grpc-service-name", in.Transport.ServiceName}}})
	}

	sec := in.Security
	if sec.Type != SecurityNone {
		if in.Protocol != ProtocolTrojan {
			p = append(p, yamlField{"tls", true})
		}
		sniKey := "servername"
		if in.Protocol == ProtocolTrojan {
			sniKey = "sni"
		}
		p = append(p, yamlField{sniKey, sec.SNI}, yamlField{"client-fingerprint", sec.Fingerprint})
		if len(sec.ALPN) > 0 {
			p = append(p, yamlField{"alpn", sec.ALPN})
		}
		if sec.Type == SecurityReality {
			ro := yamlNode{{"public-key", sec.RealityPublicKey}}
			if len(sec.RealityShortIDs) > 0 {
				ro = append(ro, yamlField{"short-id", sec.RealityShortIDs[0]})
			}
			p = append(p, yamlField{"reality-opts", ro})
		}
		if e.selfSigned() {
			p = append(p, yamlField{"skip-cert-verify", true})
		}
	}
	return p, true
}

// SingboxOutbounds renders the sing-box client outbounds (1.11+ schema) for
// an endpoint. The first one carries the endpoint's tag; ShadowTLS adds a
// second outbound the first detours through.
func SingboxOutbounds(e Endpoint) ([]map[string]interface{}, bool) {
	if e.Proxy != nil {
		return proxySingbox(e)
	}
	in := e.Inbound
	if in.Protocol == ProtocolSnell {
		return nil, false
	}
	o, ok := singboxOutbound(e)
	if !ok {
		return nil, false
	}
	if in.Protocol == ProtocolShadowsocks && in.Security.Type == SecurityShadowTLS {
		stlsTag := e.Name + " (shadowtls)"
		o["detour"] = stlsTag
		return []map[string]interface{}{o, {
			"type":        "shadowtls",
			"tag":         stlsTag,
			"server":      strings.Trim(e.Host, "[]"),
			"server_port": e.Port,
			"version":     3,
			"password":    in.Security.ShadowTLSPassword,
			"tls": map[string]interface{}{
				"enabled":     true,
				"server_name": in.Security.SNI,
				"utls":        map[string]interface{}{"enabled": true, "fingerprint": in.Security.Fingerprint},
			},
		}}, true
	}
	return []map[string]interface{}{o}, true
}

func singboxOutbound(e Endpoint) (map[string]interface{}, bool) {
	in := e.Inbound
	if in.Transport.Type == TransportXHTTP {
		return nil, false
	}
	o := map[string]interface{}{
		"tag":         e.Name,
		"server":      strings.Trim(e.Host, "[]"),
		"server_port": e.Port,
	}
	switch in.Protocol {
	case ProtocolVLESS:
		o["type"] = "vless"
		o["uuid"] = in.Settings.UUID
		if in.Settings.Flow != "" {
			o["flow"] = in.Settings.Flow
		}
	case ProtocolVMess:
		o["type"] = "vmess"
		o["uuid"] = in.Settings.UUID
		o["security"] = "auto"
	case ProtocolTrojan:
		o["type"] = "trojan"
		o["password"] = in.Settings.Password
	case ProtocolShadowsocks:
		o["type"] = "shadowsocks"
		o["method"] = in.Settings.Method
		o["password"] = in.Settings.Password
		if in.Security.Type == SecurityShadowTLS {
			// The shadowtls outbound dials the server; this one has no address.
			delete(o, "server")
			delete(o, "server_port")
		}
		return o, true
	case ProtocolHysteria2:
		o["type"] = "hysteria2"
		o["password"] = in.Settings.Password
		if lo, hi := e.hopRange(); lo > 0 {
			// server_ports replaces server_port; every port in it reaches the inbound.
			delete(o, "server_port")
			o["server_ports"] = []string{fmt.Sprintf("%d:%d", lo, hi)}
			o["hop_interval"] = "30s"
		}
	case ProtocolTUIC:
		o["type"] = "tuic"
		o["uuid"] = in.Settings.UUID
		o["password"] = in.Settings.Password
		o["congestion_control"] = "bbr"
		o["udp_relay_mode"] = "native"
	case ProtocolAnyTLS:
		o["type"] = "anytls"
		o["password"] = in.Settings.Password
	case ProtocolNaive:
		// sing-box 1.13+ (builds with the cronet-based naive outbound).
		o["type"] = "naive"
		o["username"] = in.Settings.Username
		o["password"] = in.Settings.Password
	default:
		return nil, false
	}

	switch in.Transport.Type {
	case TransportWS:
		t := map[string]interface{}{"type": "ws", "path": in.Transport.Path}
		if in.Transport.Host != "" {
			t["headers"] = map[string]interface{}{"Host": in.Transport.Host}
		}
		o["transport"] = t
	case TransportGRPC:
		o["transport"] = map[string]interface{}{"type": "grpc", "service_name": in.Transport.ServiceName}
	}

	sec := in.Security
	if sec.Type != SecurityNone {
		tls := map[string]interface{}{
			"enabled":     true,
			"server_name": sec.SNI,
		}
		// uTLS only applies to TCP; sing-box rejects it on QUIC outbounds,
		// and naive uses Chromium's own TLS stack.
		if in.Network() != "udp" && in.Protocol != ProtocolNaive && sec.Fingerprint != "" {
			tls["utls"] = map[string]interface{}{"enabled": true, "fingerprint": sec.Fingerprint}
		}
		if len(sec.ALPN) > 0 {
			tls["alpn"] = sec.ALPN
		}
		if sec.Type == SecurityReality {
			r := map[string]interface{}{"enabled": true, "public_key": sec.RealityPublicKey}
			if len(sec.RealityShortIDs) > 0 {
				r["short_id"] = sec.RealityShortIDs[0]
			}
			tls["reality"] = r
		}
		if e.selfSigned() {
			tls["insecure"] = true
		}
		o["tls"] = tls
	}
	return o, true
}

// SurgeLine renders a Surge [Proxy] line. Surge has no VLESS, Reality,
// gRPC or XHTTP support, so those endpoints are skipped.
func SurgeLine(e Endpoint) (string, bool) {
	if e.Proxy != nil {
		return proxySurge(e)
	}
	in := e.Inbound
	if in.Security.Type == SecurityReality || in.Transport.Type == TransportGRPC || in.Transport.Type == TransportXHTTP {
		return "", false
	}
	name := strings.NewReplacer(",", " ", "=", " ", "\n", " ").Replace(e.Name)
	host := strings.Trim(e.Host, "[]")
	parts := []string{}
	shadowTLS := func() []string {
		if in.Security.Type != SecurityShadowTLS {
			return nil
		}
		return []string{"shadow-tls-password=" + in.Security.ShadowTLSPassword,
			"shadow-tls-sni=" + in.Security.SNI, "shadow-tls-version=3"}
	}
	tlsTail := func() []string {
		t := []string{"sni=" + in.Security.SNI}
		if e.selfSigned() {
			t = append(t, "skip-cert-verify=true")
		}
		return t
	}
	switch in.Protocol {
	case ProtocolShadowsocks:
		parts = append(parts, "ss", host, strconv.Itoa(e.Port),
			"encrypt-method="+in.Settings.Method, "password="+in.Settings.Password)
		if in.Security.Type == SecurityShadowTLS {
			parts = append(parts, shadowTLS()...)
		} else {
			parts = append(parts, "udp-relay=true")
		}
		return name + " = " + strings.Join(parts, ", "), true
	case ProtocolSnell:
		parts = append(parts, "snell", host, strconv.Itoa(e.Port), "psk="+in.Settings.Password,
			fmt.Sprintf("version=%d", in.Settings.SnellVersion), "reuse=true", "tfo=true")
		parts = append(parts, shadowTLS()...)
		return name + " = " + strings.Join(parts, ", "), true
	case ProtocolHysteria2:
		parts = append(parts, "hysteria2", host, strconv.Itoa(e.Port), "password="+in.Settings.Password)
		if lo, hi := e.hopRange(); lo > 0 {
			parts = append(parts, fmt.Sprintf("port-hopping=\"%d-%d\"", lo, hi), "port-hopping-interval=30")
		}
		return name + " = " + strings.Join(append(parts, tlsTail()...), ", "), true
	case ProtocolTUIC:
		parts = append(parts, "tuic-v5", host, strconv.Itoa(e.Port), "password="+in.Settings.Password,
			"uuid="+in.Settings.UUID, "alpn=h3")
		return name + " = " + strings.Join(append(parts, tlsTail()...), ", "), true
	case ProtocolAnyTLS:
		parts = append(parts, "anytls", host, strconv.Itoa(e.Port), "password="+in.Settings.Password)
		return name + " = " + strings.Join(append(parts, tlsTail()...), ", "), true
	case ProtocolVMess:
		parts = append(parts, "vmess", host, strconv.Itoa(e.Port), "username="+in.Settings.UUID, "vmess-aead=true")
	case ProtocolTrojan:
		parts = append(parts, "trojan", host, strconv.Itoa(e.Port), "password="+in.Settings.Password)
	default:
		return "", false
	}
	if in.Transport.Type == TransportWS {
		parts = append(parts, "ws=true", "ws-path="+in.Transport.Path)
		if in.Transport.Host != "" {
			parts = append(parts, "ws-headers=Host:"+in.Transport.Host)
		}
	}
	if in.Security.Type == SecurityTLS {
		if in.Protocol == ProtocolVMess {
			parts = append(parts, "tls=true")
		}
		parts = append(parts, "sni="+in.Security.SNI)
		if e.selfSigned() {
			parts = append(parts, "skip-cert-verify=true")
		}
	}
	return name + " = " + strings.Join(parts, ", "), true
}

// FormatForUserAgent picks a subscription format from the client's UA.
func FormatForUserAgent(ua string) string {
	ua = strings.ToLower(ua)
	switch {
	case strings.Contains(ua, "shadowrocket"):
		return FormatShadowrocket
	case strings.Contains(ua, "loon"):
		return FormatLoon
	case strings.Contains(ua, "quantumult"):
		return FormatQX
	case strings.Contains(ua, "sing-box") || strings.Contains(ua, "singbox") || strings.Contains(ua, "sfa") || strings.Contains(ua, "sfi") || strings.Contains(ua, "sfm"):
		return FormatSingbox
	case strings.Contains(ua, "clash") || strings.Contains(ua, "mihomo") || strings.Contains(ua, "stash") || strings.Contains(ua, "meta"):
		return FormatClash
	case strings.Contains(ua, "surge"):
		return FormatSurge
	}
	return FormatBase64
}

// Subscription renders every supported endpoint in the requested format and
// returns the body with its content type.
func Subscription(format string, endpoints []Endpoint, opts SubOptions) (string, string, error) {
	endpoints = uniqueNames(ApplySubOptions(endpoints, opts))
	groups := opts.RegionGroups
	switch format {
	case FormatBase64:
		lines := make([]string, 0, len(endpoints))
		for _, e := range endpoints {
			if uri, ok := ShareURI(e); ok {
				lines = append(lines, uri)
			}
		}
		return base64.StdEncoding.EncodeToString([]byte(strings.Join(lines, "\n"))), "text/plain; charset=utf-8", nil
	case FormatClash:
		return clashProfile(endpoints, groups), "text/yaml; charset=utf-8", nil
	case FormatShadowrocket:
		return shadowrocketProfile(endpoints), "text/yaml; charset=utf-8", nil
	case FormatLoon:
		return loonList(endpoints), "text/plain; charset=utf-8", nil
	case FormatQX:
		return qxList(endpoints), "text/plain; charset=utf-8", nil
	case FormatSingbox:
		body, err := singboxProfile(endpoints, groups)
		return body, "application/json; charset=utf-8", err
	case FormatSurge:
		lines := []string{"[Proxy]"}
		names := []string{}
		var rendered []Endpoint
		var proxyLines []string
		for _, e := range endpoints {
			if line, ok := SurgeLine(e); ok {
				proxyLines = append(proxyLines, line)
				e.Name = strings.SplitN(line, " = ", 2)[0]
				rendered = append(rendered, e)
				names = append(names, e.Name)
			}
		}
		landing, relay, chain := chainGroups(rendered)
		for i, line := range proxyLines {
			if chain && rendered[i].ChainRole == ChainRoleLanding {
				line += ", underlying-proxy=" + ChainRelayGroup
			}
			lines = append(lines, line)
		}
		lines = append(lines, "", "[Proxy Group]")
		var regionLines []string
		choices := names
		if groups {
			var regionNames []string
			for _, g := range regionGroups(names) {
				regionNames = append(regionNames, g.name)
				regionLines = append(regionLines, g.name+" = url-test, "+strings.Join(g.members, ", ")+
					", url=http://www.gstatic.com/generate_204, interval=300")
			}
			choices = append(regionNames, names...)
		}
		if chain {
			choices = append([]string{ChainLandingGroup}, choices...)
		}
		if len(choices) > 0 {
			lines = append(lines, "节点选择 = select, "+strings.Join(choices, ", "))
		} else {
			lines = append(lines, "节点选择 = select, DIRECT")
		}
		if chain {
			lines = append(lines, ChainLandingGroup+" = select, "+strings.Join(landing, ", "),
				ChainRelayGroup+" = select, "+strings.Join(relay, ", "))
		}
		lines = append(lines, regionLines...)
		lines = append(lines, "", "[Rule]", "GEOIP,LAN,DIRECT", "FINAL,节点选择", "")
		return strings.Join(lines, "\n"), "text/plain; charset=utf-8", nil
	}
	return "", "", fmt.Errorf("不支持的订阅格式 %s", format)
}

func clashProfile(endpoints []Endpoint, withRegions bool) string {
	var rendered []Endpoint
	var nodes []yamlNode
	for _, e := range endpoints {
		if p, ok := ClashProxy(e); ok {
			rendered = append(rendered, e)
			nodes = append(nodes, p)
		}
	}
	landing, relay, chain := chainGroups(rendered)
	proxies := []interface{}{}
	names := []interface{}{}
	var plain []string
	for i, e := range rendered {
		p := nodes[i]
		if chain && e.ChainRole == ChainRoleLanding {
			p = append(p, yamlField{"dialer-proxy", ChainRelayGroup})
		}
		proxies = append(proxies, p)
		names = append(names, e.Name)
		plain = append(plain, e.Name)
	}
	var chainNodes []interface{}
	if chain {
		chainNodes = []interface{}{
			yamlNode{{"name", ChainLandingGroup}, {"type", "select"}, {"proxies", toInterfaces(landing)}},
			yamlNode{{"name", ChainRelayGroup}, {"type", "select"}, {"proxies", toInterfaces(relay)}},
		}
	}
	selectList := append([]interface{}{"自动选择"}, names...)
	autoList := names
	var regionNodes []interface{}
	if withRegions {
		var regionNames []interface{}
		for _, g := range regionGroups(plain) {
			regionNames = append(regionNames, g.name)
			members := make([]interface{}, len(g.members))
			for i, m := range g.members {
				members[i] = m
			}
			regionNodes = append(regionNodes, yamlNode{{"name", g.name}, {"type", "url-test"},
				{"url", "https://www.gstatic.com/generate_204"}, {"interval", 300}, {"proxies", members}})
		}
		selectList = append(append([]interface{}{"自动选择"}, regionNames...), names...)
	}
	if chain {
		selectList = append([]interface{}{ChainLandingGroup}, selectList...)
	}
	if len(names) == 0 {
		selectList = []interface{}{"DIRECT"}
		autoList = []interface{}{"DIRECT"}
	}
	profile := yamlNode{
		{"mixed-port", 7890},
		{"allow-lan", false},
		{"mode", "rule"},
		{"log-level", "warning"},
		{"proxies", proxies},
		{"proxy-groups", append([]interface{}{
			yamlNode{{"name", "节点选择"}, {"type", "select"}, {"proxies", selectList}},
			yamlNode{{"name", "自动选择"}, {"type", "url-test"}, {"url", "https://www.gstatic.com/generate_204"},
				{"interval", 300}, {"proxies", autoList}},
		}, append(chainNodes, regionNodes...)...)},
		{"rules", []interface{}{"GEOIP,LAN,DIRECT,no-resolve", "MATCH,节点选择"}},
	}
	return marshalYAML(profile)
}

func singboxProfile(endpoints []Endpoint, withRegions bool) (string, error) {
	var rendered []Endpoint
	var obsList [][]map[string]interface{}
	for _, e := range endpoints {
		if obs, ok := SingboxOutbounds(e); ok {
			rendered = append(rendered, e)
			obsList = append(obsList, obs)
		}
	}
	landing, relay, chain := chainGroups(rendered)
	outbounds := []interface{}{}
	names := []interface{}{}
	var plain []string
	for i, e := range rendered {
		for _, o := range obsList[i] {
			// The outbound that opens the connection dials through the relay
			// group; a ShadowTLS pair's inner one already detours.
			if _, detour := o["detour"]; chain && e.ChainRole == ChainRoleLanding && !detour {
				o["detour"] = ChainRelayGroup
			}
			outbounds = append(outbounds, o)
		}
		names = append(names, e.Name)
		plain = append(plain, e.Name)
	}
	var chainOutbounds []interface{}
	if chain {
		chainOutbounds = []interface{}{
			map[string]interface{}{"type": "selector", "tag": ChainLandingGroup, "outbounds": landing},
			map[string]interface{}{"type": "selector", "tag": ChainRelayGroup, "outbounds": relay},
		}
	}
	selectList := append([]interface{}{"自动选择"}, names...)
	autoList := names
	var regionOutbounds []interface{}
	if withRegions {
		var regionNames []interface{}
		for _, g := range regionGroups(plain) {
			regionNames = append(regionNames, g.name)
			regionOutbounds = append(regionOutbounds, map[string]interface{}{"type": "urltest", "tag": g.name,
				"outbounds": g.members, "url": "https://www.gstatic.com/generate_204", "interval": "5m"})
		}
		selectList = append(append([]interface{}{"自动选择"}, regionNames...), names...)
	}
	if chain {
		selectList = append([]interface{}{ChainLandingGroup}, selectList...)
	}
	if len(names) == 0 {
		selectList = []interface{}{"direct"}
		autoList = []interface{}{"direct"}
	}
	groups := append([]interface{}{
		map[string]interface{}{"type": "selector", "tag": "节点选择", "outbounds": selectList},
		map[string]interface{}{"type": "urltest", "tag": "自动选择", "outbounds": autoList,
			"url": "https://www.gstatic.com/generate_204", "interval": "5m"},
	}, append(chainOutbounds, regionOutbounds...)...)
	cfg := map[string]interface{}{
		"log": map[string]interface{}{"level": "warn"},
		"inbounds": []interface{}{
			map[string]interface{}{"type": "tun", "tag": "tun-in", "address": []string{"172.19.0.1/30", "fdfe:dcba:9876::1/126"},
				"auto_route": true, "strict_route": true},
			map[string]interface{}{"type": "mixed", "tag": "mixed-in", "listen": "127.0.0.1", "listen_port": 2080},
		},
		"outbounds": append(append(groups, outbounds...), map[string]interface{}{"type": "direct", "tag": "direct"}),
		"route": map[string]interface{}{
			"auto_detect_interface": true,
			"final":                 "节点选择",
			"rules": []interface{}{
				map[string]interface{}{"action": "sniff"},
				map[string]interface{}{"protocol": "dns", "action": "hijack-dns"},
				map[string]interface{}{"ip_is_private": true, "outbound": "direct"},
			},
		},
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b) + "\n", nil
}

// uniqueNames suffixes duplicate endpoint names; Clash proxy names and
// sing-box tags must be unique or the whole profile is rejected.
func uniqueNames(endpoints []Endpoint) []Endpoint {
	out := make([]Endpoint, len(endpoints))
	seen := map[string]bool{"节点选择": true, "自动选择": true, "direct": true, "DIRECT": true, "REJECT": true,
		ChainLandingGroup: true, ChainRelayGroup: true}
	for _, r := range regions {
		seen[r.name] = true
	}
	for i, e := range endpoints {
		base := strings.TrimSpace(e.Name)
		if base == "" {
			base = fmt.Sprintf("node-%d", i+1)
		}
		name := base
		for n := 2; seen[name]; n++ {
			name = fmt.Sprintf("%s #%d", base, n)
		}
		seen[name] = true
		e.Name = name
		out[i] = e
	}
	return out
}

func clashQUICFamily(e Endpoint) yamlNode {
	in := e.Inbound
	p := yamlNode{
		{"name", e.Name},
		{"type", in.Protocol},
		{"server", strings.Trim(e.Host, "[]")},
		{"port", e.Port},
		{"udp", true},
	}
	switch in.Protocol {
	case ProtocolHysteria2:
		p = append(p, yamlField{"password", in.Settings.Password}, yamlField{"alpn", []string{"h3"}})
		if lo, hi := e.hopRange(); lo > 0 {
			p = append(p, yamlField{"ports", fmt.Sprintf("%d-%d", lo, hi)}, yamlField{"hop-interval", 30})
		}
	case ProtocolTUIC:
		p = append(p,
			yamlField{"uuid", in.Settings.UUID},
			yamlField{"password", in.Settings.Password},
			yamlField{"alpn", []string{"h3"}},
			yamlField{"congestion-controller", "bbr"},
			yamlField{"udp-relay-mode", "native"})
	case ProtocolAnyTLS:
		p = append(p, yamlField{"password", in.Settings.Password}, yamlField{"client-fingerprint", in.Security.Fingerprint})
	}
	p = append(p, yamlField{"sni", in.Security.SNI})
	if e.selfSigned() {
		p = append(p, yamlField{"skip-cert-verify", true})
	}
	return p
}

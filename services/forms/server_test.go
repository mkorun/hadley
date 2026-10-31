package forms

import (
	"bytes"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func testService(t *testing.T) *Service {
	t.Helper()
	s, err := New(Config{
		DataDir: t.TempDir(), AdminToken: "admin", HMACSecret: "secret", Origins: []string{"https://a"}, Cost: 1,
		KeyPrefix: "0", RateLimitMax: 1e6, RateLimitWindow: 900, TokenTTL: 900, MaxQueueEntries: 1e6, MaxQueueBytes: 1e9,
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// solvedBody is a submission with a solution of a fresh challenge from s.
func solvedBody(t *testing.T, s *Service) []byte {
	t.Helper()
	response := httptest.NewRecorder()
	s.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/comment/token", nil))
	challenge, err := parseJSON(response.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	parameters := field(challenge, "parameters")
	nonce, _ := hex.DecodeString(field(parameters, "nonce").(string))
	salt, _ := hex.DecodeString(field(parameters, "salt").(string))
	for counter := uint32(0); ; counter++ {
		key, _ := pbkdf2.Key(sha256.New, string(binary.BigEndian.AppendUint32(bytes.Clone(nonce), counter)), salt, 1, 32)
		if derived := hex.EncodeToString(key); strings.HasPrefix(derived, "0") {
			solution := newObject()
			solution.set("counter", float64(counter))
			solution.set("derivedKey", derived)
			altcha := newObject()
			altcha.set("challenge", challenge)
			altcha.set("solution", solution)
			body := newObject()
			for key, value := range map[string]any{"altcha": altcha, "article_id": "a", "language_version": "de", "name": "n", "text": "t"} {
				body.set(key, value)
			}
			return stringifyJS(body)
		}
	}
}

func TestASolutionSentManyTimesAtOnceIsTakenOnce(t *testing.T) {
	s := testService(t)
	body := solvedBody(t, s)
	var wg sync.WaitGroup
	statuses := make([]int, 20)
	for i := range statuses {
		wg.Go(func() {
			response := httptest.NewRecorder()
			s.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/comment/submit", bytes.NewReader(body)))
			statuses[i] = response.Code
		})
	}
	wg.Wait()
	accepted := 0
	for _, status := range statuses {
		switch status {
		case http.StatusCreated:
			accepted++
		case http.StatusUnprocessableEntity:
		default:
			t.Errorf("status %d", status)
		}
	}
	if accepted != 1 {
		t.Errorf("accepted %d times", accepted)
	}
}

func TestClientAddressTrustsHeadersOnlyFromThisMachine(t *testing.T) {
	request := func(peer string, header ...string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/api/comment/token", nil)
		r.RemoteAddr = peer
		for i := 0; i < len(header); i += 2 {
			r.Header.Add(header[i], header[i+1])
		}
		return r
	}
	for _, c := range []struct {
		r    *http.Request
		want string
	}{
		{request("127.0.0.1:5000", "X-Forwarded-For", " 192.0.2.1 , 10.0.0.1"), "192.0.2.1"},
		{request("[::1]:5000", "Cf-Connecting-Ip", "192.0.2.2"), "192.0.2.2"},
		{request("127.0.0.1:5000", "X-Forwarded-For", ""), "unknown"},
		{request("127.0.0.1:5000", "X-Forwarded-For", "chosen-by-the-sender"), "unknown"},
		{request("127.0.0.1:5000", "X-Forwarded-For", "1:2:3:4:5:6:7:8:9::"), "unknown"},
		{request("127.0.0.1:5000"), "unknown"},
		{request("198.51.100.9:5000", "X-Forwarded-For", "192.0.2.1"), "198.51.100.9"},
	} {
		if got := clientAddress(c.r); got != c.want {
			t.Errorf("clientAddress from %s = %q, want %q", c.r.RemoteAddr, got, c.want)
		}
	}
}

func TestAdminTokenIsCompared(t *testing.T) {
	s := testService(t)
	for header, want := range map[string]int{"": 401, "Bearer admin": 200, "Bearer admin ": 401, "bearer admin": 401} {
		r := httptest.NewRequest(http.MethodGet, "/admin/comments", nil)
		if header != "" {
			r.Header.Set("Authorization", header)
		}
		response := httptest.NewRecorder()
		s.ServeHTTP(response, r)
		if response.Code != want {
			t.Errorf("%q: %d, want %d", header, response.Code, want)
		}
	}
}

// review 2026-10-27: a wrong solution uses up its challenge before any key is derived again, and a solution sent
// once more after it is refused
func TestAWrongSolutionUsesUpItsChallenge(t *testing.T) {
	s := testService(t)
	right := solvedBody(t, s)
	wrong := bytes.Replace(right, []byte(`"derivedKey":"0`), []byte(`"derivedKey":"f`), 1)
	for i, body := range [][]byte{wrong, right} {
		response := httptest.NewRecorder()
		s.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/comment/submit", bytes.NewReader(body)))
		if want := []string{`{"error":"Invalid solution"}`, `{"error":"Challenge already used"}`}[i]; response.Code != 422 || response.Body.String() != want {
			t.Errorf("submission %d: %d %s, want 422 %s", i, response.Code, response.Body, want)
		}
	}
}

// review 2026-10-27: Hono matches the path after decodeURI, which keeps %2F
func TestRoutesAreMatchedAsHonoMatchesThem(t *testing.T) {
	s := testService(t)
	for path, want := range map[string]int{"/api/comment/token": 200, "/api/comment/%74oken": 200, "/api/comment%2Ftoken": 404, "/api/comment/token/": 404} {
		response := httptest.NewRecorder()
		s.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != want {
			t.Errorf("%s: %d, want %d", path, response.Code, want)
		}
	}
}

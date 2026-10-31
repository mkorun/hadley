package forms

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
)

const maxBody = 16 * 1024 // bytes of a submission (CONTRACT.md C7, stage 1)

// Service answers the routes of CONTRACT.md: the token and submission routes for the widget, the admin routes for the
// moderation CLI.
type Service struct {
	config  Config
	limiter *rateLimiter
	replay  *replayStore
	queue   *queue
	notify  func(name, article, language, text string)
	now     func() time.Time
}

// New opens the service's data in config.DataDir; the directory must exist.
func New(config Config) (*Service, error) {
	replay, err := openReplayStore(config.DataDir, time.Now())
	if err != nil {
		return nil, err
	}
	s := &Service{
		config:  config,
		limiter: newRateLimiter(),
		replay:  replay,
		queue:   &queue{dir: config.DataDir},
		now:     time.Now,
	}
	s.notify = notifier(config)
	return s, nil
}

// Maintain runs the background work until stop closes: the replay purge every minute, the rate limit's reset every
// six hours (CONTRACT.md C4, C12).
func (s *Service) Maintain(stop <-chan struct{}) {
	purge, reset := time.NewTicker(time.Minute), time.NewTicker(6*time.Hour)
	defer purge.Stop()
	defer reset.Stop()
	for {
		select {
		case <-stop:
			return
		case <-purge.C:
			if err := s.replay.purge(s.now()); err != nil {
				log.Printf("[replay-store] %v", err)
			}
		case <-reset.C:
			s.limiter.clear()
		}
	}
}

// ServeHTTP applies CORS to every request, answers a preflight itself, and routes the rest (CONTRACT.md C1, C2).
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if failure := recover(); failure != nil {
			log.Printf("%s %s: %v", r.Method, r.URL.Path, failure)
			writeText(w, http.StatusInternalServerError, "Internal Server Error")
		}
	}()
	origin := strings.Join(r.Header.Values("Origin"), ", ")
	if slices.Contains(s.config.Origins, origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	if r.Method == http.MethodOptions {
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		w.Header().Add("Vary", "Access-Control-Request-Headers")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Add("Vary", "Origin")
	read := r.Method == http.MethodGet || r.Method == http.MethodHead
	path := routePath(r)
	switch {
	case path == "/api/comment/token" && read:
		s.token(w, r)
	case path == "/api/comment/submit" && r.Method == http.MethodPost:
		s.submit(w, r)
	case path == "/admin/comments" && (read || r.Method == http.MethodDelete):
		if !s.admin(r) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
		} else if r.Method == http.MethodDelete {
			s.queue.drop()
			w.WriteHeader(http.StatusNoContent)
		} else {
			s.download(w)
		}
	default:
		writeText(w, http.StatusNotFound, "404 Not Found")
	}
}

func (s *Service) token(w http.ResponseWriter, r *http.Request) {
	allowed, err := s.limiter.allow(clientAddress(r), s.config.RateLimitMax, s.config.RateLimitWindow*1000, s.now())
	if err != nil {
		panic(err)
	}
	if !allowed {
		writeError(w, http.StatusTooManyRequests, "Rate limit exceeded")
		return
	}
	challenge, err := newChallenge(s.config, s.now(), rand.Reader)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, challenge)
}

// submit checks a submission in the order of CONTRACT.md C7 and answers at the first failure.
func (s *Service) submit(w http.ResponseWriter, r *http.Request) {
	data, tooLarge := readBody(r)
	if tooLarge {
		w.Header().Set("Content-Type", "application/octet-stream") // what the replaced service sends, CORS included
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		io.WriteString(w, "Payload Too Large")
		return
	}
	body, err := parseJSON(data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	if body == nil {
		panic("a submission of null") // destructuring null throws in the replaced service: 500
	}
	altcha, hasAltcha := lookup(body, "altcha")
	article, articleOK := field(body, "article_id").(string)
	language, languageOK := field(body, "language_version").(string)
	parent := field(body, "parent_comment_id")
	parentText, parentOK := parent.(string)
	name, nameOK := field(body, "name").(string)
	text, textOK := field(body, "text").(string)
	if !hasAltcha || !articleOK || article == "" || !languageOK || language == "" ||
		(parent != nil && !parentOK) || !nameOK || !textOK {
		writeError(w, http.StatusBadRequest, "Missing or invalid fields")
		return
	}
	switch {
	case !articlePattern.MatchString(article):
		writeError(w, http.StatusBadRequest, "Invalid article_id")
		return
	case !languagePattern.MatchString(language):
		writeError(w, http.StatusBadRequest, "Invalid language_version")
		return
	case parent != nil && !uuidPattern.MatchString(parentText):
		writeError(w, http.StatusBadRequest, "Invalid parent_comment_id")
		return
	}
	name, text = cleanField(name), cleanField(text)
	email := ""
	if raw, ok := field(body, "email").(string); ok {
		email = cleanEmail(raw)
	}
	notify := field(body, "notify") == true
	for _, check := range []struct {
		failed  bool
		message string
	}{
		{name == "", "Missing or invalid fields"},
		{lengthUTF16(name) > 100, "name too long"},
		{text == "", "Missing or invalid fields"},
		{lengthUTF16(text) > 10_000, "text too long"},
		{notify && email == "", "email required when notify is true"},
		{email != "" && lengthUTF16(email) > 254, "email too long"},
		{email != "" && !validEmail(email), "Invalid email"},
	} {
		if check.failed {
			writeError(w, http.StatusBadRequest, check.message)
			return
		}
	}

	challenge, solution := field(altcha, "challenge"), field(altcha, "solution")
	if !truthy(challenge) || !truthy(solution) {
		writeError(w, http.StatusUnprocessableEntity, "Invalid altcha payload")
		return
	}
	nonce, _ := field(field(challenge, "parameters"), "nonce").(string)
	if nonce == "" {
		writeError(w, http.StatusUnprocessableEntity, "Invalid challenge")
		return
	}
	if s.replay.seen(nonce, s.now()) {
		writeError(w, http.StatusUnprocessableEntity, "Challenge already used")
		return
	}
	parameters := signed(challenge, s.config.HMACSecret, s.now())
	if parameters == nil {
		writeError(w, http.StatusUnprocessableEntity, "Invalid solution")
		return
	}
	// the challenge is taken before the costly key derivation, with the check that it is not taken already: each signed
	// challenge costs one derivation however often it is sent, and a solution sent twice at once is taken once
	expiry := float64(s.now().Unix()) + s.config.TokenTTL
	if at, _ := parameters.get("expiresAt"); at != nil {
		expiry = toNumber(at)
	}
	switch taking, err := s.replay.use(nonce, expiry, s.now()); {
	case err != nil:
		panic(err)
	case taking == usedAlready:
		writeError(w, http.StatusUnprocessableEntity, "Challenge already used")
		return
	case taking == expired: // between the signature check and here
		writeError(w, http.StatusUnprocessableEntity, "Invalid solution")
		return
	}
	switch solved, err := solves(parameters, solution); {
	case err != nil:
		writeError(w, http.StatusUnprocessableEntity, "Verification error")
		return
	case !solved:
		writeError(w, http.StatusUnprocessableEntity, "Invalid solution")
		return
	}

	record := newObject()
	record.set("id", newUUID())
	record.set("submitted_at", s.now().UTC().Format("2006-01-02T15:04:05Z"))
	record.set("article_id", article)
	record.set("language_version", language)
	record.set("parent_comment_id", parent)
	record.set("name", name)
	record.set("email", email)
	record.set("text", text)
	record.set("notify", notify)
	switch err := s.queue.add(stringifyJS(record), s.config.MaxQueueBytes, s.config.MaxQueueEntries); {
	case errors.Is(err, errQueueFull):
		writeError(w, http.StatusServiceUnavailable, "Queue full")
		return
	case err != nil:
		panic(err)
	}
	if s.notify != nil {
		go s.notify(name, article, language, text)
	}
	writeJSON(w, http.StatusCreated, newObject())
}

func (s *Service) download(w http.ResponseWriter) {
	resumed, comments, err := s.queue.take()
	if err != nil {
		panic(err)
	}
	answer := newObject()
	answer.set("resumed", resumed)
	answer.set("comments", comments)
	writeJSON(w, http.StatusOK, answer)
}

// admin reports whether the request carries the admin token (compared in constant time).
func (s *Service) admin(r *http.Request) bool {
	expected := "Bearer " + s.config.AdminToken
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(expected)) == 1
}

// routePath is the path a route is matched against, as Hono matches it (decodeURI of the path as sent): ASCII percent
// escapes decoded, except those of the characters decodeURI keeps (; / ? : @ & = + $ , #) and of % itself, so that
// /api/comment%2Ftoken is no route. Escapes of other characters are left, which no route contains.
func routePath(r *http.Request) string {
	raw := r.URL.EscapedPath()
	var b strings.Builder
	for i := 0; i < len(raw); i++ {
		if raw[i] == '%' && i+2 < len(raw) {
			if c, err := strconv.ParseUint(raw[i+1:i+3], 16, 8); err == nil && c < 0x80 && !strings.ContainsRune(";/?:@&=+$,#%", rune(c)) {
				b.WriteByte(byte(c))
				i += 2
				continue
			}
		}
		b.WriteByte(raw[i])
	}
	return b.String()
}

// readBody reads a request body up to maxBody bytes; tooLarge when it declares or has more.
func readBody(r *http.Request) (data []byte, tooLarge bool) {
	if r.ContentLength > maxBody {
		return nil, true
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return nil, false // a body cut off is no JSON
	}
	return data, len(data) > maxBody
}

// clientAddress is the address a request is counted under (CONTRACT.md C4): from a reverse proxy on this machine the
// first X-Forwarded-For entry, else CF-Connecting-IP, else "unknown"; from any other peer its own address, which a
// header cannot replace. Only an IP address counts: what else a header holds would be a key of the sender's choice.
func clientAddress(r *http.Request) string {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = r.RemoteAddr
	}
	if ip := net.ParseIP(peer); ip == nil || !ip.IsLoopback() {
		return peer
	}
	if forwarded, ok := r.Header["X-Forwarded-For"]; ok {
		first, _, _ := strings.Cut(strings.Join(forwarded, ", "), ",")
		if ip := net.ParseIP(strings.TrimFunc(first, isSpaceJS)); ip != nil {
			return ip.String()
		}
	}
	if connecting, ok := r.Header["Cf-Connecting-Ip"]; ok {
		if ip := net.ParseIP(strings.Join(connecting, ", ")); ip != nil {
			return ip.String()
		}
	}
	return "unknown"
}

// lookup is key in v when v is an object, and whether v has it (`v.key !== undefined` in JavaScript).
func lookup(v any, key string) (any, bool) {
	if o, ok := v.(*object); ok {
		return o.get(key)
	}
	return nil, false
}

func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0F | 0x40 // version 4
	b[8] = b[8]&0x3F | 0x80 // RFC 9562 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(stringifyJS(v))
}

func writeError(w http.ResponseWriter, status int, message string) {
	answer := newObject()
	answer.set("error", message)
	writeJSON(w, status, answer)
}

func writeText(w http.ResponseWriter, status int, text string) {
	w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
	w.WriteHeader(status)
	io.WriteString(w, text)
}
